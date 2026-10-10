/**
 * ReviewDoor — Server-side domain engine (pure functions, no I/O).
 * Centralizes every subscription/routing/verification rule so they are never
 * duplicated in page components (NFR-09) and can be unit-tested directly (§19.1).
 */

export type OperationalState = 'ENABLED' | 'SUSPENDED' | 'ARCHIVED';
export type SubscriptionState =
  | 'TRIAL' | 'PROVISIONAL_ACTIVE' | 'ACTIVE' | 'GRACE'
  | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';
export type ReceiptState = 'PENDING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'DUPLICATE';
export type CardOrderState =
  | 'NEW' | 'DESIGN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'
  | 'PRINTING' | 'SHIPPED' | 'DELIVERED' | 'CANCELED' | 'PRINT_FAILED' | 'RETURNED';
export type RoutingOutcome = 'REDIRECT' | 'EXPIRED' | 'SUSPENDED' | 'NOT_FOUND' | 'ERROR';

/* ─────────────── Effective routing state (single authoritative calc, SRS §5.1) ─────────────── */

export interface RoutingInput {
  operational: OperationalState;
  subscription: SubscriptionState;
  periodEndUtc: string;            // end of paid/trial period (UTC)
  graceDays: number;               // plan-configurable grace window
  provisionalUntilUtc?: string | null;
  graceAccessEnabled?: boolean;    // policy: does grace still route? (default true)
}

export function derivedSubscriptionState(input: RoutingInput, now = new Date()): SubscriptionState {
  const s = input.subscription;
  if (s === 'CANCELED' || s === 'SUSPENDED_PLACEHOLDER' as never) return s === 'CANCELED' ? 'CANCELED' : s;
  if (s === 'ACTIVE' || s === 'TRIAL') {
    if (new Date(input.periodEndUtc) > now) return s;
    const graceOn = input.graceAccessEnabled !== false && input.graceDays > 0;
    const graceEnd = addDays(new Date(input.periodEndUtc), input.graceDays);
    if (graceOn && now < graceEnd) return 'GRACE';
    return 'EXPIRED';
  }
  if (s === 'PROVISIONAL_ACTIVE') {
    if (input.provisionalUntilUtc && new Date(input.provisionalUntilUtc) > now) return 'PROVISIONAL_ACTIVE';
    return 'PAST_DUE'; // provisional lapsed while awaiting decision
  }
  if (s === 'GRACE') {
    const graceEnd = addDays(new Date(input.periodEndUtc), input.graceDays);
    return now < graceEnd ? 'GRACE' : 'EXPIRED';
  }
  if (s === 'PAST_DUE') {
    // PAST_DUE may recover into GRACE display only via admin; stays past due → inactive per policy
    return 'PAST_DUE';
  }
  return s; // EXPIRED / CANCELED are terminal until renewal
}

export function effectiveRouting(input: RoutingInput, now = new Date()): { outcome: RoutingOutcome; subState: SubscriptionState } {
  if (input.operational === 'ARCHIVED') return { outcome: 'NOT_FOUND', subState: input.subscription };
  if (input.operational === 'SUSPENDED') return { outcome: 'SUSPENDED', subState: input.subscription };
  const sub = derivedSubscriptionState(input, now);
  switch (sub) {
    case 'TRIAL':
    case 'ACTIVE':
    case 'GRACE':
    case 'PROVISIONAL_ACTIVE':
      return { outcome: 'REDIRECT', subState: sub };
    default:
      return { outcome: 'EXPIRED', subState: sub };
  }
}

/* ─────────────── Renewal calculation (Design §6.1 / SRS §5.4) ─────────────── */

export function computeRenewedPeriodEnd(
  currentStatus: SubscriptionState,
  currentPeriodEndUtc: string,
  durationDays: number,
  now = new Date(),
): { periodStart: Date; periodEnd: Date } {
  const activeLike = currentStatus === 'ACTIVE' || currentStatus === 'TRIAL' || currentStatus === 'GRACE' || currentStatus === 'PROVISIONAL_ACTIVE';
  if (activeLike) {
    // extend from current period end — never reset to "today + duration"
    return { periodStart: new Date(currentPeriodEndUtc), periodEnd: addDays(new Date(currentPeriodEndUtc), durationDays, now) };
  }
  // expired/canceled/past-due renewal starts from effective renewal time
  return { periodStart: now, periodEnd: addDays(now, durationDays) };
}

export function addDays(d: Date, days: number, clampAfter?: Date): Date {
  const r = new Date(d.getTime() + days * 86_400_000);
  if (clampAfter && r < clampAfter) return new Date(clampAfter); // grace never shortens a new period
  return r;
}

/* ─────────────── URL validation (FR-06: warn, don't over-promise) ─────────────── */

