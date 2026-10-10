/* ─────────────────────────────────────────────────────────────
   ReviewDoor · Domain types & effective-state engine
   Centralizes subscription + operational truth per SRS §5 / Design §4–6.
   All business rules live here — never duplicated in page components (NFR-09).
   ──────────────────────────────────────────────────────────── */

export type Role = 'visitor' | 'client' | 'admin'

export type OperationalState = 'ENABLED' | 'SUSPENDED' | 'ARCHIVED'

export type SubscriptionState =
  | 'TRIAL'
  | 'PROVISIONAL_ACTIVE'
  | 'ACTIVE'
  | 'GRACE'
  | 'PAST_DUE'
  | 'EXPIRED'
  | 'CANCELED'

export type ReceiptState = 'PENDING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'DUPLICATE'

export type CardOrderState =
  | 'NEW' | 'DESIGN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'
  | 'PRINTING' | 'SHIPPED' | 'DELIVERED' | 'CANCELED' | 'PRINT_FAILED' | 'RETURNED'

export type RoutingOutcome = 'REDIRECT' | 'EXPIRED' | 'SUSPENDED' | 'NOT_FOUND' | 'ERROR'

export interface Plan {
  id: string
  name: string
  priceMonthly: number
  priceYearly: number
  currency: string
  durationDays: number
  graceDays: number
  trialDays: number
  provisionalHours: number
  includedQrs: number
  printEntitlement: boolean
  recommended?: boolean
  features: string[]
}

export interface Destination {
  platform: 'google' | 'foodpanda' | 'tripadvisor' | 'facebook' | 'instagram' | 'custom'
  url: string
  label: string
  valid: boolean
  updatedAt: string
}

export interface QrCode {
  shortCode: string
  businessId: string
  accountEmail: string
  destination: Destination
  operational: OperationalState
  subscription: SubscriptionState
  periodEndUtc: string            // ISO
  provisionalUntilUtc?: string
  planId: string
  createdAt: string
  scans: number
}

export interface ScanEvent {
  id: string
  shortCode: string
  atUtc: string
  device: 'mobile' | 'desktop' | 'tablet'
  country: string
  city: string
  outcome: RoutingOutcome
}

export interface ReceiptField { value: string; confidence: number }
export interface RuleCheck { rule: string; passed: boolean; detail: string }

export interface Receipt {
  id: string
  accountEmail: string
  businessName: string
  planId: string
  amount: ReceiptField
  currency: ReceiptField
  txnId: ReceiptField
  reference: ReceiptField
  date: ReceiptField
  sender: ReceiptField
  payee: ReceiptField
  channel: ReceiptField
  quality: ReceiptField
  method: 'bank-transfer' | 'wallet' | 'card'
  submittedAt: string
  state: ReceiptState
  riskFlags: string[]
  ruleChecks: RuleCheck[]
  fileName: string
  ocrProvider: string
  ocrModel: string
  credited: boolean
  notes: { at: string; actor: string; text: string }[]
}

export interface CardOrder {
  id: string
  accountEmail: string
  businessName: string
  product: 'plastic-card' | 'table-tent' | 'counter-card' | 'sticker' | 'packaging-insert'
  quantity: number
  template: string
  state: CardOrderState
  placedAt: string
  total: number
  shippingCity: string
}

export interface AuditEvent {
  id: string
  at: string
  actor: string
  action: string
  target: string
  reason?: string
  outcome: string
}

export interface ActivityEvent {
  id: string
  at: string
  kind: 'scan' | 'payment' | 'system' | 'order'
  text: string
}

/* ── Effective routing state (single authoritative calculation) ── */
export function effectiveRouting(qr: QrCode, now = new Date()): RoutingOutcome {
  if (qr.operational === 'ARCHIVED') return 'NOT_FOUND'
  if (qr.operational === 'SUSPENDED') return 'SUSPENDED'
  switch (qr.subscription) {
    case 'TRIAL':
    case 'ACTIVE':
    case 'GRACE':
      return 'REDIRECT'
    case 'PROVISIONAL_ACTIVE':
      return qr.provisionalUntilUtc && new Date(qr.provisionalUntilUtc) > now ? 'REDIRECT' : 'EXPIRED'
    case 'PAST_DUE':
    case 'EXPIRED':
    case 'CANCELED':
      return 'EXPIRED'
  }
}

