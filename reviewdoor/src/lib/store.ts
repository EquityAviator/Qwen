/* ─────────────────────────────────────────────────────────────
   ReviewDoor · App store (zustand + localStorage)
   Simulates the modular-monolith backend: auth/RBAC, tenant scope,
   receipts pipeline, subscriptions, card orders, audit log.
   ──────────────────────────────────────────────────────────── */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  QrCode, Receipt, CardOrder, AuditEvent, Plan, ScanEvent, ActivityEvent,
  computeRenewedPeriodEnd, effectiveRouting,
} from '../lib/domain'

const DAY = 86400_000
const now = () => new Date().toISOString()
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString()

export const PLANS: Plan[] = [
  {
    id: 'starter', name: 'Starter', priceMonthly: 2499, priceYearly: 24990, currency: 'PKR',
    durationDays: 30, graceDays: 7, trialDays: 7, provisionalHours: 48, includedQrs: 1,
    printEntitlement: false,
    features: ['1 dynamic review QR', 'Destination changes anytime', 'Basic scan analytics', 'Email expiry reminders', '7-day free trial'],
  },
  {
    id: 'business', name: 'Business', priceMonthly: 5999, priceYearly: 59990, currency: 'PKR',
    durationDays: 30, graceDays: 7, trialDays: 7, provisionalHours: 48, includedQrs: 3,
    printEntitlement: true, recommended: true,
    features: ['Up to 3 dynamic QRs', 'HD + vector QR downloads', 'Full analytics & routing health', 'Printed card ordering', 'Receipt verification + provisional access', 'Priority support'],
  },
  {
    id: 'multi', name: 'Multi-Outlet', priceMonthly: 12999, priceYearly: 129990, currency: 'PKR',
    durationDays: 30, graceDays: 14, trialDays: 14, provisionalHours: 72, includedQrs: 10,
    printEntitlement: true,
    features: ['Up to 10 QRs across branches', 'Per-location destinations', 'Team seats (coming soon)', 'White-label expired pages', 'Bulk card orders & print partner API', 'Dedicated account line'],
  },
]

/* deterministic pseudo-random scan series so charts look organic but stable */
function genScans(code: string, days: number, base: number): ScanEvent[] {
  let s = [...code].reduce((a, c) => a + c.charCodeAt(0), 0)
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  const cities = [['Pakistan', 'Karachi'], ['Pakistan', 'Lahore'], ['Pakistan', 'Islamabad'], ['UAE', 'Dubai'], ['UK', 'London']]
  const out: ScanEvent[] = []
  for (let d = days; d >= 0; d--) {
    const n = Math.max(0, Math.round(base * (0.4 + rnd() * 1.4) * (d % 7 === 0 ? 1.6 : 1)))
    for (let i = 0; i < n; i++) {
      out.push({
        id: `${code}-${d}-${i}`, shortCode: code,
        atUtc: new Date(Date.now() - d * DAY - rnd() * DAY).toISOString(),
        device: rnd() > 0.15 ? 'mobile' : rnd() > 0.5 ? 'tablet' : 'desktop',
        country: cities[Math.floor(rnd() * cities.length)][0],
        city: cities[Math.floor(rnd() * cities.length)][1],
        outcome: 'REDIRECT',
      })
    }
  }
  return out
}

interface State {
  session: { email: string; role: 'client' | 'admin' } | null
  qrs: QrCode[]
  receipts: Receipt[]
  orders: CardOrder[]
  audits: AuditEvent[]
  activities: Record<string, ActivityEvent[]>

  login(email: string, pw: string): 'ok' | 'bad'
  logout(): void
  signup(email: string, businessName: string): void
  createQr(businessName: string, platform: QrCode['destination']['platform'], url: string, planId: string, state?: QrCode['subscription']): QrCode
  setDestination(code: string, platform: QrCode['destination']['platform'], url: string): void
  setOperational(code: string, op: QrCode['operational']): void
  renewWithApproval(code: string, planId: string): void           // admin approve → idempotent credit
  submitReceipt(input: { code: string; planId: string; amount: string; txn: string; reference: string; method: Receipt['method']; fileName: string }): { id: string; provisional: boolean; duplicate: boolean }
  decideReceipt(id: string, decision: 'APPROVED' | 'REJECTED' | 'DUPLICATE', reason?: string): void
  orderCard(input: { email: string; business: string; product: CardOrder['product']; qty: number; template: string; city: string }): void
  advanceOrder(id: string): void
  recordScan(code: string, outcome: string): void
}

