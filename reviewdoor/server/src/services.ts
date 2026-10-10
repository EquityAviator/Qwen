/**
 * ReviewDoor — Service layer. Every mutation goes through here so business rules
 * stay centralized (NFR-09), writes are transactional + idempotent (NFR-11),
 * and every sensitive admin action is audited (§2.1).
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, uid, nowIso, getSetting, setSetting, UPLOADS_DIR } from './db.js';
import {
  effectiveRouting, derivedSubscriptionState, computeRenewedPeriodEnd, validateDestination,
  generateShortCode, generatePaymentReference, runRuleChecks, provisionalAllowed, canTransition,
  type SubscriptionState, type CardOrderState, type RoutingInput,
} from './domain.js';
import { runExtraction, sha256, perceptualFingerprint, validateUpload, notifyAdapters } from './adapters.js';

/* ─────────── audit ─────────── */
export function audit(actorId: string, actorRole: string, targetType: string, targetId: string, action: string, opts: { reason?: string; before?: unknown; after?: unknown; outcome?: string } = {}) {
  db.prepare(`INSERT INTO audit_logs(id,actor_id,actor_role,target_type,target_id,action,reason,before_summary,after_summary,outcome,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid('aud'), actorId, actorRole, targetType, targetId, action, opts.reason ?? null,
      opts.before ? JSON.stringify(opts.before).slice(0, 2000) : null,
      opts.after ? JSON.stringify(opts.after).slice(0, 2000) : null,
      opts.outcome ?? 'ok', nowIso());
}

export function funnel(event: string, accountId?: string | null, context?: unknown) {
  db.prepare('INSERT INTO funnel_events(id,event,account_id,context,created_at) VALUES(?,?,?,?,?)')
    .run(uid('fe'), event, accountId ?? null, context ? JSON.stringify(context).slice(0, 500) : null, nowIso());
}

/* ─────────── rate limiting (SRS §14.1) ─────────── */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const row = db.prepare('SELECT count,window_start FROM rate_buckets WHERE key=?').get(key) as { count: number; window_start: number } | undefined;
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT INTO rate_buckets(key,count,window_start) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=1, window_start=excluded.window_start').run(key, 1, now);
    return true;
  }
  if (row.count >= max) return false;
  db.prepare('UPDATE rate_buckets SET count=count+1 WHERE key=?').run(key);
  return true;
}

/* ─────────── accounts / auth ─────────── */
export interface AccountRow { id: string; name: string; email: string; phone: string | null; password_hash: string; role: string; status: string; timezone: string; created_at: string; verified: number }

export function findAccountByEmail(email: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE email = ? COLLATE NOCASE').get(email.trim().toLowerCase()) as any;
}
export function getAccount(id: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as any;
}

export function createAccount(input: { name: string; email: string; phone?: string; password: string; role?: string }) {
  if (findAccountByEmail(input.email)) throw Object.assign(new Error('An account with this email already exists'), { status: 409 });
  if (input.password.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 422 });
  const id = uid('acc');
  db.prepare('INSERT INTO accounts(id,name,email,phone,password_hash,role,status,timezone,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, input.name, input.email.trim().toLowerCase(), input.phone ?? null, bcrypt.hashSync(input.password, 11),
      input.role ?? 'client', 'ACTIVE', 'Asia/Karachi', nowIso());
  db.prepare('INSERT INTO notification_prefs(account_id) VALUES(?)').run(id);
  funnel('signup_completed', id);
  audit(id, input.role ?? 'client', 'account', id, 'account_created');
  return getAccount(id)!;
}

/* ─────────── subscription truth helpers ─────────── */
interface SubRow {
  id: string; account_id: string; plan_id: string; plan_snapshot: string; status: SubscriptionState;
  period_start: string; period_end: string; provisional_until: string | null;
  provisional_source_receipt_id: string | null; source: string; created_at: string; updated_at: string;
}
export function latestSubscription(accountId: string): SubRow | undefined {
  return db.prepare('SELECT * FROM subscriptions WHERE account_id=? ORDER BY updated_at DESC LIMIT 1').get(accountId) as any;
}
function planOf(planId: string) {
  return db.prepare('SELECT * FROM plans WHERE id=?').get(planId) as any;
}
export function routingInputFor(accountId: string): RoutingInput | null {
  const sub = latestSubscription(accountId);
  if (!sub) return null;
  const snap = JSON.parse(sub.plan_snapshot);
  return { operational: 'ENABLED', subscription: sub.status, periodEndUtc: sub.period_end, graceDays: snap.grace_days ?? 7, provisionalUntilUtc: sub.provisional_until };
}

/** Recompute derived state and persist transitions (idempotent — only writes on change). */
export function refreshSubscriptionStatus(accountId: string, now = new Date()): SubscriptionState | null {
  const sub = latestSubscription(accountId);
  if (!sub) return null;
  const ri = routingInputFor(accountId)!;
  const derived = derivedSubscriptionState({ ...ri, subscription: sub.status }, now);
  if (derived !== sub.status) {
    db.prepare('UPDATE subscriptions SET status=?, provisional_until=CASE WHEN ?!=\'PROVISIONAL_ACTIVE\' THEN NULL ELSE provisional_until END, updated_at=? WHERE id=?')
      .run(derived, derived, now.toISOString(), sub.id);
    audit('system', 'system', 'subscription', sub.id, `status_${sub.status}_to_${derived}`, { reason: 'scheduled/scan-time derivation' });
  }
  return derived;
}

/* ─────────── businesses & QRs ─────────── */
export function createBusiness(accountId: string, input: { name: string; category?: string; contactEmail?: string; contactPhone?: string; address?: string; cta?: string }) {
  const id = uid('biz');
  db.prepare('INSERT INTO businesses(id,account_id,name,category,contact_email,contact_phone,address,cta,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, accountId, input.name, input.category ?? 'restaurant', input.contactEmail ?? null, input.contactPhone ?? null, input.address ?? null, input.cta ?? 'Rate us!', nowIso());
  funnel('business_created', accountId);
  return db.prepare('SELECT * FROM businesses WHERE id=?').get(id);
}
export function updateBusiness(accountId: string, bizId: string, patch: Partial<{ name: string; category: string; contactEmail: string; contactPhone: string; address: string; cta: string; logoPath: string }>) {
  const biz = db.prepare('SELECT * FROM businesses WHERE id=? AND account_id=?').get(bizId, accountId) as any;
  if (!biz) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare('UPDATE businesses SET name=?, category=?, contact_email=?, contact_phone=?, address=?, cta=?, logo_path=? WHERE id=?')
    .run(patch.name ?? biz.name, patch.category ?? biz.category, patch.contactEmail ?? biz.contact_email,
      patch.contactPhone ?? biz.contact_phone, patch.address ?? biz.address, patch.cta ?? biz.cta, patch.logoPath ?? biz.logo_path, bizId);
  audit(accountId, 'client', 'business', bizId, 'business_updated', { after: patch });
  return db.prepare('SELECT * FROM businesses WHERE id=?').get(bizId);
}

export function listQrsForAccount(accountId: string) {
  return db.prepare(`SELECT q.*, b.name business_name FROM qr_codes q JOIN businesses b ON b.id=q.business_id
    WHERE b.account_id=? ORDER BY q.created_at DESC`).all(accountId) as any[];
}

export function createQr(accountId: string, input: { businessId: string; platform: string; url: string; label?: string }) {
  const biz = db.prepare('SELECT * FROM businesses WHERE id=? AND account_id=?').get(input.businessId, accountId) as any;
  if (!biz) throw Object.assign(new Error('Business not found'), { status: 404 });
  const v = validateDestination(input.platform, input.url);
  if (!v.ok) throw Object.assign(new Error(v.message), { status: 422 });
  // plan entitlement: included QRs
  const sub = latestSubscription(accountId);
  const allowed = sub ? (JSON.parse(sub.plan_snapshot).included_qrs ?? 1) : 1;
  const existing = db.prepare('SELECT COUNT(*) c FROM qr_codes q JOIN businesses b ON b.id=q.business_id WHERE b.account_id=? AND q.operational_state != \'ARCHIVED\'').get(accountId) as any;
  if (existing.c >= allowed && !getSetting('qr_allow_trial_overage', true))
    throw Object.assign(new Error('QR limit reached for your plan'), { status: 403 });
  let code = generateShortCode();
  for (;;) {
    try {
      const id = uid('qr');
      db.prepare('INSERT INTO qr_codes(id,business_id,short_code,destination_url,destination_platform,last_known_good_url,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, biz.id, code, input.url.trim(), input.platform, input.url.trim(), nowIso());
      const destId = uid('dest');
      db.prepare('INSERT INTO review_destinations(id,business_id,qr_code_id,platform,label,url,validation_status,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(destId, biz.id, id, input.platform, input.label ?? 'Main reviews', input.url.trim(), v.status, nowIso());
      db.prepare('INSERT INTO qr_versions(id,qr_code_id,destination_url,changed_by,reason,created_at) VALUES(?,?,?,?,?,?)')
        .run(uid('qv'), id, input.url.trim(), accountId, 'initial', nowIso());
      funnel('qr_created', accountId, { shortCode: code });
      audit(accountId, 'client', 'qr', id, 'qr_created', { after: { shortCode: code, destination: input.url } });
      return db.prepare('SELECT * FROM qr_codes WHERE id=?').get(id);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE constraint failed: qr_codes.short_code')) { code = generateShortCode(); continue; }
      throw e;
    }
  }
}

export function changeDestination(accountId: string, qrId: string, platform: string, url: string) {
  const row = db.prepare(`SELECT q.*, b.account_id FROM qr_codes q JOIN businesses b ON b.id=q.business_id WHERE q.id=?`).get(qrId) as any;
  if (!row || row.account_id !== accountId) throw Object.assign(new Error('Not found'), { status: 404 });
  const v = validateDestination(platform, url);
  if (!v.ok) throw Object.assign(new Error(v.message), { status: 422 });
  // FR-19/A-03: same short code, new destination — printed QR never changes.
  db.prepare('UPDATE qr_codes SET destination_url=?, destination_platform=?, last_known_good_url=? WHERE id=?').run(url.trim(), platform, url.trim(), qrId);
  db.prepare('UPDATE review_destinations SET url=?, platform=?, validation_status=?, updated_at=? WHERE qr_code_id=?').run(url.trim(), platform, v.status, nowIso(), qrId);
  db.prepare('INSERT INTO qr_versions(id,qr_code_id,destination_url,changed_by,reason,created_at) VALUES(?,?,?,?,?,?)')
    .run(uid('qv'), qrId, url.trim(), accountId, 'destination_change', nowIso());
  funnel('destination_saved', accountId);
  audit(accountId, 'client', 'qr', qrId, 'destination_changed', { before: { url: row.destination_url }, after: { url } });
  return db.prepare('SELECT * FROM qr_codes WHERE id=?').get(qrId);
}

export function setQrOperational(actorId: string, actorRole: string, qrId: string, state: 'ENABLED' | 'SUSPENDED' | 'ARCHIVED', reason: string) {
  if (!reason?.trim() && state !== 'ENABLED') throw Object.assign(new Error('Reason required'), { status: 422 });
  const q = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(qrId) as any;
  if (!q) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare('UPDATE qr_codes SET operational_state=?, suspend_reason=?, archived_at=? WHERE id=?')
    .run(state, state === 'SUSPENDED' ? reason : null, state === 'ARCHIVED' ? nowIso() : null, qrId);
  audit(actorId, actorRole, 'qr', qrId, `qr_${state.toLowerCase()}`, { reason, before: { state: q.operational_state }, after: { state } });
}

/* ─────────── public resolver (SRS §6; NFR-01: lightweight, no dashboard deps) ─────────── */
export function resolveQr(shortCode: string, req: { ua: string; ip: string; referer?: string; correlationId: string }) {
  const q = db.prepare(`SELECT q.*, b.account_id, b.name business_name FROM qr_codes q JOIN businesses b ON b.id = q.business_id WHERE q.short_code = ? COLLATE NOCASE`).get(shortCode) as any;
  if (!q) return { outcome: 'NOT_FOUND' as const };
  const sub = latestSubscription(q.account_id);
  const snap = sub ? JSON.parse(sub.plan_snapshot) : { grace_days: 0 };
  const ri: RoutingInput = sub
    ? { operational: q.operational_state, subscription: sub.status, periodEndUtc: sub.period_end, graceDays: snap.grace_days ?? 0, provisionalUntilUtc: sub.provisional_until, graceAccessEnabled: snap.grace_access !== false }
    : { operational: q.operational_state, subscription: 'EXPIRED', periodEndUtc: new Date(0).toISOString(), graceDays: 0 };
  const { outcome, subState } = effectiveRouting(ri);
  // async-safe scan log: analytics failure must never block redirect (§18)
  try {
    const device = /android|iphone|ipad|mobile/i.test(req.ua) ? (/ipad|tablet/i.test(req.ua) ? 'tablet' : 'mobile') : 'desktop';
    const ipHash = crypto.createHmac('sha256', getSetting('ip_pepper', 'dev-pepper')).update(req.ip).digest('hex').slice(0, 32);
    const retentionDays = getSetting('scan_retention_days', 180);
    const ipExpires = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
    // coarse geo simulated — production swaps a geolite adapter; never exact location claims (§10.1)
    const geo = simulateGeo(req.ip);
    db.prepare('INSERT INTO scan_events(id,qr_code_id,account_id,outcome,device_category,country,region,city,ip_hash,ip_expires_at,user_agent,referrer,correlation_id,scanned_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid('sc'), q.id, q.account_id, outcome === 'REDIRECT' ? 'redirected_302' : outcome === 'EXPIRED' ? 'expired_page' : outcome === 'SUSPENDED' ? 'suspended_page' : 'not_found',
        device, geo.country, geo.region, geo.city, ipHash, ipExpires, req.ua.slice(0, 300), req.referer ?? null, req.correlationId, nowIso());
    if (outcome !== 'REDIRECT') funnel('routing_failed', q.account_id, { shortCode, outcome });
  } catch (e) { console.error('[scan-log] non-blocking failure', e); }
  if (outcome === 'REDIRECT') {
    const urlOk = validateDestination(q.destination_platform, q.destination_url).ok;
    if (!urlOk) return { outcome: 'ERROR' as const, qr: q };   // never redirect to an invalid destination
    return { outcome: 'REDIRECT' as const, url: q.destination_url, qr: q, subState };
  }
  return { outcome, qr: q, subState };
}

function simulateGeo(ip: string) {
  const h = crypto.createHash('md5').update(ip).digest();
  const cities: [string, string, string][] = [
    ['PK', 'Sindh', 'Karachi'], ['PK', 'Punjab', 'Lahore'], ['PK', 'ICT', 'Islamabad'], ['AE', 'Dubai', 'Dubai'], ['GB', 'England', 'London'], ['US', 'California', 'San Jose'],
  ];
  const c = cities[h[0] % cities.length];
  return { country: c[0], region: c[1], city: c[2] };
}

/* ─────────── billing: intents, receipts, approval (SRS §7, §5.5) ─────────── */
export function createPaymentIntent(accountId: string, planId: string, purpose: 'new' | 'renewal' | 'extension' = 'renewal') {
  const plan = planOf(planId);
  if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
  funnel('plan_selected', accountId, { planId });
  const seq = (db.prepare('SELECT COUNT(*) c FROM payment_intents WHERE account_id=?').get(accountId) as any).c;
  const ref = generatePaymentReference(accountId.replace(/^acc_/, ''), plan.code, seq);
  const id = uid('pi');
  const sub = latestSubscription(accountId);
  db.prepare('INSERT INTO payment_intents(id,account_id,subscription_id,plan_id,purpose,expected_amount,currency,payment_reference,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, accountId, sub?.id ?? null, planId, purpose, plan.price, plan.currency, ref, 'OPEN', nowIso());
  funnel('payment_started', accountId, { intentId: id });
  audit(accountId, 'client', 'intent', id, 'intent_created', { after: { plan: plan.code, amount: plan.price, reference: ref } });
  return db.prepare('SELECT * FROM payment_intents WHERE id=?').get(id);
}

export async function submitReceipt(accountId: string, intentId: string, fileBuf: Buffer, fileName: string, declaredMime: string) {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE id=? AND account_id=?').get(intentId, accountId) as any;
  if (!intent) throw Object.assign(new Error('Intent not found'), { status: 404 });
  if (!rateLimit(`receipt:${accountId}`, 10, 60 * 60_000)) throw Object.assign(new Error('Too many receipt uploads this hour — try again later'), { status: 429 });
  const vf = validateUpload(fileBuf, declaredMime);
  if (!vf.ok) throw Object.assign(new Error(vf.error!), { status: 422 });
  const hash = sha256(fileBuf);
  const fp = perceptualFingerprint(fileBuf);
  // tenant-scoped private storage path with safe filename (§14.2)
  const dir = path.join(UPLOADS_DIR, accountId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = path.join(dir, `${uid('rcpt')}.${vf.mime === 'application/pdf' ? 'pdf' : 'img'}`);
  fs.writeFileSync(stored, fileBuf);
  const rid = uid('rcpt');
  db.prepare('INSERT INTO receipts(id,account_id,intent_id,file_name,mime,size_bytes,sha256,fingerprint,status,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(rid, accountId, intentId, fileName, vf.mime!, fileBuf.length, hash, fp, 'PROCESSING', nowIso());
  funnel('receipt_uploaded', accountId, { receiptId: rid });
  db.prepare('UPDATE payment_intents SET status=? WHERE id=?').run('RECEIPT_UPLOADED', intentId);

  // extraction pipeline
  const { fields, meta } = await runExtraction(stored, { fileName, sha256: hash });
  const knownTxnRefs = (db.prepare('SELECT transaction_ref FROM payments WHERE transaction_ref IS NOT NULL').all() as any[]).map(r => r.transaction_ref);
  const knownSha = (db.prepare("SELECT sha256 FROM receipts WHERE status IN ('APPROVED','DUPLICATE')").all() as any[]).map(r => r.sha256);
  const recentSubmits = (db.prepare('SELECT COUNT(*) c FROM receipts WHERE account_id=? AND submitted_at > ?').get(accountId, new Date(Date.now() - 86_400_000).toISOString()) as any).c;
  const ruleRes = runRuleChecks(fields ?? {}, {
    amount: intent.expected_amount, currency: intent.currency,
    tolerancePct: getSetting('amount_tolerance_pct', 2), submissionWindowDays: getSetting('date_window_days', 7),
    generatedReference: intent.payment_reference, knownTxnRefs, knownSha256: knownSha, sha256: hash, fingerprint: fp,
    sameAccountRecentSubmits: recentSubmits,
  });
  const hardDuplicate = ruleRes.checks.find(c => c.rule === 'file_not_duplicate' && !c.passed) || ruleRes.checks.find(c => c.rule === 'txn_unique' && !c.passed);
  const status = hardDuplicate ? 'DUPLICATE' : ruleRes.riskScore >= getSetting('manual_review_threshold', 40) ? 'NEEDS_REVIEW' : 'NEEDS_REVIEW';
  db.prepare('UPDATE receipts SET extracted=?, extraction_meta=?, rule_results=?, risk_flags=?, risk_score=?, status=? WHERE id=?')
    .run(JSON.stringify(fields ?? {}), JSON.stringify(meta), JSON.stringify(ruleRes.checks), JSON.stringify(ruleRes.riskFlags), ruleRes.riskScore, status, rid);

  // provisional activation policy (§5.3)
  let provisional = false;
  const allowProv = !hardDuplicate && provisionalAllowed(ruleRes.riskScore, ruleRes.riskFlags, getSetting('provisional_risk_threshold', 60))
    && getSetting('provisional_enabled', true) && recentSubmits < getSetting('provisional_max_recent_submits', 6);
  if (allowProv) {
    const sub = latestSubscription(accountId);
    const hours = getSetting('provisional_hours_default', 48);
    const until = new Date(Date.now() + hours * 3_600_000).toISOString();
    if (sub) {
      db.prepare('UPDATE subscriptions SET status=?, provisional_until=?, provisional_source_receipt_id=?, updated_at=? WHERE id=?')
        .run('PROVISIONAL_ACTIVE', until, rid, nowIso(), sub.id);
    } else {
      const plan = planOf(intent.plan_id);
      const start = new Date();
      db.prepare('INSERT INTO subscriptions(id,account_id,plan_id,plan_snapshot,status,period_start,period_end,provisional_until,provisional_source_receipt_id,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(uid('sub'), accountId, plan.id, JSON.stringify(plan), 'PROVISIONAL_ACTIVE', start.toISOString(), start.toISOString(), until, rid, 'manual_receipt', nowIso(), nowIso());
    }
    provisional = true;
    funnel('provisional_activated', accountId, { receiptId: rid });
    notify(accountId, 'receipt_submitted', 'Receipt received — QR temporarily active', 'Your QR stays active while we verify your payment.', `prov-${rid}`);
  } else {
    notify(accountId, 'receipt_submitted', 'Receipt received — under review', hardDuplicate ? 'This evidence matches a previously used payment.' : 'Our team is reviewing your payment evidence.', `sub-${rid}`);
  }
  audit(accountId, 'client', 'receipt', rid, 'receipt_submitted', { after: { status, riskScore: ruleRes.riskScore, provisional } });
  return { receiptId: rid, status, riskScore: ruleRes.riskScore, riskFlags: ruleRes.riskFlags, checks: ruleRes.checks, provisional, extractionMeta: meta };
}

/** Idempotent approval: retries are safe no-ops; exactly one credit per receipt (§5.5, A-08). */
export function approveReceipt(adminId: string, receiptId: string, opts: { correctedAmount?: number; reason?: string } = {}) {
  const result = db.transaction(() => {
    const r = db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId) as any;
    if (!r) throw Object.assign(new Error('Receipt not found'), { status: 404 });
    if (r.status === 'APPROVED') return { noop: true, subscriptionId: r.credited_payment_id };   // retry → no-op
    if (r.credited_payment_id) return { noop: true };
    if (r.status === 'DUPLICATE') throw Object.assign(new Error('Duplicate evidence cannot be approved'), { status: 409 });
    const intent = db.prepare('SELECT * FROM payment_intents WHERE id=?').get(r.intent_id) as any;
    const txnRef = (() => { try { return JSON.parse(r.extracted)?.transaction_id?.value || null; } catch { return null; } })();
    if (txnRef) {
      const clash = db.prepare('SELECT id FROM payments WHERE transaction_ref=?').get(txnRef);
      if (clash) throw Object.assign(new Error('Transaction ID already credited to another payment'), { status: 409 });
    }
    const amount = opts.correctedAmount ?? intent.expected_amount;
    const plan = planOf(intent.plan_id);
    let sub: any = latestSubscription(r.account_id);
    const { periodStart, periodEnd } = computeRenewedPeriodEnd(
      (sub?.status ?? 'EXPIRED') as SubscriptionState, sub?.period_end ?? nowIso(), plan.duration_days);
    if (!sub) {
      const sid = uid('sub');
      db.prepare('INSERT INTO subscriptions(id,account_id,plan_id,plan_snapshot,status,period_start,period_end,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(sid, r.account_id, plan.id, JSON.stringify(plan), 'ACTIVE', periodStart.toISOString(), periodEnd.toISOString(), 'manual_receipt', nowIso(), nowIso());
      sub = { id: sid } as any;
    } else {
      db.prepare('UPDATE subscriptions SET status=?, period_end=?, provisional_until=NULL, provisional_source_receipt_id=NULL, plan_snapshot=?, updated_at=? WHERE id=?')
        .run('ACTIVE', periodEnd.toISOString(), JSON.stringify(plan), nowIso(), sub.id);
    }
    const pid = uid('pay');
    db.prepare('INSERT INTO payments(id,account_id,intent_id,receipt_id,amount,currency,method,transaction_ref,subscription_id,extended_period_end,idempotency_key,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(pid, r.account_id, intent.id, r.id, amount, intent.currency, 'manual', txnRef, sub.id, periodEnd.toISOString(), `approve:${receiptId}`, 'CREDITED', nowIso());
    db.prepare("UPDATE receipts SET status='APPROVED', credited_payment_id=?, decided_at=?, decided_by=?, rejection_reason=NULL WHERE id=?")
      .run(pid, nowIso(), adminId, receiptId);
    db.prepare("UPDATE payment_intents SET status='CREDITED' WHERE id=?").run(intent.id);
    return { noop: false, paymentId: pid, subscriptionId: sub.id, periodEnd: periodEnd.toISOString() };
  })();
  if (!result.noop) {
    funnel('receipt_approved', undefined, { receiptId });
    const r = db.prepare('SELECT account_id FROM receipts WHERE id=?').get(receiptId) as any;
    notify(r.account_id, 'receipt_approved', 'Payment verified — subscription renewed', 'Your QR service is active again. Same QR, no reprint needed.', `appr-${receiptId}`);
    audit(adminId, 'admin', 'receipt', receiptId, 'receipt_approved', { reason: opts.reason, after: result });
  }
  return result;
}

export function rejectReceipt(adminId: string, receiptId: string, reason: string) {
  if (!reason?.trim()) throw Object.assign(new Error('Rejection reason required'), { status: 422 });
  const r = db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId) as any;
  if (!r) throw Object.assign(new Error('Receipt not found'), { status: 404 });
  if (r.status === 'APPROVED') throw Object.assign(new Error('Approved receipts cannot be rejected — use revoke'), { status: 409 });
  db.prepare("UPDATE receipts SET status='REJECTED', rejection_reason=?, decided_at=?, decided_by=? WHERE id=?").run(reason, nowIso(), adminId, receiptId);
  // Rejection immediately removes provisional entitlement (§5.3)
  const sub = latestSubscription(r.account_id);
  if (sub && sub.status === 'PROVISIONAL_ACTIVE' && sub.provisional_source_receipt_id === receiptId) {
    db.prepare('UPDATE subscriptions SET status=?, provisional_until=NULL, provisional_source_receipt_id=NULL, updated_at=? WHERE id=?')
      .run('PAST_DUE', nowIso(), sub.id);
  }
  funnel('receipt_rejected', r.account_id, { receiptId });
  notify(r.account_id, 'receipt_rejected', 'Payment evidence could not be verified', `Reason: ${reason}. You can re-upload correct evidence or pay with a different reference.`, `rej-${receiptId}`);
  audit(adminId, 'admin', 'receipt', receiptId, 'receipt_rejected', { reason });
  return { ok: true };
}

export function markDuplicate(adminId: string, receiptId: string, reason: string) {
  const r = db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId) as any;
  if (!r) throw Object.assign(new Error('Receipt not found'), { status: 404 });
  db.prepare("UPDATE receipts SET status='DUPLICATE', rejection_reason=?, decided_at=?, decided_by=? WHERE id=?").run(reason || 'Marked duplicate by reviewer', nowIso(), adminId, receiptId);
  const sub = latestSubscription(r.account_id);
  if (sub && sub.status === 'PROVISIONAL_ACTIVE' && sub.provisional_source_receipt_id === receiptId)
    db.prepare('UPDATE subscriptions SET status=?, provisional_until=NULL, updated_at=? WHERE id=?').run('PAST_DUE', nowIso(), sub.id);
  audit(adminId, 'admin', 'receipt', receiptId, 'receipt_marked_duplicate', { reason });
  return { ok: true };
}

/** Fraud reversal after approval: revoke entitlement, keep financial record, optional suspension (§18). */
export function reverseApproval(adminId: string, paymentId: string, reason: string, suspendRouting: boolean) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) as any;
  if (!p) throw Object.assign(new Error('Payment not found'), { status: 404 });
  db.prepare("UPDATE payments SET status='REVERSED' WHERE id=?").run(paymentId);
  const sub = latestSubscription(p.account_id);
  if (sub) db.prepare('UPDATE subscriptions SET status=?, provisional_until=NULL, updated_at=? WHERE id=?').run('PAST_DUE', nowIso(), sub.id);
  if (suspendRouting) {
    for (const q of listQrsForAccount(p.account_id)) setQrOperational(adminId, 'admin', q.id, 'SUSPENDED', `Fraud reversal: ${reason}`);
  }
  audit(adminId, 'admin', 'payment', paymentId, 'payment_reversed', { reason, after: { suspended: suspendRouting } });
  return { ok: true };
}

/* Admin manual actions (§12.4) */
export function adminExtendSubscription(adminId: string, accountId: string, days: number, reason: string) {
  if (!reason?.trim()) throw Object.assign(new Error('Reason required'), { status: 422 });
  const max = getSetting('max_manual_extension_days', 90);
  if (days <= 0 || days > max) throw Object.assign(new Error(`Extension must be 1–${max} days`), { status: 422 });
  const sub = latestSubscription(accountId);
  if (!sub) throw Object.assign(new Error('No subscription'), { status: 404 });
  const base = Math.max(Date.now(), new Date(sub.period_end).getTime());
  const end = new Date(base + days * 86_400_000).toISOString();
  db.prepare('UPDATE subscriptions SET status=?, period_end=?, provisional_until=NULL, updated_at=? WHERE id=?').run('ACTIVE', end, nowIso(), sub.id);
  audit(adminId, 'admin', 'subscription', sub.id, 'manual_extension', { reason, after: { days, newEnd: end } });
  notify(accountId, 'manual_extension', 'Subscription extended', `An administrator added ${days} day(s) to your plan.`, `ext-${sub.id}-${end}`);
  return { periodEnd: end };
}

export function grantTrial(adminId: string, accountId: string, planId: string, reason: string) {
  const plan = planOf(planId);
  if (!plan || plan.trial_days <= 0) throw Object.assign(new Error('Plan has no trial configured'), { status: 422 });
  const end = new Date(Date.now() + plan.trial_days * 86_400_000).toISOString();
  const id = uid('sub');
  db.prepare('INSERT INTO subscriptions(id,account_id,plan_id,plan_snapshot,status,period_start,period_end,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, accountId, plan.id, JSON.stringify(plan), 'TRIAL', nowIso(), end, 'admin_grant', nowIso(), nowIso());
  audit(adminId, 'admin', 'subscription', id, 'trial_granted', { reason });
  return { ok: true };
}

export function cancelSubscription(adminId: string, accountId: string, reason: string) {
  const sub = latestSubscription(accountId);
  if (!sub) throw Object.assign(new Error('No subscription'), { status: 404 });
  db.prepare('UPDATE subscriptions SET status=?, updated_at=? WHERE id=?').run('CANCELED', nowIso(), sub.id);
  audit(adminId, 'admin', 'subscription', sub.id, 'subscription_canceled', { reason });
  return { ok: true };
}

/* ─────────── notifications ─────────── */
export function notify(accountId: string, kind: string, title: string, body: string, dedupeKey: string) {
  const prefs = db.prepare('SELECT * FROM notification_prefs WHERE account_id=?').get(accountId) as any;
  const channels = ['in_app'];
  if (prefs?.email) channels.push('email');
  if (prefs?.whatsapp) channels.push('whatsapp');
  if (prefs?.sms) channels.push('sms');
  const critical = kind.startsWith('receipt') || kind === 'expiry' || kind === 'security';
  const insert = db.prepare('INSERT OR IGNORE INTO notifications(id,account_id,kind,title,body,channel,dedupe_key,delivery_status,template_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const ch of channels) {
    if (!critical && ch !== 'in_app' && !getSetting(`channel_${ch}_enabled`, true)) continue;
    const res = insert.run(uid('ntf'), accountId, kind, title, body, ch, `${dedupeKey}:${ch}`, 'QUEUED', 'v1', nowIso());
    if (res.changes > 0 && ch !== 'in_app') {
      const acc = getAccount(accountId);
      notifyAdapters[ch]?.send(acc?.email ?? accountId, title, body).then(ok =>
        db.prepare('UPDATE notifications SET delivery_status=? WHERE dedupe_key=?').run(ok ? 'SENT' : 'FAILED', `${dedupeKey}:${ch}`));
    }
  }
}

/* ─────────── card orders (§11) ─────────── */
export function createCardOrder(accountId: string, input: { product: string; quantity: number; templateId: string; design: unknown; unitPrice: number; shipName: string; shipPhone: string; shipAddress: string }) {
  const sub = latestSubscription(accountId);
  const entitled = !!sub && JSON.parse(sub.plan_snapshot).card_entitled === 1;
  const price = input.unitPrice * input.quantity;
  const id = uid('co');
  db.prepare('INSERT INTO card_orders(id,account_id,product,quantity,template_id,design_json,unit_price,total,status,ship_name,ship_phone,ship_address,entitlement_ok,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, accountId, input.product, input.quantity, input.templateId, JSON.stringify(input.design), input.unitPrice, price, 'NEW', input.shipName, input.shipPhone, input.shipAddress, entitled ? 1 : 0, nowIso(), nowIso());
  funnel('card_order_created', accountId, { orderId: id });
  audit(accountId, 'client', 'card_order', id, 'card_order_created', { after: { product: input.product, qty: input.quantity, total: price } });
  notify(accountId, 'order_update', 'Card order received', 'Our print team will review your artwork shortly.', `ord-${id}-new`);
  return db.prepare('SELECT * FROM card_orders WHERE id=?').get(id);
}

export function transitionCardOrder(actorId: string, role: string, orderId: string, to: CardOrderState, notes?: string) {
  const o = db.prepare('SELECT * FROM card_orders WHERE id=?').get(orderId) as any;
  if (!o) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (!canTransition(o.status, to)) throw Object.assign(new Error(`Invalid transition ${o.status} → ${to}`), { status: 422 });
  if ((to === 'APPROVED' || to === 'PRINTING') && !o.entitlement_ok)
    throw Object.assign(new Error('Production blocked: payment entitlement not confirmed'), { status: 403 });
  const extra: Record<string, string> = {};
  if (to === 'PRINTING') {
    // idempotent print job key — retrying the transition cannot create a second job (§5.5)
    extra.print_job_key = `PJ-${orderId}`;
  }
  if (to === 'SHIPPED') {
    extra.shipment_key = `SH-${orderId}`;
    extra.tracking_ref = `TRK${Math.floor(Math.random() * 900000 + 100000)}`;
  }
  db.prepare(`UPDATE card_orders SET status=?, reviewer_notes=COALESCE(?, reviewer_notes), print_job_key=COALESCE(?, print_job_key), shipment_key=COALESCE(?, shipment_key), tracking_ref=COALESCE(?, tracking_ref), updated_at=? WHERE id=?`)
    .run(to, notes ?? null, extra.print_job_key ?? null, extra.shipment_key ?? null, extra.tracking_ref ?? null, nowIso(), orderId);
  audit(actorId, role, 'card_order', orderId, `order_${to.toLowerCase()}`, { reason: notes, after: extra });
  notify(o.account_id, 'order_update', `Order ${to.replace(/_/g, ' ').toLowerCase()}`, notes ?? `Your card order moved to ${to}.`, `ord-${orderId}-${to}`);
  return db.prepare('SELECT * FROM card_orders WHERE id=?').get(orderId);
}

/* ─────────── analytics summaries (§10.1 aggregate-only) ─────────── */
export function analyticsFor(accountId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db.prepare(`SELECT s.*, q.short_code FROM scan_events s JOIN qr_codes q ON q.id=s.qr_code_id
    JOIN businesses b ON b.id=q.business_id WHERE b.account_id=? AND s.scanned_at>=? ORDER BY s.scanned_at`).all(accountId, since) as any[];
  const trend: Record<string, number> = {};
  const devices: Record<string, number> = {}; const countries: Record<string, number> = {}; const cities: Record<string, number> = {};
  const hours: Record<number, number> = {}; let failures = 0;
  for (const r of rows) {
    const d = r.scanned_at.slice(0, 10);
    trend[d] = (trend[d] ?? 0) + 1;
    devices[r.device_category] = (devices[r.device_category] ?? 0) + 1;
    if (r.country) countries[r.country] = (countries[r.country] ?? 0) + 1;
    if (r.city) cities[r.city] = (cities[r.city] ?? 0) + 1;
    hours[new Date(r.scanned_at).getUTCHours()] = (hours[new Date(r.scanned_at).getUTCHours()] ?? 0) + 1;
    if (r.outcome === 'expired_page' || r.outcome === 'suspended_page' || r.outcome === 'error') failures++;
  }
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return {
    total: rows.length,
    today: trend[today] ?? 0,
    week: rows.filter(r => r.scanned_at.slice(0, 10) >= week).length,
    trend: Object.entries(trend).sort().map(([date, scans]) => ({ date, scans })),
    devices, countries, cities,
    topHours: Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, n]) => ({ hour: Number(h), scans: n })),
    routingHealth: rows.length ? Math.round(((rows.length - failures) / rows.length) * 100) : 100,
    recent: rows.slice(-12).reverse().map(r => ({ at: r.scanned_at, shortCode: r.short_code, outcome: r.outcome, city: r.city, device: r.device_category })),
  };
}

/* ─────────── seed demo data ─────────── */
export async function seedIfEmpty() {
  const c = (db.prepare('SELECT COUNT(*) c FROM accounts').get() as any).c;
  if (c > 0) return;
  console.log('[seed] creating demo tenants…');
  const mkPlan = (code: string, name: string, price: number, dur: number, trial: number, grace: number, qrs: number, card: number, rec: number, features: string[]) => {
    const id = uid('pln');
    db.prepare('INSERT INTO plans(id,code,name,price,currency,duration_days,trial_days,grace_days,provisional_hours,included_qrs,downloads_allowed,analytics_enabled,card_entitled,visible,recommended,features,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, code, name, price, 'PKR', dur, trial, grace, 48, qrs, 1, 1, card, 1, rec, JSON.stringify(features), 1, nowIso());
    db.prepare('INSERT INTO plan_history(id,plan_id,snapshot,changed_by,changed_at) VALUES(?,?,?,?,?)').run(uid('ph'), id, JSON.stringify({ price, dur }), 'system', nowIso());
    return id;
  };
  const starter = mkPlan('STARTER', 'Starter', 1500, 30, 7, 7, 1, 0, 0, ['1 dynamic QR', 'Destination editing', 'Basic scan analytics', 'PNG download']);
  const business = mkPlan('BUSINESS', 'Business', 4500, 30, 7, 7, 3, 1, 1, ['3 dynamic QRs', 'High-res + vector export', 'Full analytics', 'Print-ready cards unlocked', 'Priority support']);
  const multi = mkPlan('MULTI', 'Multi-Outlet', 9900, 30, 0, 14, 10, 1, 0, ['10 QRs across outlets', 'Location grouping', 'Team access ready', 'Custom expired-page branding']);
  mkPlan('BUSINESS_Y', 'Business Yearly', 45000, 365, 7, 14, 3, 1, 0, ['Everything in Business', '2 months free', 'Annual invoice & receipt']);

  const mkAccount = (email: string, name: string, role: string) => createAccount({ name, email, password: 'reviewdoor123', role });
  const owner = mkAccount('owner@spiceroute.pk', 'Ayesha Khan', 'client');
  const cafe = mkAccount('hello@brewbay.pk', 'Bilal Ahmed', 'client');
  const salon = mkAccount('manager@glowstudio.pk', 'Sana Malik', 'client');
  const expired = mkAccount('old@silkthreads.pk', 'Imran Raza', 'client');
  const admin = mkAccount('admin@reviewdoor.app', 'Zara Operations', 'admin');
  mkAccount('print@reviewdoor.app', 'Print Desk', 'print_staff');
  mkAccount('support@reviewdoor.app', 'Support Desk', 'support');

  const addQr = (acc: any, bizName: string, cat: string, platform: string, url: string, code: string) => {
    const biz = createBusiness(acc.id, { name: bizName, category: cat, contactEmail: acc.email }) as any;
    const v = validateDestination(platform, url);
    const id = uid('qr');
    db.prepare('INSERT INTO qr_codes(id,business_id,short_code,destination_url,destination_platform,last_known_good_url,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, biz.id, code, url, platform, url, nowIso());
    db.prepare('INSERT INTO review_destinations(id,business_id,qr_code_id,platform,label,url,validation_status,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(uid('dest'), biz.id, id, platform, 'Main reviews', url, v.status, nowIso());
    db.prepare('INSERT INTO qr_versions(id,qr_code_id,destination_url,changed_by,reason,created_at) VALUES(?,?,?,?,?,?)').run(uid('qv'), id, url, acc.id, 'seed', nowIso());
    return { biz, qrId: id };
  };

  const mkSub = (accId: string, planId: string, status: SubscriptionState, start: Date, end: Date, provUntil?: string, srcReceipt?: string) => {
    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
    db.prepare('INSERT INTO subscriptions(id,account_id,plan_id,plan_snapshot,status,period_start,period_end,provisional_until,provisional_source_receipt_id,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid('sub'), accId, planId, JSON.stringify(plan), status, start.toISOString(), end.toISOString(), provUntil ?? null, srcReceipt ?? null, status === 'TRIAL' ? 'trial' : 'manual_receipt', nowIso(), nowIso());
  };

  const D = (days: number) => new Date(Date.now() + days * 86_400_000);
  // Spice Route — ACTIVE w/ grace ending far; QR DEMO42 is the landing-page demo
  const sr = addQr(owner, 'Spice Route Kitchen', 'restaurant', 'google', 'https://www.google.com/maps/place//data=!4m2!3m1!1s0x0_spice', 'DEMO42');
  addQr(owner, 'Spice Route Kitchen', 'restaurant', 'foodpanda', 'https://www.foodpanda.pk/en/restaurants/dc/spice-route', 'K7xQm2A');
  mkSub(owner.id, business, 'ACTIVE', D(-10), D(20));
  // Brew Bay — PROVISIONAL via seeded receipt
  const bb = addQr(cafe, 'Brew Bay Café', 'cafe', 'google', 'https://g.page/brew-bay-cafe', 'T8wLc4B');
  const intent = createPaymentIntent(cafe.id, business, 'renewal');
  const png = makeSeedPng();
  const rr = await submitReceipt(cafe.id, (intent as any).id, png, 'easypaisa_4500_2026-10-09_txnSEED4410_ref.png', 'image/png');
  mkSub(cafe.id, business, 'PROVISIONAL_ACTIVE', D(-5), D(-1), new Date(Date.now() + 40 * 3_600_000).toISOString(), rr.receiptId);
  // Glow Studio — GRACE (ended 3 days ago, 7-day grace)
  const gs = addQr(salon, 'Glow Studio Salon', 'salon', 'instagram', 'https://www.instagram.com/glowstudio.pk/', 'G5sVn8C');
  mkSub(salon.id, starter, 'GRACE', D(-33), D(-3));
  // Silk Threads — EXPIRED past grace
  const st = addQr(expired, 'Silk Threads Boutique', 'retail', 'custom', 'https://silkthreads.pk/feedback', 'X2pLd9F');
  mkSub(expired.id, starter, 'EXPIRED', D(-60), D(-20));
  db.prepare("UPDATE qr_codes SET operational_state='SUSPENDED', suspend_reason='Policy review' WHERE id=?").run(st.qrId);
  // one more ENABLED but expired QR for variety
  addQr(expired, 'Silk Threads Outlet 2', 'retail', 'tripadvisor', 'https://www.tripadvisor.com/Restaurant-Review-silk', 'M9tRw3E');

  // seeded historical scans
  const allQrs = db.prepare('SELECT q.id, b.account_id FROM qr_codes q JOIN businesses b ON b.id=q.business_id').all() as any[];
  const insScan = db.prepare('INSERT INTO scan_events(id,qr_code_id,account_id,outcome,device_category,country,region,city,ip_hash,ip_expires_at,correlation_id,scanned_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const rnd = mulberry(42);
  for (const q of allQrs) for (let i = 0; i < 40 + Math.floor(rnd() * 60); i++) {
    const when = new Date(Date.now() - rnd() * 28 * 86_400_000);
    const dev = rnd() < 0.82 ? 'mobile' : rnd() < 0.5 ? 'tablet' : 'desktop';
    const geo = simulateGeo(`10.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}`);
    insScan.run(uid('sc'), q.id, q.account_id, 'redirected_302', dev, geo.country, geo.region, geo.city, 'seedhash', D(180).toISOString(), 'seed', when.toISOString());
  }

  // card order in DESIGN_REVIEW
  const tpl = db.prepare('SELECT * FROM design_templates LIMIT 1').get() as any;
  createCardOrder(owner.id, { product: 'plastic_card', quantity: 50, templateId: tpl?.id ?? 'tpl_seed', design: { accent: '#D1AC00', cta: 'Rate us!' }, unitPrice: 120, shipName: 'Ayesha Khan', shipPhone: '+92 300 1234567', shipAddress: 'DHA Phase 5, Lahore' });
  db.prepare("UPDATE card_orders SET status='DESIGN_REVIEW', entitlement_ok=1 WHERE account_id=?").run(owner.id);

  // templates
  const mkTpl = (name: string, base: string, ink: string, palette: string[]) =>
    db.prepare('INSERT INTO design_templates(id,name,kind,palette,base,ink,accent,printer_cfg,active) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(uid('tpl'), name, 'card', JSON.stringify(palette), base, ink, 0, JSON.stringify({ bleed_mm: 3, trim: '85.6x54' }), 1);
  mkTpl('Minimal White', '#FAF4D3', '#0C1618', ['#004643', '#D1AC00', '#F6BE9A']);
  mkTpl('Restaurant Dark', '#0C1618', '#FAF4D3', ['#D1AC00', '#F6BE9A']);
  mkTpl('Modern Accent', '#FAF4D3', '#0C1618', ['#D1AC00', '#004643']);
  mkTpl('Corporate Clean', '#004643', '#FAF4D3', ['#D1AC00']);

  // settings
  setSetting('ai_mode', 'auto');
  setSetting('ai_lmstudio', { enabled: false, baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen2.5-vl-7b', timeoutMs: 15000, retries: 2, temperature: 0.1, maxTokens: 700 });
  setSetting('provisional_enabled', true);
  setSetting('manual_review_threshold', 40);
  setSetting('amount_tolerance_pct', 2);
  setSetting('date_window_days', 7);
  setSetting('max_manual_extension_days', 90);
  setSetting('scan_retention_days', 180);
  void sr; void bb; void gs; void admin;
  console.log('[seed] done.');
}

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** tiny valid PNG (8x8 teal) for seed receipt */
function makeSeedPng(): Buffer {
  // minimal hand-built PNG: IHDR+IDAT+IEND
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(8 * (1 + 8 * 3));
  for (let y = 0; y < 8; y++) { raw[y * 25] = 0; for (let x = 0; x < 8; x++) { const i = y * 25 + 1 + x * 3; raw[i] = 0x00; raw[i + 1] = 0x46; raw[i + 2] = 0x43; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ─────────── background jobs (Design §17) ─────────── */
export function enqueueJob(kind: string, payload: unknown, runAt = new Date()) {
  db.prepare('INSERT INTO jobs(id,kind,payload,run_at,status) VALUES(?,?,?,?,\'PENDING\')').run(uid('job'), kind, JSON.stringify(payload), runAt.toISOString());
}

export async function tickJobs(now = new Date()) {
  // 1. expire/grace derivation for all subs (idempotent)
  for (const sub of db.prepare('SELECT account_id FROM subscriptions GROUP BY account_id').all() as any[])
    refreshSubscriptionStatus(sub.account_id, now);
  // 2. expiry reminders 14/7/3/1 + expiry notice
  for (const sub of db.prepare("SELECT * FROM subscriptions WHERE status IN ('ACTIVE','TRIAL','GRACE','PROVISIONAL_ACTIVE')").all() as any[]) {
    const sent = new Set((db.prepare("SELECT dedupe_key FROM notifications WHERE account_id=? AND kind LIKE 'expiry_%'").all(sub.account_id) as any[]).map(r => r.dedupe_key.split(':')[1]));
    const daysLeft = Math.ceil((new Date(sub.period_end).getTime() - now.getTime()) / 86_400_000);
    for (const d of [14, 7, 3, 1]) if (daysLeft === d && !sent.has(String(d)))
      notify(sub.account_id, `expiry_reminder`, `Your QR service expires in ${d} day${d === 1 ? '' : 's'}`, 'Renew now so customers keep reaching your reviews without interruption.', `exp:${sub.id}:${d}`);
    if (daysLeft <= 0 && !sent.has('gone'))
      notify(sub.account_id, 'expiry_done', 'QR service is now inactive', 'Your printed QR still works — renew the service to reactivate routing.', `exp:${sub.id}:gone`);
  }
  // 3. pending jobs table processing (asset generation etc.)
  const due = db.prepare("SELECT * FROM jobs WHERE status='PENDING' AND run_at<=? ORDER BY run_at LIMIT 20").all(now.toISOString()) as any[];
  for (const j of due) {
    try {
      const p = JSON.parse(j.payload);
      if (j.kind === 'destination_health') {
        // lightweight health probe — never guarantees third-party availability (§19 helper note)
        let health = 'UNKNOWN';
        try {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
          const res = await fetch(p.url, { method: 'HEAD', signal: ctl.signal, redirect: 'follow' });
          clearTimeout(t);
          health = res.ok || res.status < 500 ? 'REACHABLE' : 'BROKEN';
        } catch { health = 'UNKNOWN'; }
        db.prepare('UPDATE review_destinations SET health_status=?, last_checked_at=? WHERE qr_code_id=?').run(health, nowIso(), p.qrId);
        if (health === 'BROKEN') notify(p.accountId, 'destination_health', 'Review link may be broken', 'We could not reach your saved review destination. Please double-check the link.', `dh:${p.qrId}:${nowIso().slice(0, 10)}`);
      }
      db.prepare("UPDATE jobs SET status='DONE', done_at=? WHERE id=?").run(nowIso(), j.id);
    } catch (e) {
      const attempts = j.attempts + 1;
      db.prepare("UPDATE jobs SET attempts=?, last_error=?, status=? WHERE id=?").run(attempts, String(e).slice(0, 300), attempts >= j.max_attempts ? 'FAILED' : 'PENDING', j.id);
    }
  }
  // schedule next health probes
  for (const q of db.prepare("SELECT q.id, q.destination_url url, b.account_id FROM qr_codes q JOIN businesses b ON b.id=q.business_id WHERE q.operational_state='ENABLED'").all() as any[]) {
    const exists = db.prepare("SELECT COUNT(*) c FROM jobs WHERE kind='destination_health' AND status='PENDING' AND payload LIKE ?").get(`%"${q.url}"%`) as any;
    if (!exists?.c) enqueueJob('destination_health', { qrId: q.id, url: q.url, accountId: q.account_id }, new Date(Date.now() + 6 * 3_600_000));
  }
  // retention cleanup: drop hashed IP after retention window (§14.4)
  db.prepare('UPDATE scan_events SET ip_hash=NULL WHERE ip_expires_at < ?').run(now.toISOString());
}