/* ── Renewal calculation (Design §6.1) ── */
export function computeRenewedPeriodEnd(
  subState: SubscriptionState,
  currentPeriodEndUtc: string,
  durationDays: number,
  now = new Date(),
): Date {
  const activeLike = ['ACTIVE', 'TRIAL', 'GRACE', 'PROVISIONAL_ACTIVE'].includes(subState)
  const base = activeLike ? new Date(currentPeriodEndUtc) : now
  // grace does not create a new entitlement period → renew from period end when still paid-like
  return new Date(base.getTime() + durationDays * 86400_000)
}

export function daysUntil(iso: string, now = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86400_000)
}

/* ── Derived status chip model: icon + text, never color alone (§10.2) ── */
export interface StatusModel {
  key: string
  label: string
  sub: string
  tone: 'teal' | 'gold' | 'peach' | 'danger' | 'neutral'
  iconHint: 'check' | 'clock' | 'alert' | 'ban' | 'archive'
}

export function statusOf(qr: QrCode): StatusModel {
  if (qr.operational === 'ARCHIVED')
    return { key: 'archived', label: 'Archived', sub: 'This QR is retired.', tone: 'neutral', iconHint: 'archive' }
  if (qr.operational === 'SUSPENDED')
    return { key: 'suspended', label: 'Suspended', sub: 'Temporarily unavailable — contact support.', tone: 'danger', iconHint: 'ban' }
  switch (qr.subscription) {
    case 'ACTIVE':
      return { key: 'active', label: 'Active', sub: 'Your QR is live and receiving scans.', tone: 'teal', iconHint: 'check' }
    case 'TRIAL':
      return { key: 'trial', label: 'Trial active', sub: 'Free trial — add a plan before it ends.', tone: 'teal', iconHint: 'check' }
    case 'PROVISIONAL_ACTIVE':
      return { key: 'provisional', label: 'Under verification', sub: 'QR temporarily active while your payment is reviewed.', tone: 'gold', iconHint: 'clock' }
    case 'GRACE':
      return { key: 'grace', label: 'In grace period', sub: 'Still working — renew to keep it active.', tone: 'peach', iconHint: 'alert' }
    case 'PAST_DUE':
      return { key: 'past-due', label: 'Past due', sub: 'Payment expected. Renew to restore service.', tone: 'peach', iconHint: 'alert' }
    case 'EXPIRED':
      return { key: 'expired', label: 'Inactive', sub: 'Service ended. Renew to reactivate the same QR.', tone: 'danger', iconHint: 'alert' }
    case 'CANCELED':
      return { key: 'canceled', label: 'Canceled', sub: 'Subscription was canceled.', tone: 'neutral', iconHint: 'ban' }
  }
}

/* ── URL validation helper (FR-06: validate format, don't over-promise) ── */
const PLATFORM_PATTERNS: Record<string, RegExp> = {
  google: /^https:\/\/(www\.google\.com|maps\.app\.goo\.gl|g\.page)\//i,
  foodpanda: /^https:\/\/(\w+\.)?foodpanda\./i,
  tripadvisor: /^https:\/\/(www\.)?tripadvisor\./i,
  facebook: /^https:\/\/(www\.|m\.)?facebook\.com\//i,
  instagram: /^https:\/\/(www\.)?instagram\.com\//i,
  custom: /^https?:\/\//i,
}

export function validateDestination(platform: string, url: string): { ok: boolean; message: string } {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { ok: false, message: 'Enter a full web address starting with https://' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    return { ok: false, message: 'Only http/https destinations are allowed (open-redirect safeguard).' }
  const re = PLATFORM_PATTERNS[platform] ?? PLATFORM_PATTERNS.custom
  if (!re.test(url.trim()))
    return {
      ok: true,
      message: `URL format is valid but doesn’t match the usual ${platform} pattern — double-check you pasted the review link.`,
    }
  return { ok: true, message: 'Looks good. Format verified — third-party availability can’t be guaranteed by us.' }
}

export const money = (n: number, cur = 'PKR') => `${cur} ${n.toLocaleString('en-US')}`
