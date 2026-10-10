import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, XCircle, AlertTriangle, ShieldAlert, Search, ScrollText, Ban, RotateCcw, Archive,
  Users, QrCode as QrIcon, ReceiptText, Printer, TrendingUp, ExternalLink, ChevronRight, Filter, FileSearch,
} from 'lucide-react'
import { useApp, PLANS } from '../lib/store'
import { statusOf, effectiveRouting, money, Receipt, AuditEvent } from '../lib/domain'
import { StatusChip, QrView } from '../components/Ui'
import { ReceiptStateChip } from './client'
import { OrderFlow } from './clientMore'

const fmtDT = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/* ═══════════ OPERATIONS OVERVIEW ═══════════ */
export function AdminOverview() {
  const qrs = useApp(s => s.qrs)
  const receipts = useApp(s => s.receipts)
  const orders = useApp(s => s.orders)
  const audits = useApp(s => s.audits)

  const active = qrs.filter(q => effectiveRouting(q) === 'REDIRECT').length
  const pending = receipts.filter(r => ['PENDING', 'PROCESSING', 'NEEDS_REVIEW'].includes(r.state)).length
  const printing = orders.filter(o => ['NEW', 'DESIGN_REVIEW', 'APPROVED', 'PRINTING'].includes(o.state)).length
  const expiringSoon = qrs.filter(q => { const d = (new Date(q.periodEndUtc).getTime() - Date.now()) / 86400_000; return d > 0 && d < 7 }).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-cream">Operations overview</h1>
        <p className="text-sm text-cream/55 mt-1">Queue-oriented view of routing, verification and fulfilment health.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['QRs routing live', active, 'teal', QrIcon, '/admin/qr'],
          ['Receipts awaiting decision', pending, 'gold', ReceiptText, '/admin/receipts'],
          ['Card orders in production', printing, 'peach', Printer, '/admin/orders'],
          ['Expiring within 7 days', expiringSoon, 'danger', TrendingUp, '/admin/qr'],
        ].map(([l, v, tone, I, to]: any) => (
          <motion.div key={l} whileHover={{ y: -3 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <a href={to} className={`block rounded-xl2 p-5 border ${tone === 'teal' ? 'bg-teal/90 border-teal' : tone === 'gold' ? 'bg-gold/15 border-gold/40' : tone === 'peach' ? 'bg-peach/15 border-peach/40' : 'bg-red-900/30 border-red-500/40'} hover:brightness-110 transition`}>
              <I size={18} className={tone === 'gold' ? 'text-gold' : tone === 'peach' ? 'text-peach' : tone === 'danger' ? 'text-red-400' : 'text-cream/70'} />
              <p className={`font-display text-3xl font-semibold mt-2 ${tone === 'gold' ? 'text-gold' : 'text-cream'}`}>{v}</p>
              <p className={`text-xs font-extrabold uppercase tracking-wider mt-1 ${tone === 'gold' ? 'text-gold/70' : 'text-cream/55'}`}>{l}</p>
            </a>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* needs attention queue */}
        <div className="rounded-xl2 bg-white/6 border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-display font-semibold text-cream flex items-center gap-2"><ShieldAlert size={16} className="text-gold" /> Needs attention</h3>
            <span className="chip-gold">{pending + expiringSoon}</span>
          </div>
          <ul className="divide-y divide-white/8">
            {receipts.filter(r => !['APPROVED', 'REJECTED'].includes(r.state)).slice(0, 3).map(r => (
              <li key={r.id} className="px-5 py-3.5 flex items-center gap-3 text-sm">
                <ReceiptStateChip s={r.state} />
                <span className="text-cream/80 flex-1 truncate">{r.businessName} · {money(Number(r.amount.value))} · <b className="font-mono">{r.id}</b></span>
                <a href="/admin/receipts" className="btn !bg-white/8 text-cream hover:!bg-white/15 btn-sm">Review <ChevronRight size={13} /></a>
              </li>
            ))}
            {qrs.filter(q => q.subscription === 'GRACE' || q.operational === 'SUSPENDED').slice(0, 3).map(q => (
              <li key={q.shortCode} className="px-5 py-3.5 flex items-center gap-3 text-sm">
                <StatusChip s={statusOf(q)} />
                <span className="text-cream/80 flex-1 truncate">QR #{q.shortCode} — {q.destination.label}</span>
                <a href="/admin/qr" className="btn !bg-white/8 text-cream hover:!bg-white/15 btn-sm">Inspect <ChevronRight size={13} /></a>
              </li>
            ))}
          </ul>
        </div>

        {/* recent audit stream */}
        <div className="rounded-xl2 bg-white/6 border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-display font-semibold text-cream flex items-center gap-2"><ScrollText size={16} className="text-gold" /> Recent actions</h3>
            <a href="/admin/audit" className="text-xs font-bold text-gold hover:underline">Full log →</a>
          </div>
          <ul className="divide-y divide-white/8">
            {audits.slice(0, 6).map(a => (
              <li key={a.id} className="px-5 py-3 text-sm flex gap-3">
                <span className="font-mono text-[10px] text-cream/40 w-24 shrink-0 pt-0.5">{fmtDT(a.at)}</span>
                <span className="flex-1 text-cream/75"><b className="text-cream font-mono text-xs">{a.action}</b> on {a.target} by {a.actor}{a.reason ? ` — ${a.reason}` : ''} <span className="text-gold/90 font-bold">→ {a.outcome}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/* ═══════════ RECEIPT QUEUE ═══════════ */
export function AdminReceipts() {
  const receipts = useApp(s => s.receipts)
  const decide = useApp(s => s.decideReceipt)
  const renew = useApp(s => s.renewWithApproval)
  const qrs = useApp(s => s.qrs)
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const list = receipts
    .filter(r => filter === 'ALL' || !['APPROVED', 'REJECTED', 'DUPLICATE'].includes(r.state))
    .filter(r => !q || (r.id + r.businessName + r.accountEmail + r.txnId.value).toLowerCase().includes(q.toLowerCase()))
  const sel = receipts.find(r => r.id === selId) ?? null
  const linkedQr = sel ? qrs.find(x => x.accountEmail === sel.accountEmail) : null

  const approve = () => {
    if (!sel || !linkedQr) return
    decide(sel.id, 'APPROVED', reason || undefined)
    renew(linkedQr.shortCode, sel.planId)
    setReason('')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream">Receipt verification queue</h1>
          <p className="text-sm text-cream/55 mt-1">OCR fields → rule checks → risk flags → single authoritative credit.</p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/40" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search id, txn, business…"
              className="rounded-xl bg-white/8 border border-white/12 pl-9 pr-3 py-2 text-sm text-cream placeholder:text-cream/35 focus:border-gold focus:outline-none w-56" />
          </span>
          <button onClick={() => setFilter(f => f === 'OPEN' ? 'ALL' : 'OPEN')} className="btn !bg-white/8 text-cream hover:!bg-white/15 btn-sm"><Filter size={13} /> {filter === 'OPEN' ? 'Open only' : 'All states'}</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_420px] gap-5 items-start">
        <div className="rounded-xl2 bg-white/6 border border-white/10 overflow-hidden">
          <table className="w-full min-w-[640px]">
            <thead><tr>{['Receipt', 'Business', 'Amount', 'Risk', 'State', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-cream/45 border-b border-white/10">{h}</th>))}</tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} onClick={() => setSelId(r.id)}
                  className={`cursor-pointer border-b border-white/6 hover:bg-white/6 transition ${selId === r.id ? 'bg-white/10' : ''}`}>
                  <td className="px-4 py-3.5 text-sm font-mono text-gold">{r.id}<div className="text-[10px] text-cream/40 font-sans">{fmtDT(r.submittedAt)}</div></td>
                  <td className="px-4 py-3.5 text-sm text-cream/85">{r.businessName}<div className="text-[10px] text-cream/40">{r.accountEmail}</div></td>
                  <td className="px-4 py-3.5 text-sm font-bold text-cream">{money(Number(r.amount.value))}</td>
                  <td className="px-4 py-3.5">{r.riskFlags.length ? <span className="chip !bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30"><AlertTriangle size={12} /> {r.riskFlags.length}</span> : <span className="chip !bg-emerald-500/12 text-emerald-300 ring-1 ring-inset ring-emerald-400/25"><CheckCircle2 size={12} /> clear</span>}</td>
                  <td className="px-4 py-3.5"><ReceiptStateChip s={r.state} /></td>
                  <td className="px-4 py-3.5"><ExternalLink size={14} className="text-cream/40" /></td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-cream/45 text-sm">Queue is clear 🎉 — no receipts need a decision.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* detail drawer */}
        <AnimatePresence mode="wait">
          {sel ? (
            <motion.aside key={sel.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}
              className="rounded-xl2 bg-white/8 border border-white/12 p-5 space-y-4 sticky top-24">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-semibold text-cream text-lg">{sel.id}</h3>
                <ReceiptStateChip s={sel.state} />
              </div>
              <div className="rounded-xl bg-ink/60 border border-white/10 p-4 relative overflow-hidden">
                <FileSearch size={16} className="text-gold mb-2" />
                <p className="text-xs font-bold text-cream/70">Original evidence · {sel.fileName}</p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {Object.entries({ Amount: sel.amount, Txn: sel.txnId, Reference: sel.reference, Date: sel.date, Sender: sel.sender, Payee: sel.payee, Channel: sel.channel, Quality: sel.quality }).map(([k, f]: any) => (
                    <p key={k} className="flex justify-between gap-2 text-cream/80">
                      <span className="text-cream/45">{k}</span>
                      <span className="font-mono font-bold text-right truncate max-w-36">{f.value}</span>
                      <span className={`${f.confidence >= .85 ? 'text-emerald-400' : f.confidence >= .7 ? 'text-gold' : 'text-red-400'} font-mono`}>{f.confidence.toFixed(2)}</span>
                    </p>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-cream/40">Model: {sel.ocrModel} via {sel.ocrProvider} — confidence shown per field.</p>
              </div>

              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-cream/45 mb-2">Rule checks</p>
                <ul className="space-y-1.5">
                  {sel.ruleChecks.map(c => (
                    <li key={c.rule} className="flex gap-2 text-xs">
                      {c.passed ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <XCircle size={14} className="text-red-400 shrink-0" />}
                      <span className="text-cream/75"><b className="text-cream">{c.rule}.</b> {c.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {sel.riskFlags.length > 0 && (
                <div className="rounded-xl bg-red-500/12 border border-red-400/30 p-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-red-300 mb-1.5 inline-flex items-center gap-1.5"><ShieldAlert size={13} /> Risk flags — provisional access blocked</p>
                  {sel.riskFlags.map(f => <p key={f} className="text-xs text-red-200/90">• {f}</p>)}
                </div>
              )}

              {sel.notes.length > 0 && (
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-cream/45 mb-1.5">Notes</p>
                  {sel.notes.map((n, i) => <p key={i} className="text-xs text-cream/70 mb-1"><b className="text-cream/90">{n.actor}</b> · {fmtDT(n.at)}<br />{n.text}</p>)}
                </div>
              )}

              {!['APPROVED', 'REJECTED'].includes(sel.state) && (
                <>
                  <input className="w-full rounded-xl bg-white/8 border border-white/12 px-3 py-2 text-sm text-cream placeholder:text-cream/35 focus:border-gold focus:outline-none"
                    placeholder="Reason / note for audit (required for reject)" value={reason} onChange={e => setReason(e.target.value)} />
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={approve} disabled={!!sel.credited}
                      className="btn !bg-emerald-600 text-white hover:!bg-emerald-500 btn-sm disabled:opacity-40" title="Credits exactly once — idempotent">
                      <CheckCircle2 size={13} /> Approve</button>
                    <button onClick={() => { decide(sel.id, 'REJECTED', reason || 'Failed manual verification'); setReason('') }}
                      className="btn !bg-red-600/90 text-white hover:!bg-red-600 btn-sm"><XCircle size={13} /> Reject</button>
                    <button onClick={() => { decide(sel.id, 'DUPLICATE', reason || 'Duplicate submission'); setReason('') }}
                      className="btn !bg-white/10 text-cream hover:!bg-white/20 btn-sm"><Ban size={13} /> Duplicate</button>
                  </div>
                  {sel.credited && <p className="text-[11px] text-gold font-bold">Already credited — approval is idempotent; a second approve cannot double-extend.</p>}
                </>
              )}
            </motion.aside>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl2 border border-dashed border-white/15 p-10 text-center text-cream/40 text-sm">
              Select a receipt to inspect extracted fields, rule checks and risk flags.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ═══════════ QR MODERATION ═══════════ */
export function AdminQrs() {
  const qrs = useApp(s => s.qrs)
  const setOp = useApp(s => s.setOperational)
  const [q, setQ] = useState('')
  const list = qrs.filter(x => (x.shortCode + x.destination.label + x.accountEmail).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream">QR moderation & state</h1>
          <p className="text-sm text-cream/55 mt-1">Operational controls override entitlement for routing. Suspension ≠ expiration.</p>
        </div>
        <span className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/40" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, business, owner…"
            className="rounded-xl bg-white/8 border border-white/12 pl-9 pr-3 py-2 text-sm text-cream placeholder:text-cream/35 focus:border-gold focus:outline-none w-64" />
        </span>
      </div>

      <div className="rounded-xl2 bg-white/6 border border-white/10 overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead><tr>{['QR', 'Business / owner', 'Subscription', 'Operational', 'Effective routing', 'Scans', 'Controls'].map(h => (
            <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-cream/45 border-b border-white/10">{h}</th>))}</tr></thead>
          <tbody>
            {list.map(qr => {
              const out = effectiveRouting(qr)
              return (
                <tr key={qr.shortCode} className="border-b border-white/6 hover:bg-white/5 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="scale-[0.42] origin-left -ml-4 -mr-6 rounded-md overflow-hidden"><QrView url={`https://reviewdoor.app/q/${qr.shortCode}`} size={84} /></div>
                      <div><p className="font-mono font-bold text-gold text-sm">{qr.shortCode}</p>
                        <p className="text-[10px] text-cream/40">since {new Date(qr.createdAt).toLocaleDateString()}</p></div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-cream/85 max-w-56"><p className="truncate font-semibold">{qr.destination.label}</p><p className="text-[11px] text-cream/45 truncate">{qr.accountEmail}</p></td>
                  <td className="px-4 py-3"><StatusChip s={statusOf(qr)} /></td>
                  <td className="px-4 py-3"><OpChip op={qr.operational} /></td>
                  <td className="px-4 py-3"><AdminRouteBadge o={out} /></td>
                  <td className="px-4 py-3 text-sm font-mono text-cream/70">{qr.scans.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {qr.operational !== 'SUSPENDED'
                        ? <button onClick={() => setOp(qr.shortCode, 'SUSPENDED')} title="Suspend (moderation)" className="btn !bg-white/8 text-cream hover:!bg-red-500/30 btn-sm !px-2"><Ban size={13} /></button>
                        : <button onClick={() => setOp(qr.shortCode, 'ENABLED')} title="Restore" className="btn !bg-white/8 text-cream hover:!bg-emerald-500/30 btn-sm !px-2"><RotateCcw size={13} /></button>}
                      {qr.operational !== 'ARCHIVED'
                        ? <button onClick={() => setOp(qr.shortCode, 'ARCHIVED')} title="Archive" className="btn !bg-white/8 text-cream hover:!bg-white/20 btn-sm !px-2"><Archive size={13} /></button>
                        : <button onClick={() => setOp(qr.shortCode, 'ENABLED')} title="Unarchive" className="btn !bg-white/8 text-cream hover:!bg-white/20 btn-sm !px-2"><RotateCcw size={13} /></button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-cream/40">Every control writes actor + reason to the audit trail. Suspended QRs show visitors a safe page; archived codes 404 gracefully.</p>
    </div>
  )
}
function OpChip({ op }: { op: string }) {
  const c = op === 'ENABLED' ? '!bg-emerald-500/12 text-emerald-300 ring-emerald-400/25' : op === 'SUSPENDED' ? '!bg-red-500/15 text-red-300 ring-red-400/30' : '!bg-white/10 text-cream/60 ring-white/20'
  return <span className={`chip ring-1 ring-inset ${c}`}>{op}</span>
}
function AdminRouteBadge({ o }: { o: string }) {
  const map: Record<string, string> = {
    REDIRECT: '!bg-teal/30 text-cream ring-teal/50', EXPIRED: '!bg-red-500/15 text-red-300 ring-red-400/30',
    SUSPENDED: '!bg-white/10 text-cream/70 ring-white/20', NOT_FOUND: '!bg-white/10 text-cream/50 ring-white/15', ERROR: '!bg-gold/20 text-gold ring-gold/40',
  }
  return <span className={`chip ring-1 ring-inset font-mono text-[11px] ${map[o]}`}>{o === 'REDIRECT' ? '302 → destination' : o}</span>
}

/* ═══════════ CARD ORDERS ═══════════ */
export function AdminOrders() {
  const orders = useApp(s => s.orders)
  const advance = useApp(s => s.advanceOrder)
  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl text-cream">Print order fulfilment</h1>
      <p className="text-sm text-cream/55 -mt-3">Design review gate → approved artwork → production. Failed decode blocks production.</p>
      <div className="rounded-xl2 bg-white/6 border border-white/10 overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr>{['Order', 'Business', 'Product', 'Qty', 'Total', 'Pipeline', 'Action'].map(h => (
            <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-cream/45 border-b border-white/10">{h}</th>))}</tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="border-b border-white/6 hover:bg-white/5">
                <td className="px-4 py-3.5 text-sm font-mono text-gold">{o.id}<div className="text-[10px] text-cream/40 font-sans">{fmtDT(o.placedAt)}</div></td>
                <td className="px-4 py-3.5 text-sm text-cream/85">{o.businessName}<div className="text-[11px] text-cream/45">{o.shippingCity}</div></td>
                <td className="px-4 py-3.5 text-sm text-cream/75 capitalize">{o.product.replace(/-/g, ' ')}<div className="text-[10px] text-cream/40 font-mono">{o.template}</div></td>
                <td className="px-4 py-3.5 text-sm font-bold text-cream">{o.quantity}</td>
                <td className="px-4 py-3.5 text-sm font-bold text-cream">{money(o.total)}</td>
                <td className="px-4 py-3.5"><div className="invert opacity-80"><OrderFlow state={o.state} /></div></td>
                <td className="px-4 py-3.5">
                  {o.state !== 'DELIVERED'
                    ? <button onClick={() => advance(o.id)} className="btn !bg-white/8 text-cream hover:!bg-teal btn-sm">Advance <ChevronRight size={13} /></button>
                    : <span className="chip !bg-emerald-500/12 text-emerald-300 ring-1 ring-inset ring-emerald-400/25"><CheckCircle2 size={12} /> done</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════ AUDIT LOG ═══════════ */
export function AdminAudit() {
  const audits = useApp(s => s.audits)
  const [q, setQ] = useState('')
  const list = audits.filter(a => (a.actor + a.action + a.target + (a.outcome ?? '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream">Audit trail</h1>
          <p className="text-sm text-cream/55 mt-1">Append-only record of every privileged action: who, when, what, why, outcome.</p>
        </div>
        <span className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/40" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter events…"
            className="rounded-xl bg-white/8 border border-white/12 pl-9 pr-3 py-2 text-sm text-cream placeholder:text-cream/35 focus:border-gold focus:outline-none w-56" />
        </span>
      </div>
      <div className="rounded-xl2 bg-white/6 border border-white/10 overflow-hidden">
        <ul className="divide-y divide-white/6">
          {list.map(a => (
            <li key={a.id} className="px-5 py-3.5 flex flex-wrap gap-x-4 gap-y-1 items-center text-sm hover:bg-white/5">
              <span className="font-mono text-[11px] text-cream/40 w-32 shrink-0">{fmtDT(a.at)}</span>
              <span className="chip !bg-gold/15 text-gold ring-1 ring-inset ring-gold/30 font-mono text-[11px] shrink-0">{a.action}</span>
              <span className="text-cream/80"><b>{a.target}</b> by <span className="font-mono text-xs text-cream/60">{a.actor}</span></span>
              {a.reason && <span className="text-cream/50 italic text-xs">“{a.reason}”</span>}
              <span className="ml-auto text-xs font-bold text-emerald-300/90">{a.outcome}</span>
            </li>
          ))}
          {!list.length && <li className="px-5 py-10 text-center text-cream/40 text-sm">No matching events.</li>}
        </ul>
      </div>
    </div>
  )
}