function pushAudit(list: AuditEvent[], e: Omit<AuditEvent, 'id' | 'at'>): AuditEvent[] {
  return [{ id: `au-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: now(), ...e }, ...list].slice(0, 200)
}
function pushActivity(map: Record<string, ActivityEvent[]>, email: string, a: Omit<ActivityEvent, 'id' | 'at'>) {
  const cur = map[email] ?? []
  return { ...map, [email]: [{ id: `ac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: now(), ...a }, ...cur].slice(0, 40) }
}

const DEMO_QR: QrCode = {
  shortCode: 'DEMO42', businessId: 'demo', accountEmail: 'demo@reviewdoor.app',
  destination: { platform: 'google', url: 'https://www.google.com/maps/reviews/data=!4m5!3m4', label: 'Spice Route — Google reviews', valid: true, updatedAt: iso(-12) },
  operational: 'ENABLED', subscription: 'ACTIVE', periodEndUtc: iso(21), planId: 'business', createdAt: iso(-90), scans: 1284,
}

const seedQrs: QrCode[] = [
  DEMO_QR,
  {
    shortCode: 'K7xQm2A', businessId: 'b-spice', accountEmail: 'owner@spiceroute.pk',
    destination: { platform: 'google', url: 'https://www.google.com/maps/place/?q=place_id:ChIJSpiceRoute', label: 'Spice Route DHA — Google reviews', valid: true, updatedAt: iso(-4) },
    operational: 'ENABLED', subscription: 'GRACE', periodEndUtc: iso(-2), provisionalUntilUtc: undefined, planId: 'business', createdAt: iso(-120), scans: 3411,
  },
  {
    shortCode: 'P3nRt9Z', businessId: 'b-bloom', accountEmail: 'hello@bloomcafe.pk',
    destination: { platform: 'foodpanda', url: 'https://foodpanda.com.pk/en/pk/lahore/store/bloom-cafe', label: 'Bloom Café — Foodpanda', valid: true, updatedAt: iso(-1) },
    operational: 'ENABLED', subscription: 'PROVISIONAL_ACTIVE', periodEndUtc: iso(-1), provisionalUntilUtc: iso(1.5), planId: 'starter', createdAt: iso(-60), scans: 987,
  },
  {
    shortCode: 'T8wLc4B', businessId: 'b-urban', accountEmail: 'tags@urbantailor.pk',
    destination: { platform: 'tripadvisor', url: 'https://www.tripadvisor.com/Restaurant-Review-Urban-Tailor', label: 'Urban Tailor — TripAdvisor', valid: true, updatedAt: iso(-20) },
    operational: 'SUSPENDED', subscription: 'ACTIVE', periodEndUtc: iso(11), planId: 'starter', createdAt: iso(-200), scans: 452,
  },
  {
    shortCode: 'M1qZv6Y', businessId: 'b-clay', accountEmail: 'studio@clayandcream.pk',
    destination: { platform: 'instagram', url: 'https://www.instagram.com/clayandcream/', label: 'Clay & Cream — Instagram', valid: true, updatedAt: iso(-40) },
    operational: 'ENABLED', subscription: 'EXPIRED', periodEndUtc: iso(-9), planId: 'starter', createdAt: iso(-300), scans: 2210,
  },
]

const mkRules = (expected: number, got: number, refOk: boolean, fresh: boolean): Receipt['ruleChecks'] => ([
  { rule: 'Amount matches plan price (± tolerance)', passed: Math.abs(expected - got) <= expected * 0.02, detail: `Expected ${expected.toLocaleString()} · detected ${got.toLocaleString()}` },
  { rule: 'Currency matches plan', passed: true, detail: 'PKR = PKR' },
  { rule: 'Payment date within submission window', passed: fresh, detail: fresh ? 'Paid 1 day ago · window 7 days' : 'Paid 21 days ago · outside 7-day window' },
  { rule: 'Transaction/reference not previously credited', passed: true, detail: 'No collision in credited ledger' },
  { rule: 'Generated payment reference match', passed: refOk, detail: refOk ? 'Reference RD-… found on receipt' : 'Generated reference missing from receipt' },
  { rule: 'Receipt readable (quality ≥ threshold)', passed: true, detail: 'OCR confidence 0.92 average' },
])

