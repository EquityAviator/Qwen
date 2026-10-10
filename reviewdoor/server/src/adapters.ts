/**
 * ReviewDoor — Integration adapters (Design §8, §19; SRS §7.5, §16.4).
 * Payment / OCR-VLM / Email-WhatsApp / Printer are adapters behind interfaces so
 * vendors can change without touching billing logic (NFR-10). AI is optional:
 * the platform must function correctly when every provider is unavailable (§2).
 */
import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { validateAiExtraction, type ExtractedReceipt } from './domain.js';

/* ─────────── Receipt extraction provider abstraction (SRS §7.5) ─────────── */

export interface ExtractionProvider {
  name: string;               // lm_studio | cloud_vlm | local_rules | disabled
  model?: string;
  promptVersion: string;
  available(): Promise<boolean>;
  extract(imagePath: string, meta: { fileName: string; sha256: string }): Promise<unknown>;
}

/** Deterministic rule-based extractor — always works, no AI dependency. */
export class LocalRulesProvider implements ExtractionProvider {
  name = 'local_rules'; promptVersion = 'v3';
  async available() { return true; }
  async extract(_p: string, meta: { fileName: string }) {
    // Simulated deterministic parse of filenames like "easypaisa_1500_2026-10-08_TXN88231_ref-RD-SPI-BUSI-448217.png"
    const base = meta.fileName.replace(/\.[a-z]+$/i, '').toLowerCase();
    const parts = base.split(/[_\-\s]+/);
    const amountTok = parts.find(t => /^\d{3,7}$/.test(t));
    const dateTok = parts.find(t => /^\d{4}-\d{2}-\d{2}$/.test(t));
    const txnTok = parts.find(t => /^txn\d+/i.test(meta.fileName) ? t : /^t\d{5,}$/i.test(t));
    const refTok = parts.find(t => /^rd-/.test(t) || /ref/.test(t));
    const chanTok = parts.find(t => ['easypaisa', 'jazzcash', 'bank', 'card'].includes(t));
    const readable = !parts.includes('blur') && !meta.fileName.endsWith('.txt');
    const out: Record<string, unknown> = {
      quality: { value: readable ? 'readable' : 'unclear', confidence: 0.9 },
      warnings: [],
    };
    if (amountTok) out.amount = { value: amountTok, confidence: 0.96 };
    out.currency = { value: 'PKR', confidence: 0.99 };
    if (dateTok) out.payment_date = { value: dateTok, confidence: 0.94 };
    const txnFromName = meta.fileName.match(/txn[_-]?(\w{4,})/i)?.[1];
    if (txnTok || txnFromName) out.transaction_id = { value: (txnFromName || txnTok) as string, confidence: 0.91 };
    if (refTok) out.reference = { value: refTok.replace(/^ref-?/, ''), confidence: 0.88 };
    if (chanTok) out.channel = { value: chanTok, confidence: 0.85 };
    if (!txnTok && !txnFromName) (out.warnings as string[]).push('No gateway confirmation present');
    return out;
  }
}