const PLATFORM_PATTERNS: Record<string, RegExp> = {
  google: /^https:\/\/(www\.google\.com|maps\.app\.goo\.gl|g\.page)\//i,
  foodpanda: /^https:\/\/(\w+\.)?foodpanda\./i,
  tripadvisor: /^https:\/\/(www\.)?tripadvisor\./i,
  facebook: /^https:\/\/(www\.|m\.)?facebook\.com\//i,
  instagram: /^https:\/\/(www\.)?instagram\.com\//i,
  custom: /^https?:\/\//i,
};

// Configurable block-list for open-redirect abuse prevention (SRS §6.2)
const BLOCKED_HOSTS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.su', 'is.gd'];

export function validateDestination(platform: string, urlRaw: string): { ok: boolean; status: 'VALID' | 'FORMAT_ONLY' | 'INVALID'; message: string } {
  const url = urlRaw.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, status: 'INVALID', message: 'Enter a full web address starting with https://' }; }
  if (!['http:', 'https:'].includes(parsed.protocol))
    return { ok: false, status: 'INVALID', message: 'Only http/https destinations are allowed.' };
  if (parsed.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) || parsed.hostname.endsWith('.internal'))
    return { ok: false, status: 'INVALID', message: 'Internal or IP-literal addresses are not allowed.' };
  if (BLOCKED_HOSTS.includes(parsed.hostname))
    return { ok: false, status: 'INVALID', message: 'Shortened URLs are blocked to keep scan destinations transparent.' };
  const re = PLATFORM_PATTERNS[platform] ?? PLATFORM_PATTERNS.custom;
  if (!re.test(url))
    return { ok: true, status: 'FORMAT_ONLY', message: `Format is valid but doesn’t match the usual ${platform} pattern — double-check you pasted the review link.` };
  return { ok: true, status: 'VALID', message: 'Format verified. Third-party availability can’t be guaranteed by us.' };
}

/* ─────────────── Short codes: random, non-predictable, unambiguous alphabet ─────────────── */

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0O1lI
export function generateShortCode(len = 7, rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return s;
}

/* ─────────────── Payment reference generation (SRS §7.1) ─────────────── */
export function generatePaymentReference(accountSeed: string, planCode: string, seq: number, rnd: () => number = Math.random): string {
  const a = accountSeed.slice(0, 3).toUpperCase();
  const r = Math.floor(rnd() * 900000 + 100000);
  return `RD-${a}-${planCode.toUpperCase().slice(0, 4)}-${r}${seq % 10}`;
}

/* ─────────────── Receipt rule checks (SRS §7.4) — deterministic authority ─────────────── */

export interface ExtractedField { value: string; confidence: number }
export interface ExtractedReceipt {
  amount?: ExtractedField; currency?: ExtractedField; payment_date?: ExtractedField;
  transaction_id?: ExtractedField; reference?: ExtractedField; sender_name?: ExtractedField;
  payee_name?: ExtractedField; channel?: ExtractedField; receipt_number?: ExtractedField;
  quality?: ExtractedField; warnings?: string[];
}

export interface RuleCheck { rule: string; passed: boolean; detail: string }
export interface ExpectedPayment {
  amount: number; currency: string; tolerancePct: number;
  submissionWindowDays: number; generatedReference?: string | null;
  knownTxnRefs: string[]; knownSha256: string[]; sha256: string; fingerprint: string;
  sameAccountRecentSubmits: number;
}