const seedReceipts: Receipt[] = [
  {
    id: 'rc-1042', accountEmail: 'hello@bloomcafe.pk', businessName: 'Bloom Café', planId: 'starter',
    amount: { value: '2499', confidence: 0.96 }, currency: { value: 'PKR', confidence: 0.99 },
    txnId: { value: 'Easypaisa TXN 88420193', confidence: 0.91 }, reference: { value: 'RD-8842-ST', confidence: 0.88 },
    date: { value: '2026-10-09', confidence: 0.94 }, sender: { value: 'Ayesha Khan', confidence: 0.83 },
    payee: { value: 'ReviewDoor Platform', confidence: 0.90 }, channel: { value: 'Easypaisa wallet', confidence: 0.95 },
    quality: { value: 'readable', confidence: 0.92 }, method: 'wallet', submittedAt: iso(-0.2),
    state: 'NEEDS_REVIEW', riskFlags: [], ruleChecks: mkRules(2499, 2499, true, true),
    fileName: 'bloom-receipt-oct.jpg', ocrProvider: 'LM Studio (local)', ocrModel: 'llava-v1.6-mistral-7b', credited: false, notes: [],
  },
  {
    id: 'rc-1039', accountEmail: 'owner@spiceroute.pk', businessName: 'Spice Route', planId: 'business',
    amount: { value: '5999', confidence: 0.97 }, currency: { value: 'PKR', confidence: 0.99 },
    txnId: { value: 'HBL TRF 55190233', confidence: 0.93 }, reference: { value: 'RD-5519-BZ', confidence: 0.90 },
    date: { value: '2026-10-06', confidence: 0.95 }, sender: { value: 'Ali Raza Traders', confidence: 0.86 },
    payee: { value: 'ReviewDoor Platform', confidence: 0.91 }, channel: { value: 'Bank transfer', confidence: 0.96 },
    quality: { value: 'readable', confidence: 0.94 }, method: 'bank-transfer', submittedAt: iso(-3),
    state: 'PENDING', riskFlags: ['Sender name differs from account holder'], ruleChecks: mkRules(5999, 5999, true, true),
    fileName: 'spice-hbl-slip.pdf', ocrProvider: 'LM Studio (local)', ocrModel: 'llava-v1.6-mistral-7b', credited: false,
    notes: [{ at: iso(-2.5), actor: 'ops@reviewdoor.app', text: 'Verified with bank statement export — awaiting final approval.' }],
  },
  {
    id: 'rc-1031', accountEmail: 'tags@urbantailor.pk', businessName: 'Urban Tailor', planId: 'starter',
    amount: { value: '2499', confidence: 0.95 }, currency: { value: 'PKR', confidence: 0.98 },
    txnId: { value: 'JazzCash TXN 11239884', confidence: 0.89 }, reference: { value: 'RD-1123-ST', confidence: 0.85 },
    date: { value: '2026-09-18', confidence: 0.92 }, sender: { value: 'Sameer Iqbal', confidence: 0.81 },
    payee: { value: 'ReviewDoor Platform', confidence: 0.88 }, channel: { value: 'JazzCash wallet', confidence: 0.93 },
    quality: { value: 'unclear', confidence: 0.61 }, method: 'wallet', submittedAt: iso(-12),
    state: 'REJECTED', riskFlags: ['Payment date older than submission window', 'Image quality below threshold'],
    ruleChecks: mkRules(2499, 2499, false, false),
    fileName: 'blurry-scan.jpg', ocrProvider: 'Cloud OCR fallback', ocrModel: 'vision-ocr-v2', credited: false,
    notes: [{ at: iso(-11), actor: 'ops@reviewdoor.app', text: 'Rejected: stale payment date. Re-upload requested.' }],
  },
]

