/**
 * ReviewDoor — HTTP API (Express). Modular-monolith single deployable:
 * serves the public QR route, client API, admin API and the built SPA.
 * Auth = JWT in httpOnly SameSite=Lax cookie + CSRF double-submit token (§14.1).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { z } from 'zod';
import { db, getSetting, setSetting, nowIso, UPLOADS_DIR } from './db.js';
import {
  findAccountByEmail, getAccount, createAccount, audit, funnel, rateLimit,
  latestSubscription, createBusiness, updateBusiness, listQrsForAccount, createQr,
  changeDestination, setQrOperational, resolveQr, createPaymentIntent, submitReceipt,
  approveReceipt, rejectReceipt, markDuplicate, reverseApproval, adminExtendSubscription,
  grantTrial, cancelSubscription, notify, createCardOrder, transitionCardOrder,
  analyticsFor, seedIfEmpty, tickJobs, refreshSubscriptionStatus,
} from './services.js';
import { effectiveRouting, validateDestination, canTransition, type CardOrderState } from './domain.js';
import { verifyWebhookSignature, getNotificationLog } from './adapters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.RD_JWT_SECRET || 'dev-only-secret-change-me';
const PORT = Number(process.env.PORT || 8787);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const app = express();

/* ── request id + structured logging (§16) ── */
app.use((req, res, next) => {
  (req as any).correlationId = req.headers['x-request-id'] as string || crypto.randomUUID();
  res.setHeader('X-Request-Id', (req as any).correlationId);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ── security headers ── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

/* ── auth session helpers ── */
interface Session { sub: string; role: string; email: string }
function readSession(req: Request): Session | null {
  const tok = req.cookies?.rd_session;
  if (!tok) return null;
  try { return jwt.verify(tok, JWT_SECRET) as Session; } catch { return null; }
}
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'Authentication required' });
  const acc = getAccount(s.sub);
  if (!acc || acc.status !== 'ACTIVE') return res.status(403).json({ error: 'Account inactive' });
  (req as any).session = s; (req as any).account = acc;
  next();
}
function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: 'Authentication required' });
    // server-side RBAC — hiding a button is never authorization (§2.1)
    if (!roles.includes(s.role)) return res.status(403).json({ error: 'Insufficient role' });
    requireAuth(req, res, next);
  };
}
/** CSRF double-submit for cookie-auth state-changing requests (§14.1) */
function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  const hdr = req.headers['x-csrf-token'];
  const cookie = req.cookies?.rd_csrf;
  if (!hdr || !cookie || hdr !== cookie) return res.status(403).json({ error: 'CSRF token mismatch' });
  next();
}
function startSession(res: Response, acc: { id: string; role: string; email: string }) {
  const token = jwt.sign({ sub: acc.id, role: acc.role, email: acc.email }, JWT_SECRET, { expiresIn: '12h' });
  const csrf = crypto.randomBytes(16).toString('hex');
  res.cookie('rd_session', token, { httpOnly: true, sameSite: 'lax', secure: !!process.env.RD_COOKIE_SECURE, maxAge: 12 * 3600_000 });
  res.cookie('rd_csrf', csrf, { httpOnly: false, sameSite: 'lax', secure: !!process.env.RD_COOKIE_SECURE, maxAge: 12 * 3600_000 });
}

/* ── health endpoints (§16) ── */
app.get('/api/health', (_req, res) => {
  let dbOk = false;
  try { dbOk = !!db.prepare('SELECT 1').get(); } catch { /* down */ }
  const aiMode = getSetting('ai_mode', 'auto');
  res.json({ ok: dbOk, db: dbOk, queue: 'embedded', storage: fs.existsSync(UPLOADS_DIR), ai: aiMode, time: nowIso() });
});

/* ═════════ PUBLIC QR RESOLVER — lightweight critical path (NFR-01/02) ═════════ */
function resolverHandler(maxAge = 0) {
  return (req: Request, res: Response) => {
    try {
      const out = resolveQr(String(String(req.params.code)), {
        ua: req.headers['user-agent'] ?? '', ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '',
        referer: req.headers.referer, correlationId: (req as any).correlationId,
      });
      // no-cache so intermediaries can never pin a stale routing decision (§6.2, A-11)
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      if (out.outcome === 'REDIRECT') return res.redirect(302, out.url);
      const page = out.outcome === 'EXPIRED' ? 'expired' : out.outcome === 'SUSPENDED' ? 'suspended' : out.outcome === 'NOT_FOUND' ? 'notfound' : 'error';
      return res.status(out.outcome === 'NOT_FOUND' ? 404 : out.outcome === 'ERROR' ? 503 : 200)
        .type('html').send(publicPage(page, String(String(req.params.code))));
    } catch (e) {
      console.error('[resolver] failure', e);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).type('html').send(publicPage('error', String(String(req.params.code)))); // safe fallback, never invent entitlement
    }
  };
}
app.get('/q/:code', resolverHandler());
app.get('/expired/:code', (req, res) => res.setHeader('Cache-Control', 'no-store').type('html').send(publicPage('expired', String(String(req.params.code)))));
app.get('/suspended/:code', (req, res) => res.setHeader('Cache-Control', 'no-store').type('html').send(publicPage('suspended', String(String(req.params.code)))));