export function runRuleChecks(ex: ExtractedReceipt, exp: ExpectedPayment, now = new Date()): { checks: RuleCheck[]; riskFlags: string[]; riskScore: number } {
  const checks: RuleCheck[] = [];
  const flags: string[] = [];
  const push = (rule: string, passed: boolean, detail: string, risky = false) => {
    checks.push({ rule, passed, detail });
    if (!passed && risky) flags.push(rule);
  };

  const amt = ex.amount?.value != null ? Number(ex.amount.value.replace(/[^0-9.]/g, '')) : NaN;
  if (Number.isFinite(amt)) {
    const diffPct = Math.abs(amt - exp.amount) / exp.amount * 100;
    push('amount_match', diffPct <= exp.tolerancePct, `Detected ${amt.toLocaleString()} vs expected ${exp.amount.toLocaleString()} (${diffPct.toFixed(1)}% off, tolerance ${exp.tolerancePct}%)`, true);
  } else push('amount_match', false, 'Amount not detected on receipt', true);

  const cur = ex.currency?.value?.toUpperCase();
  if (cur) push('currency_match', cur === exp.currency.toUpperCase(), `Detected ${cur}, plan currency ${exp.currency}`, true);
  else push('currency_match', false, 'Currency not detected', false);

  if (ex.payment_date?.value) {
    const d = new Date(ex.payment_date.value);
    const days = (now.getTime() - d.getTime()) / 86_400_000;
    push('date_window', !Number.isNaN(+d) && days <= exp.submissionWindowDays && days >= -2, `Payment date ${ex.payment_date.value}; window ±${exp.submissionWindowDays} days`, true);
  } else push('date_window', false, 'Payment date not detected', true);

  const txn = ex.transaction_id?.value?.trim();
  if (txn) {
    const dupe = exp.knownTxnRefs.includes(txn);
    push('txn_unique', !dupe, dupe ? `Transaction ID ${txn} already credited once` : `Transaction ID present and unused`, true);
  } else push('txn_required', false, 'No transaction/reference ID detected (required)', true);

  if (exp.generatedReference) {
    const ref = (ex.reference?.value || txn || '').toUpperCase().replace(/\s/g, '');
    const gen = exp.generatedReference.toUpperCase().replace(/\s/g, '');
    push('reference_match', ref.includes(gen.slice(-6)) || gen.includes(ref.slice(-6)) || ref === gen,
      `Generated reference ${exp.generatedReference} vs detected "${ex.reference?.value || txn || '—'}"`, true);
  }

  const hashDupe = exp.knownSha256.includes(exp.sha256);
  push('file_not_duplicate', !hashDupe, hashDupe ? 'Identical file hash already uploaded & credited' : 'File hash unseen', true);

  const q = (ex.quality?.value || '').toLowerCase();
  push('readability', q === 'readable' || q === '', `Image quality: ${q || 'not assessed'}`, true);

  if (ex.sender_name && (ex.sender_name.confidence ?? 1) < 0.5) flags.push('low_confidence_sender');
  if ((ex.amount?.confidence ?? 1) < 0.6) flags.push('low_confidence_amount');
  if (exp.sameAccountRecentSubmits >= 5) { flags.push('submission_rate_high'); }
  if (ex.warnings?.length) flags.push(...ex.warnings.map(w => `ai_warning:${w}`));

  let score = flags.length * 20 + checks.filter(c => !c.passed).length * 10;
  score = Math.min(100, score);
  return { checks, riskFlags: [...new Set(flags)], riskScore: score };
}

/** Provisional eligibility gate (SRS §5.3): deny when duplicates/risk above threshold */
export function provisionalAllowed(riskScore: number, flags: string[], threshold = 60): boolean {
  if (flags.includes('file_not_duplicate') || flags.includes('txn_unique')) return false; // hard duplicate
  return riskScore < threshold;
}

/* ─────────────── AI output contract validation (SRS §17.3) ─────────────── */
export function validateAiExtraction(raw: unknown): { ok: boolean; value?: ExtractedReceipt; error?: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'AI response is not an object' };
  const r = raw as Record<string, unknown>;
  const out: ExtractedReceipt = {};
  const fieldKeys = ['amount', 'currency', 'payment_date', 'transaction_id', 'reference', 'sender_name', 'payee_name', 'channel', 'receipt_number', 'quality'] as const;
  for (const k of fieldKeys) {
    const f = r[k];
    if (f == null) continue;
    if (typeof f !== 'object') return { ok: false, error: `Field ${k} must be {value, confidence}` };
    const fo = f as Record<string, unknown>;
    if (typeof fo.value !== 'string' && typeof fo.value !== 'number') return { ok: false, error: `Field ${k}.value missing` };
    const conf = typeof fo.confidence === 'number' ? fo.confidence : 0.5;
    (out as any)[k] = { value: String(fo.value), confidence: Math.max(0, Math.min(1, conf)) };
  }
  if (Array.isArray(r.warnings)) out.warnings = r.warnings.filter(x => typeof x === 'string');
  return { ok: true, value: out };
}

/* ─────────────── Notification schedule (SRS §10.3) ─────────────── */
export function reminderDaysDue(periodEndUtc: string, lastSentDays: Set<number>, now = new Date()): number[] {
  const daysLeft = Math.ceil((new Date(periodEndUtc).getTime() - now.getTime()) / 86_400_000);
  const schedule = [14, 7, 3, 1];
  return schedule.filter(d => d === daysLeft && !lastSentDays.has(d));
}

/* ─────────────── Card order workflow (SRS §11.4) ─────────────── */
const ORDER_TRANSITIONS: Record<CardOrderState, CardOrderState[]> = {
  NEW: ['DESIGN_REVIEW', 'CANCELED'],
  DESIGN_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'CANCELED'],
  CHANGES_REQUESTED: ['DESIGN_REVIEW', 'CANCELED'],
  APPROVED: ['PRINTING', 'CANCELED'],
  PRINTING: ['SHIPPED', 'PRINT_FAILED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: [], RETURNED: ['DESIGN_REVIEW'], CANCELED: [], PRINT_FAILED: ['PRINTING'],
};
export function canTransition(from: CardOrderState, to: CardOrderState): boolean {
  return (ORDER_TRANSITIONS[from] || []).includes(to);
}

export const money = (n: number, cur = 'PKR') => `${cur} ${n.toLocaleString('en-US')}`;