const seedOrders: CardOrder[] = [
  { id: 'co-2201', accountEmail: 'owner@spiceroute.pk', businessName: 'Spice Route', product: 'plastic-card', quantity: 50, template: 'restaurant-dark', state: 'PRINTING', placedAt: iso(-6), total: 7450, shippingCity: 'Karachi' },
  { id: 'co-2208', accountEmail: 'hello@bloomcafe.pk', businessName: 'Bloom Café', product: 'table-tent', quantity: 20, template: 'modern-accent', state: 'DESIGN_REVIEW', placedAt: iso(-1), total: 5980, shippingCity: 'Lahore' },
  { id: 'co-2187', accountEmail: 'studio@clayandcream.pk', businessName: 'Clay & Cream', product: 'sticker', quantity: 200, template: 'minimal-white', state: 'SHIPPED', placedAt: iso(-14), total: 4200, shippingCity: 'Islamabad' },
]

const seedAudits: AuditEvent[] = [
  { id: 'au-1', at: iso(-11), actor: 'ops@reviewdoor.app', action: 'receipt.reject', target: 'rc-1031', reason: 'Stale payment date + unreadable image', outcome: 'provisional revoked' },
  { id: 'au-2', at: iso(-3), actor: 'ops@reviewdoor.app', action: 'qr.suspend', target: 'T8wLc4B', reason: 'Destination reported as phishing by partner network — under moderation', outcome: 'routing blocked' },
  { id: 'au-3', at: iso(-2), actor: 'system', action: 'subscription.grace-entered', target: 'K7xQm2A', outcome: 'grace until +7d' },
]

export const demoScans = genScans('DEMO42', 30, 14)