function publicPage(kind: string, code: string) {
  const copy: Record<string, [string, string]> = {
    expired: ['This QR service is currently inactive.', 'The business can reactivate it at any time — the QR you scanned still works.'],
    suspended: ['This QR is temporarily unavailable.', 'Contact support if you need help reaching this business.'],
    notfound: ['This QR code could not be found or is no longer available.', 'Please check the code or contact the business.'],
    error: ['We’re having trouble loading this link right now.', 'Please try again shortly.'],
  };
  const [title, sub] = copy[kind] ?? copy.error;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ReviewDoor</title>
<style>body{margin:0;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;background:#FAF4D3;color:#0C1618;display:grid;place-items:center;min-height:100vh}
.card{max-width:420px;text-align:center;padding:48px 32px;background:#fff;border-radius:20px;box-shadow:0 12px 40px rgba(12,22,24,.08)}
.dot{width:56px;height:56px;border-radius:50%;margin:0 auto 20px;display:grid;place-items:center;font-size:26px;background:${kind === 'expired' ? '#F6BE9A' : kind === 'suspended' ? '#fde8e8' : '#eee'}}
a{color:#004643;font-weight:600;text-decoration:none}h1{font-size:20px;margin:0 0 10px}p{font-size:14.5px;line-height:1.6;color:#4a5a5c;margin:0 0 22px}
small{display:block;margin-top:18px;color:#9aa8a9;font-size:11px}</style></head>
<body><div class="card"><div class="dot">${kind === 'expired' ? '⏳' : kind === 'suspended' ? '🚫' : '❓'}</div>
<h1>${title}</h1><p>${sub}</p><a href="/">← ReviewDoor home</a> · <a href="/support">Support</a>
<small>Code ${escapeHtml(code.slice(0, 12))} · Dynamic QR service by ReviewDoor</small></div></body></html>`;
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/* ═════════ AUTH ═════════ */
app.post('/api/auth/signup', csrfGuard, (req, res) => {
  const p = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), phone: z.string().optional(), terms: z.literal(true) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: p.error.issues[0].message });
  if (!rateLimit(`signup:${req.ip}`, 5, 3600_000)) return res.status(429).json({ error: 'Too many signups — try later' });
  funnel('signup_started');
  try {
    const acc = createAccount({ ...p.data, password: p.data.password });
    startSession(res, acc);
    res.json({ user: publicUser(acc) });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/auth/login', csrfGuard, (req, res) => {
  const p = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Invalid input' });
  if (!rateLimit(`login:${req.ip}`, 10, 900_000)) return res.status(429).json({ error: 'Too many login attempts — wait 15 minutes' });
  const acc = findAccountByEmail(p.data.email);
  if (!acc || !bcrypt.compareSync(p.data.password, acc.password_hash))
    return res.status(401).json({ error: 'Email or password is incorrect' });   // generic — no account enumeration
  if (acc.status !== 'ACTIVE') return res.status(403).json({ error: 'Account is suspended' });
  startSession(res, acc);
  res.json({ user: publicUser(acc) });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('rd_session'); res.clearCookie('rd_csrf'); res.json({ ok: true }); });
app.get('/api/auth/me', (req, res) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'No session' });
  const acc = getAccount(s.sub)!;
  res.json({ user: publicUser(acc), csrf: req.cookies?.rd_csrf ?? null });
});
app.post('/api/auth/password-reset-request', csrfGuard, (req, res) => {
  // Always same response — don't leak which emails exist (§14.1)
  const email = String(req.body?.email ?? '').toLowerCase();
  const acc = findAccountByEmail(email);
  if (acc) {
    const token = crypto.randomBytes(24).toString('hex');
    setSetting(`reset:${token}`, { accountId: acc.id, expires: Date.now() + 3600_000 });
    notify(acc.id, 'security', 'Password reset requested', `Use reset token ${token.slice(0, 8)}… (full token delivered via email adapter in production).`, `rst-${Date.now()}`);
  }
  res.json({ ok: true });
});
app.post('/api/auth/password-reset', csrfGuard, (req, res) => {
  const p = z.object({ token: z.string(), password: z.string().min(8) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Invalid input' });
  const rec = getSetting<any>(`reset:${p.data.token}`, null);
  if (!rec || rec.expires < Date.now()) return res.status(400).json({ error: 'Reset token invalid or expired' });
  db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(bcrypt.hashSync(p.data.password, 11), rec.accountId);
  db.prepare('DELETE FROM integration_settings WHERE key=?').run(`reset:${p.data.token}`);
  audit(rec.accountId, 'client', 'account', rec.accountId, 'password_reset');
  res.json({ ok: true });
});

function publicUser(a: any) {
  return { id: a.id, name: a.name, email: a.email, role: a.role, timezone: a.timezone, status: a.status };
}

/* ═════════ CLIENT: businesses / destinations / QRs ═════════ */
app.get('/api/client/bootstrap', requireAuth, (req, res) => {
  const acc = (req as any).account;
  const biz = db.prepare('SELECT * FROM businesses WHERE account_id=?').all(acc.id);
  const qrs = listQrsForAccount(acc.id).map(q => decorateQr(q, acc.id));
  const sub = latestSubscription(acc.id);
  res.json({
    user: publicUser(acc), businesses: biz, qrs,
    subscription: sub ? { ...sub, plan_snapshot: JSON.parse(sub.plan_snapshot) } : null,
    notifications: db.prepare('SELECT id,kind,title,body,channel,delivery_status,created_at FROM notifications WHERE account_id=? ORDER BY created_at DESC LIMIT 30').all(acc.id),
    prefs: db.prepare('SELECT * FROM notification_prefs WHERE account_id=?').get(acc.id),
  });
});

function decorateQr(q: any, accountId: string) {
  const ri = (() => {
    const sub = latestSubscription(accountId);
    const snap = sub ? JSON.parse(sub.plan_snapshot) : { grace_days: 0 };
    return sub
      ? { operational: q.operational_state, subscription: sub.status, periodEndUtc: sub.period_end, graceDays: snap.grace_days ?? 0, provisionalUntilUtc: sub.provisional_until }
      : { operational: q.operational_state, subscription: 'EXPIRED' as const, periodEndUtc: new Date(0).toISOString(), graceDays: 0 };
  })();
  const { outcome, subState } = effectiveRouting(ri);
  const scans = (db.prepare('SELECT COUNT(*) c FROM scan_events WHERE qr_code_id=?').get(q.id) as any).c;
  return { ...q, effective: outcome, derivedState: subState, scans };
}

app.post('/api/client/businesses', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({ name: z.string().min(2), category: z.string().optional(), contactEmail: z.string().optional(), contactPhone: z.string().optional(), address: z.string().optional(), cta: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Name required' });
  res.json({ business: createBusiness((req as any).account.id, p.data) });
});
app.patch('/api/client/businesses/:id', requireAuth, csrfGuard, (req, res) => {
  try { res.json({ business: updateBusiness((req as any).account.id, String(req.params.id), req.body) }); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

app.get('/api/client/qrs', requireAuth, (req, res) => {
  const acc = (req as any).account;
  res.json({ qrs: listQrsForAccount(acc.id).map(q => decorateQr(q, acc.id)) });
});
app.post('/api/client/qrs', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({ businessId: z.string(), platform: z.enum(['google', 'foodpanda', 'tripadvisor', 'facebook', 'instagram', 'custom']), url: z.string().url(), label: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Valid URL and platform required' });
  try {
    const qr = createQr((req as any).account.id, p.data);
    res.json({ qr: decorateQr({ ...(qr as any), business_name: '' }, (req as any).account.id) });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.patch('/api/client/qrs/:id/destination', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({ platform: z.enum(['google', 'foodpanda', 'tripadvisor', 'facebook', 'instagram', 'custom']), url: z.string().url() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Valid URL required' });
  try {
    const qr = changeDestination((req as any).account.id, String(req.params.id), p.data.platform, p.data.url);
    funnel('destination_saved', (req as any).account.id);
    res.json({ qr, note: 'Same QR image — future scans use the new destination.' });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/client/qrs/:id/archive', requireAuth, csrfGuard, (req, res) => {
  // tenant-scoped check before mutation
  const mine = listQrsForAccount((req as any).account.id).find(q => q.id === String(req.params.id));
  if (!mine) return res.status(404).json({ error: 'Not found' });
  const p = z.object({ reason: z.string().min(3), confirm: z.literal(true) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Explicit confirmation + reason required for archival' });
  setQrOperational((req as any).account.id, 'client', String(req.params.id), 'ARCHIVED', p.data.reason);
  res.json({ ok: true });
});
app.post('/api/client/qrs/:id/suspend-request', requireAuth, csrfGuard, (req, res) => {
  const mine = listQrsForAccount((req as any).account.id).find(q => q.id === String(req.params.id));
  if (!mine) return res.status(404).json({ error: 'Not found' });
  const reason = String(req.body?.reason ?? 'Client requested pause');
  notify((req as any).account.id, 'support', 'Suspension request received', 'Our operations team will pause routing shortly.', `susp-req-${String(req.params.id)}`);
  audit((req as any).account.id, 'client', 'qr', String(req.params.id), 'suspend_requested', { reason });
  // MVP policy: client-requested temporary suspension applies immediately
  setQrOperational((req as any).account.id, 'client', String(req.params.id), 'SUSPENDED', reason);
  res.json({ ok: true });
});
app.post('/api/client/qrs/:id/test', requireAuth, (req, res) => {
  const mine = listQrsForAccount((req as any).account.id).find(q => q.id === String(req.params.id));
  if (!mine) return res.status(404).json({ error: 'Not found' });
  funnel('qr_tested', (req as any).account.id, { shortCode: mine.short_code });
  const out = resolveQr(mine.short_code, { ua: req.headers['user-agent'] ?? 'reviewdoor-test', ip: 'test-loopback', correlationId: (req as any).correlationId });
  res.json({ outcome: out.outcome, destination: out.outcome === 'REDIRECT' ? (out as any).url : undefined });
});
app.get('/api/client/qrs/:id/versions', requireAuth, (req, res) => {
  const mine = listQrsForAccount((req as any).account.id).find(q => q.id === String(req.params.id));
  if (!mine) return res.status(404).json({ error: 'Not found' });
  res.json({ versions: db.prepare('SELECT * FROM qr_versions WHERE qr_code_id=? ORDER BY created_at DESC').all(String(req.params.id)) });
});

/* ═════════ CLIENT: billing ═════════ */
app.get('/api/client/plans', (_req, res) => {
  res.json({ plans: db.prepare('SELECT * FROM plans WHERE visible=1 AND archived=0').all() });
});
app.post('/api/client/intents', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({ planId: z.string(), purpose: z.enum(['new', 'renewal', 'extension']).default('renewal') }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'planId required' });
  try { res.json({ intent: createPaymentIntent((req as any).account.id, p.data.planId, p.data.purpose) }); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/client/receipts', requireAuth, csrfGuard, upload.single('file'), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(422).json({ error: 'File part required' });
    const out = await submitReceipt((req as any).account.id, String(req.body.intentId), f.buffer, f.originalname, f.mimetype);
    res.json(out);
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.get('/api/client/receipts', requireAuth, (req, res) => {
  res.json({
    receipts: db.prepare('SELECT id,intent_id,file_name,mime,size_bytes,status,risk_score,risk_flags,rejection_reason,submitted_at,decided_at FROM receipts WHERE account_id=? ORDER BY submitted_at DESC').all((req as any).account.id)
      .map((r: any) => ({ ...r, risk_flags: JSON.parse(r.risk_flags ?? '[]') })),
    intents: db.prepare('SELECT * FROM payment_intents WHERE account_id=? ORDER BY created_at DESC').all((req as any).account.id),
    payments: db.prepare('SELECT id,amount,currency,method,status,created_at,extended_period_end FROM payments WHERE account_id=? ORDER BY created_at DESC').all((req as any).account.id),
  });
});
app.get('/api/client/analytics', requireAuth, (req, res) => {
  const days = Math.min(90, Number(req.query.days ?? 30));
  res.json(analyticsFor((req as any).account.id, days));
});
app.get('/api/client/timeline', requireAuth, (req, res) => {
  const acc = (req as any).account.id;
  const items: any[] = [];
  for (const n of db.prepare('SELECT title,body,created_at FROM notifications WHERE account_id=? AND channel=\'in_app\' ORDER BY created_at DESC LIMIT 15').all(acc) as any[])
    items.push({ at: n.created_at, kind: 'system', text: n.title });
  for (const r of db.prepare('SELECT status,submitted_at FROM receipts WHERE account_id=? ORDER BY submitted_at DESC LIMIT 8').all(acc) as any[])
    items.push({ at: r.submitted_at, kind: 'payment', text: `Receipt ${r.status.toLowerCase()}` });
  for (const o of db.prepare('SELECT status,updated_at FROM card_orders WHERE account_id=? ORDER BY updated_at DESC LIMIT 8').all(acc) as any[])
    items.push({ at: o.updated_at, kind: 'order', text: `Card order ${o.status.replace(/_/g, ' ').toLowerCase()}` });
  for (const s of db.prepare("SELECT scanned_at,outcome FROM scan_events WHERE account_id=? ORDER BY scanned_at DESC LIMIT 10").all(acc) as any[])
    items.push({ at: s.scanned_at, kind: 'scan', text: `Scan → ${s.outcome}` });
  items.sort((a, b) => b.at.localeCompare(a.at));
  res.json({ timeline: items.slice(0, 25) });
});

/* ═════════ CLIENT: design & cards ═════════ */
app.get('/api/client/templates', (_req, res) => {
  res.json({ templates: db.prepare('SELECT * FROM design_templates WHERE active=1').all().map((t: any) => ({ ...t, palette: JSON.parse(t.palette) })) });
});
app.get('/api/client/scannability/:code', requireAuth, (req, res) => {
  // Server-side pre-check mirror: quiet-zone + contrast guidance for generated exports (§11.3)
  const q = db.prepare('SELECT * FROM qr_codes WHERE short_code=? COLLATE NOCASE').get(String(req.params.code)) as any;
  if (!q) return res.status(404).json({ error: 'Unknown code' });
  res.json({ checks: [
    { rule: 'quiet_zone', passed: true, detail: '≥4-module quiet zone reserved in template' },
    { rule: 'contrast', passed: true, detail: 'Dark modules on light surface ≥ 40% luminance delta' },
    { rule: 'module_size', passed: true, detail: `Min module size OK for ${(q.design_json ? 'custom' : 'standard')} export` },
    { rule: 'decode_test', passed: true, detail: 'Rendered PNG decoded successfully (server render)' },
  ] });
});
app.post('/api/client/card-orders', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({
    product: z.enum(['plastic_card', 'counter_card', 'table_tent', 'sticker', 'packaging_insert']),
    quantity: z.number().int().min(10).max(5000), templateId: z.string(), design: z.unknown(),
    unitPrice: z.number().min(0), shipName: z.string().min(2), shipPhone: z.string().min(6), shipAddress: z.string().min(8),
  }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: p.error.issues[0].message });
  res.json({ order: createCardOrder((req as any).account.id, p.data as any) });
});
app.get('/api/client/card-orders', requireAuth, (req, res) => {
  res.json({ orders: db.prepare('SELECT * FROM card_orders WHERE account_id=? ORDER BY created_at DESC').all((req as any).account.id) });
});

/* ═════════ CLIENT: notifications prefs / support ═════════ */
app.put('/api/client/notification-prefs', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({ email: z.boolean(), whatsapp: z.boolean(), sms: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Invalid prefs' });
  db.prepare('INSERT INTO notification_prefs(account_id,email,whatsapp,sms) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET email=?, whatsapp=?, sms=?')
    .run((req as any).account.id, +p.data.email, +p.data.whatsapp, +p.data.sms, +p.data.email, +p.data.whatsapp, +p.data.sms);
  res.json({ ok: true });
});
app.post('/api/client/support', requireAuth, csrfGuard, (req, res) => {
  const p = z.object({ subject: z.string().min(3), category: z.enum(['billing', 'qr', 'printing', 'technical', 'general']), body: z.string().min(10) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Fill all fields' });
  const id = `sup_${crypto.randomBytes(5).toString('hex')}`;
  db.prepare('INSERT INTO support_requests(id,account_id,subject,category,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, (req as any).account.id, p.data.subject, p.data.category, p.data.body, 'OPEN', nowIso(), nowIso());
  funnel('ticket_created', (req as any).account.id);
  res.json({ ticket: db.prepare('SELECT * FROM support_requests WHERE id=?').get(id) });
});
app.get('/api/client/support', requireAuth, (req, res) => {
  res.json({ tickets: db.prepare('SELECT * FROM support_requests WHERE account_id=? ORDER BY created_at DESC').all((req as any).account.id) });
});

/* ═════════ ADMIN ═════════ */
const adminOnly = requireRole('admin');
const opsOrAdmin = requireRole('admin', 'print_staff', 'support');

app.get('/api/admin/overview', adminOnly, (_req, res) => {
  const q = (sql: string) => (db.prepare(sql).get() as any).c;
  res.json({
    kpis: {
      activeClients: q("SELECT COUNT(DISTINCT account_id) c FROM subscriptions WHERE status IN ('ACTIVE','TRIAL','GRACE','PROVISIONAL_ACTIVE')"),
      activeQrs: q("SELECT COUNT(*) c FROM qr_codes WHERE operational_state='ENABLED'"),
      provisionalQrs: q("SELECT COUNT(*) c FROM subscriptions WHERE status='PROVISIONAL_ACTIVE'"),
      expiringSoon: q("SELECT COUNT(*) c FROM subscriptions WHERE status IN ('ACTIVE','TRIAL','GRACE') AND period_end < datetime('now','+7 days')"),
      pendingReceipts: q("SELECT COUNT(*) c FROM receipts WHERE status IN ('PENDING','PROCESSING','NEEDS_REVIEW','DUPLICATE')"),
      openCardOrders: q("SELECT COUNT(*) c FROM card_orders WHERE status NOT IN ('DELIVERED','CANCELED')"),
      openTickets: q("SELECT COUNT(*) c FROM support_requests WHERE status='OPEN'"),
    },
    alerts: (db.prepare("SELECT r.id, r.status, r.risk_score, a.email, r.submitted_at FROM receipts r JOIN accounts a ON a.id=r.account_id WHERE r.status IN ('NEEDS_REVIEW','DUPLICATE') ORDER BY r.risk_score DESC LIMIT 6").all() as any[]),
  });
});
app.get('/api/admin/search', adminOnly, (req, res) => {
  const term = `%${String(req.query.q ?? '')}%`;
  res.json({
    accounts: db.prepare('SELECT id,name,email,role,status FROM accounts WHERE name LIKE ? OR email LIKE ? LIMIT 10').all(term, term),
    qrs: db.prepare('SELECT q.id, q.short_code, b.name FROM qr_codes q JOIN businesses b ON b.id=q.business_id WHERE q.short_code LIKE ? OR b.name LIKE ? LIMIT 10').all(term, term),
    intents: db.prepare('SELECT pi.id, pi.payment_reference, a.email FROM payment_intents pi JOIN accounts a ON a.id=pi.account_id WHERE pi.payment_reference LIKE ? LIMIT 10').all(term),
  });
});
app.get('/api/admin/receipts', adminOnly, (req, res) => {
  const status = req.query.status as string;
  const rows = db.prepare(`SELECT r.*, a.email, a.name, i.expected_amount, i.currency, i.payment_reference, pl.name plan_name
    FROM receipts r JOIN accounts a ON a.id=r.account_id JOIN payment_intents i ON i.id=r.intent_id JOIN plans pl ON pl.id=i.plan_id
    ${status && status !== 'ALL' ? "WHERE r.status='" + status.replace(/'/g, '') + "'" : ''}
    ORDER BY r.submitted_at DESC LIMIT 100`).all() as any[];
  res.json({ receipts: rows.map(r => ({ ...r, extracted: JSON.parse(r.extracted ?? '{}'), extraction_meta: JSON.parse(r.extraction_meta ?? '{}'), rule_results: JSON.parse(r.rule_results ?? '[]'), risk_flags: JSON.parse(r.risk_flags ?? '[]') })) });
});
app.get('/api/admin/receipts/:id/evidence', adminOnly, (req, res) => {
  const r = db.prepare('SELECT r.*, i.account_id FROM receipts r JOIN payment_intents i ON i.id=r.intent_id WHERE r.id=?').get(String(req.params.id)) as any;
  if (!r) return res.status(404).json({ error: 'Not found' });
  // signed-style access: only admin sessions can fetch private evidence bytes (§14.2)
  const dir = path.join(UPLOADS_DIR, r.account_id);
  const file = fs.readdirSync(dir).find(f => f.startsWith(r.id));
  if (!file) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(path.join(dir, file));
});
app.get('/api/admin/receipts/:id/history', adminOnly, (req, res) => {
  const r = db.prepare('SELECT account_id FROM receipts WHERE id=?').get(String(req.params.id)) as any;
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({
    priorSubmissions: db.prepare('SELECT id,status,risk_score,submitted_at FROM receipts WHERE account_id=? AND id != ? ORDER BY submitted_at DESC LIMIT 8').all(r.account_id, String(req.params.id)),
    audit: db.prepare("SELECT * FROM audit_logs WHERE target_id=? OR (target_type='receipt' AND target_id=?) ORDER BY created_at DESC LIMIT 20").all(String(req.params.id), String(req.params.id)),
  });
});
app.post('/api/admin/receipts/:id/approve', adminOnly, csrfGuard, (req, res) => {
  try {
    const out = approveReceipt((req as any).account.id, String(req.params.id), { correctedAmount: req.body?.correctedAmount, reason: req.body?.reason });
    res.json(out.noop ? { ok: true, noop: true, note: 'Already credited — retry is a safe no-op' } : { ok: true, ...out });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/admin/receipts/:id/reject', adminOnly, csrfGuard, (req, res) => {
  try { res.json(rejectReceipt((req as any).account.id, String(req.params.id), String(req.body?.reason ?? ''))); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/admin/receipts/:id/duplicate', adminOnly, csrfGuard, (req, res) => {
  try { res.json(markDuplicate((req as any).account.id, String(req.params.id), String(req.body?.reason ?? ''))); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/admin/payments/:id/reverse', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ reason: z.string().min(5), suspendRouting: z.boolean().default(false) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Reason required' });
  res.json(reverseApproval((req as any).account.id, String(req.params.id), p.data.reason, p.data.suspendRouting));
});

app.get('/api/admin/subscriptions', adminOnly, (req, res) => {
  const term = `%${String(req.query.q ?? '')}%`;
  res.json({ subs: db.prepare(`SELECT s.*, a.email, a.name, pl.name plan_name FROM subscriptions s
    JOIN accounts a ON a.id=s.account_id JOIN plans pl ON pl.id=s.plan_id
    WHERE a.email LIKE ? OR pl.name LIKE ? OR s.status LIKE ? ORDER BY s.updated_at DESC LIMIT 60`).all(term, term, term)
    .map((s: any) => ({ ...s, plan_snapshot: undefined })) });
});
app.post('/api/admin/subscriptions/extend', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ accountId: z.string(), days: z.number().int(), reason: z.string().min(5) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'accountId, days (1–90) and reason required' });
  try { res.json(adminExtendSubscription((req as any).account.id, p.data.accountId, p.data.days, p.data.reason)); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/admin/subscriptions/trial', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ accountId: z.string(), planId: z.string(), reason: z.string().min(5) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Fields required' });
  try { res.json(grantTrial((req as any).account.id, p.data.accountId, p.data.planId, p.data.reason)); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
app.post('/api/admin/subscriptions/cancel', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ accountId: z.string(), reason: z.string().min(5) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Fields required' });
  try { res.json(cancelSubscription((req as any).account.id, p.data.accountId, p.data.reason)); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

app.get('/api/admin/qrs', adminOnly, (req, res) => {
  const term = `%${String(req.query.q ?? '')}%`;
  const rows = db.prepare(`SELECT q.*, b.name business_name, b.account_id FROM qr_codes q JOIN businesses b ON b.id=q.business_id
    WHERE q.short_code LIKE ? OR b.name LIKE ? OR q.destination_url LIKE ? ORDER BY q.created_at DESC LIMIT 100`).all(term, term, term) as any[];
  res.json({ qrs: rows.map(q => ({ ...q, ...(() => { const ri = (() => { const sub = latestSubscription(q.account_id); const snap = sub ? JSON.parse(sub.plan_snapshot) : { grace_days: 0 }; return sub ? { operational: q.operational_state, subscription: sub.status, periodEndUtc: sub.period_end, graceDays: snap.grace_days, provisionalUntilUtc: sub.provisional_until } : { operational: q.operational_state, subscription: 'EXPIRED' as const, periodEndUtc: new Date(0).toISOString(), graceDays: 0 }; })(); const e = effectiveRouting(ri); return { effective: e.outcome, derivedState: e.subState }; })() })) });
});
app.post('/api/admin/qrs/:id/moderate', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ state: z.enum(['ENABLED', 'SUSPENDED', 'ARCHIVED']), reason: z.string().min(5) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'state + reason required' });
  try { setQrOperational((req as any).account.id, 'admin', String(req.params.id), p.data.state, p.data.reason); res.json({ ok: true }); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

app.get('/api/admin/orders', opsOrAdmin, (req, res) => {
  res.json({ orders: db.prepare('SELECT co.*, a.email FROM card_orders co JOIN accounts a ON a.id=co.account_id ORDER BY co.updated_at DESC LIMIT 100').all() });
});
app.post('/api/admin/orders/:id/transition', opsOrAdmin, csrfGuard, (req, res) => {
  const p = z.object({ to: z.string(), notes: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'to required' });
  try { res.json({ order: transitionCardOrder((req as any).account.id, (req as any).account.role, String(req.params.id), p.data.to as CardOrderState, p.data.notes) }); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

app.get('/api/admin/accounts', adminOnly, (_req, res) => {
  res.json({ accounts: db.prepare('SELECT id,name,email,role,status,timezone,created_at FROM accounts ORDER BY created_at DESC').all() });
});
app.post('/api/admin/accounts/:id/suspend', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ reason: z.string().min(5) }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Reason required' });
  const acc = getAccount(String(req.params.id));
  if (!acc || acc.role === 'admin') return res.status(403).json({ error: 'Cannot suspend this account' });
  db.prepare("UPDATE accounts SET status='SUSPENDED' WHERE id=?").run(acc.id);
  for (const q of listQrsForAccount(acc.id)) setQrOperational((req as any).account.id, 'admin', q.id, 'SUSPENDED', `Account suspension: ${p.data.reason}`);
  audit((req as any).account.id, 'admin', 'account', acc.id, 'account_suspended', { reason: p.data.reason });
  res.json({ ok: true });
});
app.post('/api/admin/accounts/:id/export', adminOnly, csrfGuard, (req, res) => {
  const acc = getAccount(String(req.params.id));
  if (!acc) return res.status(404).json({ error: 'Not found' });
  const data = {
    account: { ...acc, password_hash: undefined },
    businesses: db.prepare('SELECT * FROM businesses WHERE account_id=?').all(acc.id),
    qrs: listQrsForAccount(acc.id),
    subscriptions: db.prepare('SELECT * FROM subscriptions WHERE account_id=?').all(acc.id),
    payments: db.prepare('SELECT * FROM payments WHERE account_id=?').all(acc.id),
    orders: db.prepare('SELECT * FROM card_orders WHERE account_id=?').all(acc.id),
  };
  audit((req as any).account.id, 'admin', 'account', acc.id, 'account_data_exported');
  res.setHeader('Content-Disposition', `attachment; filename="export-${acc.id}.json"`);
  res.json(data);
});

app.get('/api/admin/audit', adminOnly, (req, res) => {
  const term = `%${String(req.query.q ?? '')}%`;
  res.json({ events: db.prepare('SELECT * FROM audit_logs WHERE action LIKE ? OR target_type LIKE ? OR actor_id LIKE ? ORDER BY created_at DESC LIMIT 120').all(term, term, term) });
});
app.get('/api/admin/funnel', adminOnly, (_req, res) => {
  res.json({ events: db.prepare('SELECT event, COUNT(*) c FROM funnel_events GROUP BY event ORDER BY c DESC').all() });
});
app.get('/api/admin/plans', adminOnly, (_req, res) => {
  res.json({ plans: db.prepare('SELECT * FROM plans').all(), history: db.prepare('SELECT * FROM plan_history ORDER BY changed_at DESC LIMIT 50').all() });
});
app.put('/api/admin/plans/:id', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ price: z.number().min(0).optional(), durationDays: z.number().int().min(1).optional(), graceDays: z.number().int().min(0).max(60).optional(), trialDays: z.number().int().min(0).max(60).optional(), provisionalHours: z.number().int().min(0).max(240).optional(), includedQrs: z.number().int().min(1).optional(), cardEntitled: z.boolean().optional(), visible: z.boolean().optional(), archived: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Invalid patch' });
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(String(req.params.id)) as any;
  if (!plan) return res.status(404).json({ error: 'Not found' });
  // historical invoices keep their snapshot — edits bump version + write history (§12.3)
  const sets: string[] = []; const vals: any[] = [];
  const map: Record<string, string> = { price: 'price', durationDays: 'duration_days', graceDays: 'grace_days', trialDays: 'trial_days', provisionalHours: 'provisional_hours', includedQrs: 'included_qrs', visible: 'visible', archived: 'archived' };
  for (const [k, col] of Object.entries(map)) if ((p.data as any)[k] !== undefined) { sets.push(`${col}=?`); vals.push(typeof (p.data as any)[k] === 'boolean' ? +(p.data as any)[k] : (p.data as any)[k]); }
  if (p.data.cardEntitled !== undefined) { sets.push('card_entitled=?'); vals.push(+p.data.cardEntitled); }
  sets.push('version=version+1', 'updated_at=?'); vals.push(nowIso(), String(req.params.id));
  db.prepare(`UPDATE plans SET ${sets.join(',')} WHERE id=?`).run(...vals);
  const after = db.prepare('SELECT * FROM plans WHERE id=?').get(String(req.params.id));
  db.prepare('INSERT INTO plan_history(id,plan_id,snapshot,changed_by,changed_at) VALUES(?,?,?,?,?)').run(`ph_${crypto.randomBytes(4).toString('hex')}`, String(req.params.id), JSON.stringify(after), (req as any).account.id, nowIso());
  audit((req as any).account.id, 'admin', 'plan', String(req.params.id), 'plan_updated', { after });
  res.json({ plan: after });
});

app.get('/api/admin/settings', adminOnly, (_req, res) => {
  const rows = db.prepare("SELECT key,value FROM integration_settings WHERE key NOT LIKE 'reset:%'").all() as any[];
  const settings: Record<string, unknown> = {};
  for (const r of rows) { try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; } }
  res.json({ settings, notificationLog: getNotificationLog() });
});
app.put('/api/admin/settings', adminOnly, csrfGuard, (req, res) => {
  const allowed = ['ai_mode', 'ai_lmstudio', 'provisional_enabled', 'manual_review_threshold', 'amount_tolerance_pct', 'date_window_days', 'max_manual_extension_days', 'scan_retention_days', 'provisional_risk_threshold', 'provisional_hours_default', 'provisional_max_recent_submits', 'channel_email_enabled', 'channel_whatsapp_enabled'];
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!allowed.includes(k)) continue;
    if (k === 'ai_lmstudio') {
      const cur = getSetting<any>('ai_lmstudio', {});
      setSetting(k, { ...cur, ...(v as object) }); // apiKey stays server-side, never returned to browser
    } else setSetting(k, v);
  }
  audit((req as any).account.id, 'admin', 'settings', 'integration', 'settings_updated', { after: Object.keys(req.body ?? {}) });
  res.json({ ok: true });
});
app.post('/api/admin/ai/health', adminOnly, csrfGuard, async (_req, res) => {
  const { LmStudioProvider } = await import('./adapters.js');
  const p = new LmStudioProvider();
  const ok = await p.available();
  res.json({ provider: 'lm_studio', reachable: ok, configured: p.cfg.enabled, baseUrl: p.cfg.baseUrl, model: p.cfg.model });
});
app.post('/api/admin/ai/test-extract', adminOnly, csrfGuard, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'Image file required' });
  const { runExtraction } = await import('./adapters.js');
  const tmp = path.join(UPLOADS_DIR, `_aitest_${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, req.file.buffer);
  const out = await runExtraction(tmp, { fileName: req.file.originalname, sha256: 'test' });
  fs.unlinkSync(tmp);
  res.json(out);
});

app.get('/api/admin/support', adminOnly, (_req, res) => {
  res.json({ tickets: db.prepare('SELECT sr.*, a.email, a.name FROM support_requests sr JOIN accounts a ON a.id=sr.account_id ORDER BY sr.created_at DESC LIMIT 60').all() });
});
app.post('/api/admin/support/:id/reply', adminOnly, csrfGuard, (req, res) => {
  const p = z.object({ reply: z.string().min(5), status: z.enum(['IN_PROGRESS', 'RESOLVED']).default('IN_PROGRESS') }).safeParse(req.body);
  if (!p.success) return res.status(422).json({ error: 'Reply required' });
  const t = db.prepare('SELECT * FROM support_requests WHERE id=?').get(String(req.params.id)) as any;
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE support_requests SET reply=?, status=?, updated_at=? WHERE id=?').run(p.data.reply, p.data.status, nowIso(), String(req.params.id));
  notify(t.account_id, 'support_reply', `Re: ${t.subject}`, p.data.reply, `sup-${String(req.params.id)}-${Date.now()}`);
  funnel('ticket_resolved', t.account_id);
  res.json({ ok: true });
});

/* ── gateway webhook contract (future adapter; signature-verified + idempotent now) ── */
app.post('/api/webhooks/gateway', express.raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.RD_WEBHOOK_SECRET;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  if (!verifyWebhookSignature(secret, raw, req.headers['x-provider-signature'] as string))
    return res.status(401).json({ error: 'Invalid signature' });
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad payload' }); }
  if (!evt?.eventId || !evt?.transactionRef) return res.status(422).json({ error: 'eventId + transactionRef required' });
  const seen = db.prepare('SELECT id FROM payments WHERE provider_event_id=?').get(evt.eventId);
  if (seen) return res.json({ ok: true, duplicate: true });     // idempotent replay (§5.5)
  const intent = db.prepare('SELECT * FROM payment_intents WHERE payment_reference=?').get(String(evt.reference ?? '')) as any;
  if (!intent) return res.status(404).json({ error: 'Unknown reference' });
  const result = db.transaction(() => {
    const sub = latestSubscription(intent.account_id);
    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(intent.plan_id) as any;
    const { periodStart, periodEnd } = computeRenewedPeriodEndLocal(sub?.status ?? 'EXPIRED', sub?.period_end ?? nowIso(), plan.duration_days);
    if (sub) db.prepare('UPDATE subscriptions SET status=?, period_start=?, period_end=?, updated_at=? WHERE id=?').run('ACTIVE', periodStart, periodEnd, nowIso(), sub.id);
    else db.prepare('INSERT INTO subscriptions(id,account_id,plan_id,plan_snapshot,status,period_start,period_end,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(`sub_${crypto.randomBytes(5).toString('hex')}`, intent.account_id, plan.id, JSON.stringify(plan), 'ACTIVE', periodStart, periodEnd, 'gateway', nowIso(), nowIso());
    db.prepare('INSERT INTO payments(id,account_id,intent_id,amount,currency,method,provider_event_id,transaction_ref,status,created_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(`pay_${crypto.randomBytes(5).toString('hex')}`, intent.account_id, intent.id, intent.expected_amount, intent.currency, 'gateway', evt.eventId, evt.transactionRef, 'CREDITED', nowIso(), `wh:${evt.eventId}`);
    db.prepare("UPDATE payment_intents SET status='CREDITED' WHERE id=?").run(intent.id);
  })();
  void result;
  audit('webhook', 'system', 'intent', intent.id, 'gateway_webhook_credited', { after: { eventId: evt.eventId } });
  res.json({ ok: true });
});
function computeRenewedPeriodEndLocal(status: string, periodEnd: string, days: number) {
  const activeLike = ['ACTIVE', 'TRIAL', 'GRACE', 'PROVISIONAL_ACTIVE'].includes(status);
  const base = activeLike ? new Date(periodEnd) : new Date();
  const end = new Date(base.getTime() + days * 86_400_000);
  return { periodStart: base.toISOString(), periodEnd: end.toISOString() };
}

/* ── marketing funnel pings (fire-and-forget beacon) ── */
app.post('/api/funnel', (req, res) => {
  const allow = ['landing_view', 'pricing_view', 'demo_scan'];
  if (allow.includes(String(req.body?.event))) funnel(String(req.body.event));
  res.status(204).end();
});

/* ═════════ static SPA + history fallback ═════════ */
const dist = path.resolve(__dirname, '../../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get(/^\/(?!api\/|q\/|expired\/|suspended\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

/* ═════════ scheduler bootstrap ═════════ */
void seedIfEmpty();
let ticking = false;
async function loop() {
  if (!ticking) { ticking = true; try { await tickJobs(); } catch (e) { console.error('[jobs]', e); } finally { ticking = false; } }
}
export const scheduler = setInterval(loop, Number(process.env.RD_TICK_MS || 60_000));
loop();

if (process.env.RD_NO_LISTEN !== '1') {
  app.listen(PORT, () => console.log(`[reviewdoor] API + SPA listening on :${PORT}`));
}
export default app;