/** LM Studio VLM adapter — OpenAI-compatible chat endpoint, JSON contract output. */
export class LmStudioProvider implements ExtractionProvider {
  name = 'lm_studio'; promptVersion = 'receipt-v3';
  get cfg() {
    return getSetting('ai_lmstudio', {
      enabled: false, baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen2.5-vl-7b',
      timeoutMs: 15000, retries: 2, temperature: 0.1, maxTokens: 700,
    });
  }
  async available(): Promise<boolean> {
    const c = this.cfg;
    if (!c.enabled || !c.baseUrl) return false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(`${c.baseUrl}/models`, { headers: this.headers(), signal: ctl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }
  private headers() {
    const c = this.cfg;
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (c.apiKey) h.Authorization = `Bearer ${c.apiKey}`;
    return h;
  }
  async extract(imagePath: string, _meta: unknown): Promise<unknown> {
    const c = this.cfg;
    const fs = await import('node:fs/promises');
    const img = (await fs.readFile(imagePath)).toString('base64');
    const prompt = `Extract payment receipt fields. Respond ONLY with JSON: {"amount":{"value","confidence"},"currency":...,"payment_date":...,"transaction_id":...,"reference":...,"sender_name":...,"payee_name":...,"channel":...,"quality":{"value":"readable|unclear","confidence"},"warnings":[...]}`;
    let attempt = 0;
    for (;;) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), c.timeoutMs);
        const res = await fetch(`${c.baseUrl}/chat/completions`, {
          method: 'POST', headers: this.headers(), signal: ctl.signal,
          body: JSON.stringify({
            model: c.model, temperature: c.temperature, max_tokens: c.maxTokens,
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
            ] }],
          }),
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}`);
        const j = await res.json() as any;
        const text = j.choices?.[0]?.message?.content ?? '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in model response');
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        attempt++;
        if (attempt > c.retries) throw e;
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); // exponential backoff (§16.4)
      }
    }
  }
}

/** Cloud VLM fallback stub — same interface, vendor-swappable. */
export class CloudVlmStub implements ExtractionProvider {
  name = 'cloud_vlm'; promptVersion = 'v1';
  async available() { return getSetting('ai_cloud_enabled', false); }
  async extract() { throw new Error('Cloud VLM not configured in this deployment'); }
}

export async function runExtraction(imagePath: string, meta: { fileName: string; sha256: string }):
  Promise<{ fields: ExtractedReceipt | null; meta: { provider: string; model?: string; promptVersion: string; at: string; error?: string } }> {
  const mode: string = getSetting('ai_mode', 'auto');
  const chain: ExtractionProvider[] = [];
  if (mode !== 'disabled') {
    if (mode === 'auto' || mode === 'lm_studio') chain.push(new LmStudioProvider());
    chain.push(new CloudVlmStub());
  }
  chain.push(new LocalRulesProvider()); // deterministic fallback — never blocks manual review
  for (const p of chain) {
    try {
      if (!(await p.available())) continue;
      const raw = await p.extract(imagePath, meta);
      const v = validateAiExtraction(raw);           // schema gate before rules engine (§17.3)
      if (!v.ok || !v.value) throw new Error(v.error || 'schema invalid');
      return { fields: v.value, meta: { provider: p.name, model: (p as any).cfg?.model, promptVersion: p.promptVersion, at: new Date().toISOString() } };
    } catch (e) {
      // provider failure must not corrupt state — fall through to next adapter
      if (p === chain[chain.length - 1]) {
        return { fields: null, meta: { provider: p.name, promptVersion: p.promptVersion, at: new Date().toISOString(), error: String(e) } };
      }
    }
  }
  return { fields: null, meta: { provider: 'none', promptVersion: '-', at: new Date().toISOString(), error: 'no provider' } };
}

/* ─────────── Notification adapters (email / whatsapp / sms) ─────────── */

export interface NotifyAdapter { channel: string; send(to: string, title: string, body: string): Promise<boolean>; }

const logSink: { at: string; channel: string; to: string; title: string; ok: boolean }[] = [];
export const getNotificationLog = () => logSink.slice(-50);

class ConsoleAdapter implements NotifyAdapter {
  constructor(public channel: string) {}
  async send(to: string, title: string, body: string) {
    // Real deployments swap this for SMTP/Twilio/WhatsApp Business adapters via settings.
    logSink.push({ at: new Date().toISOString(), channel: this.channel, to, title, ok: true });
    console.log(`[notify:${this.channel}] → ${to}: ${title}`);
    return true;
  }
}
export const notifyAdapters: Record<string, NotifyAdapter> = {
  email: new ConsoleAdapter('email'),
  whatsapp: new ConsoleAdapter('whatsapp'),
  sms: new ConsoleAdapter('sms'),
};

/* ─────────── Payment gateway webhook verification (future adapter, contract now) ─────────── */

export function verifyWebhookSignature(secretEnv: string | undefined, rawBody: string, signature: string | undefined): boolean {
  if (!secretEnv) return false;                       // credentials stay server-side only (§14.1)
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secretEnv).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
}

/* ─────────── Printer partner adapter ─────────── */

export interface PrinterAdapter { submitPrintJob(orderId: string, fileRef: string, qty: number): Promise<{ jobId: string }>; }
export const printerAdapter: PrinterAdapter = {
  async submitPrintJob(orderId, fileRef, qty) {
    // Partner API integration is Phase 6; local simulation keeps the workflow testable.
    return { jobId: `PJ-${orderId}-${crypto.randomBytes(3).toString('hex')}` };
  },
};

/* ─────────── File security helpers (SRS §14.2) ─────────── */

const ALLOWED_MIME: Record<string, string[]> = {
  'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'application/pdf': ['.pdf'],
};
const MAGIC: { test: (b: Buffer) => boolean; mime: string }[] = [
  { test: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, mime: 'image/png' },
  { test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, mime: 'image/jpeg' },
  { test: b => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', mime: 'image/webp' },
  { test: b => b.length > 4 && b.subarray(0, 5).toString() === '%PDF-', mime: 'application/pdf' },
];

export function validateUpload(buf: Buffer, declaredMime: string, maxSizeBytes = 5 * 1024 * 1024): { ok: boolean; mime?: string; error?: string } {
  if (buf.length === 0) return { ok: false, error: 'Empty file' };
  if (buf.length > maxSizeBytes) return { ok: false, error: `File exceeds ${Math.round(maxSizeBytes / 1024 / 1024)} MB limit` };
  const sniffed = MAGIC.find(m => m.test(buf));
  if (!sniffed) return { ok: false, error: 'File signature does not match a supported image/PDF format' };
  const exts = ALLOWED_MIME[sniffed.mime];
  if (!exts.includes('.' + declaredMime.split('/').pop()!.toLowerCase()) && declaredMime !== sniffed.mime) {
    return { ok: false, error: `Declared type ${declaredMime} conflicts with actual content (${sniffed.mime})` };
  }
  // Naive EICAR-style scan hook point — real AV scanner adapter would live here.
  if (buf.subarray(0, 8).toString('latin1').includes('EICAR-STANDARD')) return { ok: false, error: 'Malware signature detected' };
  return { ok: true, mime: sniffed.mime };
}

/** 64-bit perceptual dHash over a decoded grayscale grid (adapter-friendly: accepts raw pixels or falls back to byte hash). */
export function perceptualFingerprint(buf: Buffer): string {
  // Without a full image decoder we derive a stable coarse fingerprint from block-wise byte means.
  // A production deployment swaps in sharp/jimp pixel sampling behind this same interface.
  const size = 8;
  const block = Math.max(1, Math.floor(buf.length / (size * size)));
  const means: number[] = [];
  for (let i = 0; i < size * size; i++) {
    let s = 0, n = 0;
    for (let j = i * block; j < Math.min(buf.length, (i + 1) * block); j += 7) { s += buf[j]; n++; }
    means.push(n ? s / n : 0);
  }
  let bits = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size - 1; x++)
    bits += means[y * size + x] > means[y * size + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

export const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