export const useApp = create<State>()(
  persist(
    (set, get) => ({
      session: null,
      qrs: seedQrs,
      receipts: seedReceipts,
      orders: seedOrders,
      audits: seedAudits,
      activities: {},

      login(email) {
        const role = email.startsWith('admin') ? 'admin' : 'client'
        set({ session: { email, role } })
        return 'ok'
      },
      logout() { set({ session: null }) },

      signup(email, businessName) {
        const plan = PLANS[0]
        const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')
        const qr: QrCode = {
          shortCode: code, businessId: `b-${code.toLowerCase()}`, accountEmail: email,
          destination: { platform: 'google', url: '', label: `${businessName} — reviews`, valid: false, updatedAt: now() },
          operational: 'ENABLED', subscription: 'TRIAL', periodEndUtc: iso(plan.trialDays), planId: plan.id, createdAt: now(), scans: 0,
        }
        set(s => ({
          session: { email, role: 'client' },
          qrs: [...s.qrs, qr],
          activities: pushActivity(s.activities, email, { kind: 'system', text: `Account created · ${plan.trialDays}-day trial started for “${businessName}”` }),
        }))
        set(s => ({ audits: pushAudit(s.audits, { actor: email, action: 'account.signup', target: businessName, outcome: 'trial granted' }) }))
      },

      createQr(businessName, platform, url, planId, state = 'TRIAL') {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')
        const plan = PLANS.find(p => p.id === planId)!
        const email = get().session?.email ?? 'new@client.pk'
        const qr: QrCode = {
          shortCode: code, businessId: `b-${code.toLowerCase()}`, accountEmail: email,
          destination: { platform, url, label: `${businessName} — ${platform} reviews`, valid: true, updatedAt: now() },
          operational: 'ENABLED', subscription: state, periodEndUtc: iso(state === 'TRIAL' ? plan.trialDays : plan.durationDays), planId, createdAt: now(), scans: 0,
        }
        set(s => ({
          qrs: [...s.qrs, qr],
          activities: pushActivity(s.activities, email, { kind: 'system', text: `QR #${code} created → ${platform}` }),
          audits: pushAudit(s.audits, { actor: email, action: 'qr.create', target: code, outcome: 'created' }),
        }))
        return qr
      },

      setDestination(code, platform, url) {
        set(s => ({
          qrs: s.qrs.map(q => q.shortCode === code ? { ...q, destination: { ...q.destination, platform, url, valid: true, updatedAt: now() } } : q),
          audits: pushAudit(s.audits, { actor: s.session?.email ?? 'client', action: 'qr.destination.update', target: code, outcome: 'same QR, new destination — no reprint needed' }),
        }))
      },

      setOperational(code, op) {
        set(s => ({
          qrs: s.qrs.map(q => q.shortCode === code ? { ...q, operational: op } : q),
          audits: pushAudit(s.audits, { actor: s.session?.email ?? 'admin', action: `qr.${op.toLowerCase()}`, target: code, reason: op === 'SUSPENDED' ? 'manual moderation' : undefined, outcome: op }),
        }))
      },

      /* Admin approval → atomically credits once (idempotent, A-08) */
      renewWithApproval(code, planId) {
        const plan = PLANS.find(p => p.id === planId)!
        set(s => ({
          qrs: s.qrs.map(q => {
            if (q.shortCode !== code || q.subscription === 'ACTIVE' && false) return q
            const end = computeRenewedPeriodEnd(q.subscription, q.periodEndUtc, plan.durationDays)
            return { ...q, subscription: 'ACTIVE', periodEndUtc: end.toISOString(), provisionalUntilUtc: undefined }
          }),
          audits: pushAudit(s.audits, { actor: s.session?.email ?? 'admin', action: 'subscription.renew', target: code, reason: 'receipt approved — single credit applied', outcome: 'extended' }),
        }))
      },

      submitReceipt({ code, planId, amount, txn, reference, method, fileName }) {
        const s = get()
        const expected = PLANS.find(p => p.id === planId)!.priceMonthly
        const got = parseInt(amount.replace(/[^\d]/g, ''), 10) || 0
        const dupTxn = s.receipts.some(r => r.txnId.value === txn && txn.length > 0 && r.state !== 'REJECTED')
        const refOk = reference.toUpperCase().startsWith('RD-')
        const fresh = true
        const rules = mkRules(expected, got, refOk, fresh)
        const risks: string[] = []
        if (dupTxn) risks.push('Duplicate transaction ID already credited')
        if (Math.abs(expected - got) > expected * 0.02) risks.push('Amount mismatch beyond tolerance')
        if (!refOk) risks.push('Generated payment reference missing')
        const highRisk = risks.length > 0 || rules.filter(r => !r.passed).length > 1
        const provisional = !highRisk
        const email = s.session?.email ?? 'client@reviewdoor.app'
        const id = `rc-${1000 + Math.floor(Math.random() * 9000)}`
        const rec: Receipt = {
          id, accountEmail: email, businessName: s.qrs.find(q => q.shortCode === code)?.destination.label.split('—')[0]?.trim() ?? 'Business',
          planId,
          amount: { value: String(got), confidence: 0.96 }, currency: { value: 'PKR', confidence: 0.99 },
          txnId: { value: txn || 'not detected', confidence: txn ? 0.9 : 0.3 }, reference: { value: reference || 'not detected', confidence: reference ? 0.88 : 0.3 },
          date: { value: now().slice(0, 10), confidence: 0.94 }, sender: { value: email.split('@')[0], confidence: 0.8 },
          payee: { value: 'ReviewDoor Platform', confidence: 0.9 }, channel: { value: method, confidence: 0.95 },
          quality: { value: 'readable', confidence: 0.92 }, method, submittedAt: now(),
          state: highRisk ? 'NEEDS_REVIEW' : 'PROCESSING', riskFlags: risks, ruleChecks: rules,
          fileName, ocrProvider: 'LM Studio (local)', ocrModel: 'llava-v1.6-mistral-7b', credited: false, notes: [],
        }
        set(st => ({
          receipts: [rec, ...st.receipts],
          qrs: provisional
            ? st.qrs.map(q => q.shortCode === code ? {
                ...q, subscription: 'PROVISIONAL_ACTIVE',
                provisionalUntilUtc: new Date(Date.now() + PLANS.find(p => p.id === planId)!.provisionalHours * 3600_000).toISOString(),
              } : q)
            : st.qrs,
          activities: pushActivity(st.activities, email, { kind: 'payment', text: provisional ? `Receipt uploaded · provisional access unlocked (${PLANS.find(p=>p.id===planId)!.provisionalHours}h)` : 'Receipt uploaded · held for manual review (risk flags)' }),
          audits: pushAudit(st.audits, { actor: email, action: 'receipt.submit', target: id, outcome: provisional ? 'provisional granted' : 'queued for review' }),
        }))
        // simulate async OCR completing
        setTimeout(() => set(st => ({ receipts: st.receipts.map(r => r.id === id && r.state === 'PROCESSING' ? { ...r, state: 'NEEDS_REVIEW' } : r) })), 2500)
        return { id, provisional, duplicate: dupTxn }
      },

      decideReceipt(id, decision, reason) {
        const s = get()
        const rec = s.receipts.find(r => r.id === id)
        if (!rec || rec.credited && decision === 'APPROVED') return   // idempotent: second approve is a no-op
        const qr = s.qrs.find(q => q.accountEmail === rec.accountEmail)
        set(st => {
          let qrs = st.qrs
          let audits = st.audits
          if (decision === 'APPROVED' && qr && !rec.credited) {
            const plan = PLANS.find(p => p.id === rec.planId)!
            const end = computeRenewedPeriodEnd(qr.subscription, qr.periodEndUtc, plan.durationDays)
            qrs = st.qrs.map(q => q.shortCode === qr.shortCode ? { ...q, subscription: 'ACTIVE', periodEndUtc: end.toISOString(), provisionalUntilUtc: undefined } : q)
            audits = pushAudit(audits, { actor: st.session?.email ?? 'admin', action: 'receipt.approve', target: id, reason, outcome: `credited once · extended to ${end.toISOString().slice(0, 10)}` })
          } else if (decision !== 'APPROVED') {
            qrs = st.qrs.map(q => q.shortCode === qr?.shortCode && q.subscription === 'PROVISIONAL_ACTIVE'
              ? { ...q, subscription: 'EXPIRED', provisionalUntilUtc: undefined } : q)
            audits = pushAudit(audits, { actor: st.session?.email ?? 'admin', action: `receipt.${decision.toLowerCase()}`, target: id, reason, outcome: 'provisional entitlement revoked' })
          }
          return {
            receipts: st.receipts.map(r => r.id === id ? {
              ...r, state: decision, credited: decision === 'APPROVED' ? true : r.credited,
              notes: [{ at: now(), actor: st.session?.email ?? 'admin', text: reason ?? `Marked ${decision}` }, ...r.notes],
            } : r),
            qrs, audits,
            activities: pushActivity(st.activities, rec.accountEmail, { kind: 'payment', text: decision === 'APPROVED' ? 'Payment verified — subscription renewed ✔' : `Receipt ${decision.toLowerCase()} — ${reason ?? 'see notes'}` }),
          }
        })
      },

      orderCard({ email, business, product, qty, template, city }) {
        const id = `co-${2000 + Math.floor(Math.random() * 900)}`
        const unit: Record<string, number> = { 'plastic-card': 149, 'table-tent': 299, 'counter-card': 199, sticker: 21, 'packaging-insert': 15 }
        set(s => ({
          orders: [{ id, accountEmail: email, businessName: business, product, quantity: qty, template, state: 'NEW', placedAt: now(), total: (unit[product] ?? 100) * qty, shippingCity: city }, ...s.orders],
          activities: pushActivity(s.activities, email, { kind: 'order', text: `Card order ${id} placed · ${qty}× ${product.replace('-', ' ')}` }),
          audits: pushAudit(s.audits, { actor: email, action: 'cardorder.create', target: id, outcome: 'NEW' }),
        }))
      },

      advanceOrder(id) {
        const flow: CardOrder['state'][] = ['NEW', 'DESIGN_REVIEW', 'APPROVED', 'PRINTING', 'SHIPPED', 'DELIVERED']
        set(s => ({
          orders: s.orders.map(o => o.id === id ? { ...o, state: flow[Math.min(flow.indexOf(o.state) + 1, flow.length - 1)] } : o),
          audits: pushAudit(s.audits, { actor: s.session?.email ?? 'print.staff', action: 'cardorder.advance', target: id, outcome: 'status moved forward' }),
        }))
      },

      recordScan(code, outcome) {
        set(s => ({ qrs: s.qrs.map(q => q.shortCode === code ? { ...q, scans: q.scans + 1 } : q) }))
      },
    }),
    { name: 'reviewdoor-store', version: 3 },
  ),
)

export function qrByCode(code: string) {
  return useApp.getState().qrs.find(q => q.shortCode.toLowerCase() === code.toLowerCase()) ??
    (code.toUpperCase() === DEMO_QR.shortCode ? DEMO_QR : undefined)
}
export { DEMO_QR, effectiveRouting }
