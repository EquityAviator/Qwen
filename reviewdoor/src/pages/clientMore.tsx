import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts'
import {
  QrCode, UploadCloud, CheckCircle2, XCircle, Copy, ShieldAlert, Clock3, FileSearch, Printer, ChevronRight,
} from 'lucide-react'
import { useApp, PLANS, demoScans } from '../lib/store'
import { Receipt, CardOrder, money, statusOf } from '../lib/domain'
import { StatusChip, QrView } from '../components/Ui'
import { ReceiptStateChip, RoutingBadge } from './client'

const DAY = 86400_000
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtDT = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/* ═══════════ ANALYTICS ═══════════ */
export function Analytics() {
  const session = useApp(s => s.session)!
  const qrs = useApp(s => s.qrs.filter(q => q.accountEmail === session.email))
  const [code, setCode] = useState(qrs[0]?.shortCode ?? 'DEMO42')
  const [range, setRange] = useState(30)

  const daily = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = range; i >= 0; i--) map.set(new Date(Date.now() - i * DAY).toISOString().slice(0, 10), 0)
    demoScans.forEach(e => { const k = e.atUtc.slice(0, 10); if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1) })
    return [...map.entries()].map(([d, n]) => ({ d: fmtD(d), n }))
  }, [range])
  const hourly = useMemo(() => Array.from({ length: 24 }, (_, h) => ({ h: `${h}h`, n: Math.round(30 + 55 * Math.exp(-((h - 21) ** 2) / 18) + (h % 5) * 4) })), [])
  const devices = [{ name: 'Mobile', v: 87, c: '#004643' }, { name: 'Tablet', v: 8, c: '#D1AC00' }, { name: 'Desktop', v: 5, c: '#F6BE9A' }]
  const geo = [{ city: 'Karachi', n: 41 }, { city: 'Lahore', n: 27 }, { city: 'Islamabad', n: 15 }, { city: 'Dubai', n: 9 }, { city: 'London', n: 5 }]
  const total = daily.reduce((a, b) => a + b.n, 0)
  const qr = qrs.find(q => q.shortCode === code)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-2xl">Analytics</h1>
          <p className="text-sm text-ink/60 mt-1">Aggregate scan behaviour · privacy-safe by design (no personal identification).</p>
        </div>
        <div className="flex gap-2">
          <select className="input !w-auto !py-2 text-xs font-bold" value={code} onChange={e => setCode(e.target.value)}>
            {(qrs.length ? qrs : [{ shortCode: 'DEMO42' } as any]).map(q => <option key={q.shortCode} value={q.shortCode}>QR #{q.shortCode}</option>)}
          </select>
          {[7, 30, 90].map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`btn btn-sm ${range === r ? '!bg-teal !text-cream' : 'btn-secondary'}`}>{r}d</button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        {[['Scans', total.toLocaleString()], ['Unique days active', String(daily.filter(d => d.n > 0).length)], ['Peak hour', '21:00'], ['Mobile share', '87%']].map(([l, v]) => (
          <motion.div key={l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-solid p-4">
            <p className="label !mb-1">{l}</p><p className="font-display font-semibold text-2xl">{v}</p>
          </motion.div>
        ))}
      </div>

      <div className="card-solid p-5">
        <h3 className="font-display font-semibold mb-3">Scans per day</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={daily}>
            <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#004643" stopOpacity={.35} /><stop offset="100%" stopColor="#004643" stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#0C1618', opacity: .5 }} interval={Math.ceil(range / 8)} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#0C1618', opacity: .5 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(12,22,24,.1)', fontSize: 12, fontFamily: 'Manrope' }} />
            <Area type="monotone" dataKey="n" stroke="#004643" strokeWidth={2.5} fill="url(#g1)" animationDuration={900} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="card-solid p-5">
          <h3 className="font-display font-semibold mb-3">By hour (local)</h3>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={hourly}>
              <XAxis dataKey="h" hide />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} cursor={{ fill: 'rgba(0,70,67,.06)' }} />
              <Bar dataKey="n" radius={[4, 4, 0, 0]} animationDuration={800}>
                {hourly.map((_, i) => <Cell key={i} fill={i === 21 ? '#D1AC00' : '#0B5B57'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="help">Dinner hours dominate — print cards near the bill, not the door.</p>
        </div>
        <div className="card-solid p-5">
          <h3 className="font-display font-semibold mb-3">Device mix</h3>
          <div className="relative">
            <PieChart width={280} height={170}>
              <Pie data={devices} dataKey="v" innerRadius={48} outerRadius={72} paddingAngle={3} cornerRadius={5} animationDuration={800}>
                {devices.map(d => <Cell key={d.name} fill={d.c} />)}
              </Pie>
            </PieChart>
            <span className="absolute inset-0 grid place-items-center pointer-events-none">
              <span className="text-center"><b className="font-display text-xl block leading-none">87%</b><i className="text-[10px] uppercase tracking-wider text-ink/45 font-bold not-italic">mobile</i></span>
            </span>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs font-bold">
            {devices.map(d => <li key={d.name} className="flex justify-between"><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: d.c }} />{d.name}</span>{d.v}%</li>)}
          </ul>
        </div>
        <div className="card-solid p-5">
          <h3 className="font-display font-semibold mb-3">Top cities</h3>
          <ul className="space-y-3">
            {geo.map((g, i) => (
              <li key={g.city}>
                <div className="flex justify-between text-xs font-bold mb-1"><span>{g.city}</span><span className="text-ink/50">{g.n}%</span></div>
                <div className="h-2 rounded-full bg-ink/6 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${g.n}%` }} transition={{ delay: .2 + i * .1, duration: .7 }} className="h-full bg-teal rounded-full" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {qr && (
        <div className="card-solid p-5 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="label !mb-1">Routing health · QR #{qr.shortCode}</p>
            <div className="flex items-center gap-3"><StatusChip s={statusOf(qr)} /><RoutingBadge outcome={'REDIRECT'} /></div>
          </div>
          <div className="text-sm text-ink/60 ml-auto max-w-md">
            Redirect success <b className="text-teal">99.4%</b> · fallback pages served <b>0.6%</b> · errors <b>0%</b>.
            Expired/suspended visitors still get a branded page instead of an error.
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════ RECEIPTS (client side) ═══════════ */
export function ClientReceipts() {
  const session = useApp(s => s.session)!
  const qrs = useApp(s => s.qrs.filter(q => q.accountEmail === session.email))
  const receipts = useApp(s => s.receipts.filter(r => r.accountEmail === session.email))
  const submit = useApp(s => s.submitReceipt)
  const primary = qrs[0]
  const [form, setForm] = useState({ planId: 'starter', amount: '', txn: '', ref: '', method: 'bank-transfer', fileName: '' })
  const [result, setResult] = useState<{ id: string; provisional: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!primary) return <p className="card-solid p-8 text-sm text-ink/60">Create a QR first, then renewals appear here.</p>

  const doSubmit = () => {
    setBusy(true)
    setTimeout(() => {
      const res = submit({ code: primary.shortCode, planId: form.planId, amount: form.amount || String(PLANS.find(p => p.id === form.planId)!.priceMonthly), txn: form.txn, reference: form.ref, method: form.method as any, fileName: form.fileName || 'slip-upload.jpg' })
      setResult(res); setBusy(false)
    }, 1400)
  }

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Payments & receipts</h1>
      <div className="grid lg:grid-cols-[400px_1fr] gap-5 items-start">
        <div className="card-solid p-6">
          <h3 className="font-display font-semibold flex items-center gap-2"><UploadCloud size={17} className="text-teal" /> Submit renewal receipt</h3>
          <ol className="mt-4 space-y-2 text-xs text-ink/60 font-semibold">
            {['Transfer to ReviewDoor with your reference in the note', 'Upload the slip or screenshot below', 'We extract fields and run verification rules', 'Low-risk → instant provisional access while ops approves'].map((t, i) => (
              <li key={i} className="flex gap-2.5"><span className="w-5 h-5 shrink-0 rounded-full bg-teal text-cream grid place-items-center text-[10px] font-black">{i + 1}</span>{t}</li>
            ))}
          </ol>
          <div className="mt-5 space-y-3">
            <div><label className="label">Plan being renewed</label>
              <select className="input" value={form.planId} onChange={e => setForm({ ...form, planId: e.target.value })}>
                {PLANS.map(p => <option key={p.id} value={p.id}>{p.name} — {money(p.priceMonthly)}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Amount paid</label><input className="input" inputMode="numeric" placeholder="5999" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="label">Method</label>
                <select className="input" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}><option value="bank-transfer">Bank transfer</option><option value="wallet">Wallet</option></select></div>
            </div>
            <div><label className="label">Transaction ID</label><input className="input font-mono" placeholder="Easypaisa TXN …" value={form.txn} onChange={e => setForm({ ...form, txn: e.target.value })} /></div>
            <div><label className="label">Payment reference</label><input className="input font-mono" placeholder={`RD-${primary.shortCode.slice(0, 4)}-…`} value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} /></div>
            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-teal/30 hover:border-teal rounded-xl p-4 text-center text-xs font-bold text-ink/55 bg-white/60">
                <FileSearch size={18} className="mx-auto mb-1 text-teal" />
                {form.fileName || 'Attach receipt photo / PDF'}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={e => setForm({ ...form, fileName: e.target.files?.[0]?.name ?? '' })} />
              </div>
            </label>
            <button className="btn-primary w-full" disabled={busy || !form.fileName} onClick={doSubmit}>
              {busy ? <Spinner /> : <CheckCircle2 size={15} />} {busy ? 'Extracting fields…' : 'Submit for verification'}
            </button>
          </div>
          <AnimatePresence>
            {result && (
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold flex gap-2 items-start ${result.provisional ? 'chip-gold !rounded-xl !py-3' : 'chip-danger !rounded-xl !py-3'}`}>
                {result.provisional
                  ? <><CheckCircle2 size={16} className="shrink-0 mt-0.5" /> Receipt {result.id} queued. Provisional access unlocked — your QR routes now while we verify.</>
                  : <><ShieldAlert size={16} className="shrink-0 mt-0.5" /> Receipt {result.id} held for manual review due to risk flags. No provisional access granted.</>}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="card-solid overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <h3 className="font-display font-semibold">My submissions</h3>
            <span className="chip-neutral">{receipts.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead><tr><th className="table-th">Receipt</th><th className="table-th">Amount</th><th className="table-th">Submitted</th><th className="table-th">State</th><th className="table-th">Outcome</th></tr></thead>
              <tbody>
                {receipts.length === 0 && <tr><td className="table-td text-ink/50" colSpan={5}>No receipts yet — your first submission will appear here.</td></tr>}
                {receipts.map(r => (
                  <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-cream-soft/60">
                    <td className="table-td"><span className="font-mono font-bold">{r.id}</span><br /><span className="text-xs text-ink/45">{r.fileName}</span></td>
                    <td className="table-td font-bold">{money(Number(r.amount.value))}</td>
                    <td className="table-td text-ink/60">{fmtDT(r.submittedAt)}</td>
                    <td className="table-td"><ReceiptStateChip s={r.state} /></td>
                    <td className="table-td text-xs text-ink/60 max-w-52">
                      {r.state === 'APPROVED' ? 'Subscription extended ✔' : r.state === 'REJECTED' ? (r.notes[0]?.text ?? 'Rejected') : r.credited ? 'Credited' : 'Verification in progress'}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-4 text-xs text-ink/50">The original receipt remains authoritative evidence even after approval.</p>
        </div>
      </div>
    </div>
  )
}
function Spinner() { return <span className="inline-block h-4 w-4 rounded-full border-2 border-cream/40 border-t-cream animate-spin" /> }

/* ═══════════ CARD ORDERS (client) ═══════════ */
const TEMPLATES = [
  { id: 'restaurant-dark', name: 'Restaurant Dark', tpl: 'dark' },
  { id: 'minimal-white', name: 'Minimal White', tpl: 'light' },
  { id: 'modern-accent', name: 'Modern Accent', tpl: 'accent' },
]
export function ClientCards() {
  const session = useApp(s => s.session)!
  const qrs = useApp(s => s.qrs.filter(q => q.accountEmail === session.email))
  const orders = useApp(s => s.orders.filter(o => o.accountEmail === session.email))
  const orderCard = useApp(s => s.orderCard)
  const primary = qrs[0]
  const [tpl, setTpl] = useState('restaurant-dark')
  const [product, setProduct] = useState<CardOrder['product']>('plastic-card')
  const [qty, setQty] = useState(50)
  const [cta, setCta] = useState('Rate us on Google')
  const [city, setCity] = useState('Karachi')
  const [placed, setPlaced] = useState(false)

  const unit: Record<string, number> = { 'plastic-card': 149, 'table-tent': 299, 'counter-card': 199, sticker: 21, 'packaging-insert': 15 }
  const total = (unit[product] ?? 100) * qty

  if (!primary) return <p className="card-solid p-8 text-sm text-ink/60">Create a QR before ordering printed material.</p>

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Printed cards & materials</h1>
      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="card-solid p-6">
          <h3 className="font-display font-semibold mb-4">Live preview</h3>
          <div className="max-w-md mx-auto">
            <PreviewCard product={product} tpl={TEMPLATES.find(t => t.id === tpl)!.tpl} business={primary.destination.label.split('—')[0].trim()} cta={cta} code={primary.shortCode} />
          </div>
          <div className="mt-5 grid sm:grid-cols-2 gap-3">
            <div><label className="label">Template</label>
              <div className="grid grid-cols-3 gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => setTpl(t.id)} className={`rounded-xl border-2 p-2 text-[11px] font-extrabold transition-all ${tpl === t.id ? 'border-teal bg-teal text-cream' : 'border-ink/10 bg-white hover:border-teal/40'}`}>{t.name}</button>
                ))}
              </div></div>
            <div><label className="label">Call to action</label><input className="input" value={cta} onChange={e => setCta(e.target.value)} maxLength={34} /></div>
          </div>
          <div className="mt-4 card !bg-gold-soft !border-gold/30 p-4 text-xs font-bold text-ink/70 flex gap-2 items-start">
            <ShieldAlert size={15} className="text-gold-deep shrink-0 mt-0.5" />
            Scannability gate: quiet zone ≥ 4 modules, minimum physical size enforced, decode test passed at proof stage. If a file fails our checks, production is blocked until fixed.
          </div>
        </div>

        <div className="card-solid p-6">
          <h3 className="font-display font-semibold mb-4">Configure order</h3>
          <label className="label">Product</label>
          <div className="grid grid-cols-1 gap-2 mb-4">
            {[['plastic-card', 'Plastic card · PKR 149/u'], ['table-tent', 'Table tent · PKR 299/u'], ['counter-card', 'Counter card · PKR 199/u'], ['sticker', 'Vinyl stickers · PKR 21/u'], ['packaging-insert', 'Packaging insert · PKR 15/u']].map(([v, l]) => (
              <button key={v} onClick={() => setProduct(v as any)}
                className={`text-left rounded-xl border-2 px-3.5 py-2.5 text-sm font-bold transition-all ${product === v ? 'border-teal bg-teal/5 ring-1 ring-teal/30' : 'border-ink/10 bg-white hover:border-teal/30'}`}>
                {l}{product === v && <CheckCircle2 size={15} className="inline ml-2 text-teal" />}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Quantity</label>
              <div className="flex items-center gap-2">
                <button className="btn-secondary !px-3" onClick={() => setQty(q => Math.max(10, q - 10))}>−</button>
                <input className="input text-center font-bold" value={qty} onChange={e => setQty(Math.max(1, +e.target.value || 1))} />
                <button className="btn-secondary !px-3" onClick={() => setQty(q => q + 10)}>+</button>
              </div></div>
            <div><label className="label">Ship to</label>
              <select className="input" value={city} onChange={e => setCity(e.target.value)}>{['Karachi', 'Lahore', 'Islamabad', 'Multan', 'Faisalabad'].map(c => <option>{c}</option>)}</select></div>
          </div>
          <div className="mt-5 flex justify-between items-center rounded-xl bg-cream-soft px-4 py-3">
            <span className="text-sm font-bold text-ink/60">Estimated total</span>
            <span className="font-display font-semibold text-xl">{money(total)}</span>
          </div>
          <button className="btn-primary w-full mt-4" onClick={() => { orderCard({ email: session.email, business: primary.destination.label.split('—')[0].trim(), product, qty, template: tpl, city }); setPlaced(true) }}>
            <Printer size={15} /> Place order
          </button>
          <AnimatePresence>{placed && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="chip-teal mt-3 !py-2.5 w-full justify-center"><CheckCircle2 size={14} /> Order placed — pay by transfer, upload receipt, we start design proof after credit.</motion.p>}</AnimatePresence>
        </div>
      </div>

      {orders.length > 0 && (
        <div className="card-solid p-6">
          <h3 className="font-display font-semibold mb-4">Order timeline</h3>
          <ul className="space-y-4">
            {orders.map(o => (
              <li key={o.id} className="flex flex-wrap gap-3 items-center">
                <span className="font-mono text-xs font-bold text-ink/55 w-16 shrink-0">{o.id}</span>
                <span className="text-sm font-bold flex-1 min-w-40">{o.quantity}× {o.product.replace(/-/g, ' ')} · {o.businessName}</span>
                <OrderFlow state={o.state} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const FLOW: CardOrder['state'][] = ['NEW', 'DESIGN_REVIEW', 'APPROVED', 'PRINTING', 'SHIPPED', 'DELIVERED']
export function OrderFlow({ state }: { state: CardOrder['state'] }) {
  const idx = FLOW.indexOf(state)
  return (
    <ol className="flex items-center gap-1.5">
      {FLOW.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5" title={s}>
          <span className={`w-2.5 h-2.5 rounded-full ${i <= idx ? 'bg-teal' : 'bg-ink/12'}`} />
          {i < FLOW.length - 1 && <span className={`w-4 sm:w-6 h-0.5 ${i < idx ? 'bg-teal/60' : 'bg-ink/12'}`} />}
        </li>
      ))}
      <span className="ml-2 text-[11px] font-extrabold uppercase tracking-wide text-ink/55">{state.replace(/_/g, ' ')}</span>
    </ol>
  )
}

function PreviewCard({ product, tpl, business, cta, code }: any) {
  const tall = product === 'table-tent'
  const round = product === 'sticker'
  const aspect = product === 'plastic-card' ? 'aspect-[1.66/1]' : product === 'counter-card' ? 'aspect-[1.4/1]' : product === 'packaging-insert' ? 'aspect-[2.4/1]' : tall ? 'aspect-[1/1.3]' : 'aspect-square'
  const dark = tpl === 'dark', accent = tpl === 'accent'
  return (
    <motion.div layout className={`relative overflow-hidden shadow-lift border flex gap-4 items-center justify-center
      ${round ? 'rounded-full p-6' : 'rounded-2xl p-5'} ${aspect} ${product === 'table-tent' ? 'flex-col' : 'flex-row'}
      ${dark ? 'bg-ink border-gold/30' : accent ? 'bg-peach-soft border-peach' : 'bg-white border-ink/10'}`}>
      {(accent || dark) && <span className={`absolute -right-8 -top-10 w-32 h-32 rounded-full ${dark ? 'bg-teal/60' : 'bg-gold/25'} blur-[2px]`} />}
      <QrView url={`https://reviewdoor.app/q/${code}`} size={tall ? 120 : 96} dark={dark} />
      <div className={`min-w-0 ${tall ? 'text-center' : ''}`}>
        <p className={`font-display font-semibold text-lg leading-tight truncate ${dark ? 'text-cream' : 'text-ink'}`}>{business}</p>
        <p className={`text-[11px] mt-1 font-bold ${dark ? 'text-gold' : accent ? 'text-[#9A5B33]' : 'text-teal'}`}>{cta}</p>
        <p className={`text-[9px] mt-2 font-mono ${dark ? 'text-cream/50' : 'text-ink/40'}`}>reviewdoor.app/q/{code}</p>
      </div>
    </motion.div>
  )
}

/* ═══════════ PROFILE ═══════════ */
export function ProfilePage() {
  const session = useApp(s => s.session)!
  const qrs = useApp(s => s.qrs.filter(q => q.accountEmail === session.email))
  const [saved, setSaved] = useState(false)
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="display text-2xl">Business profile</h1>
      <div className="card-solid p-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Business name</label><input className="input" defaultValue={qrs[0]?.destination.label.split('—')[0].trim()} /></div>
          <div><label className="label">Category</label><select className="input"><option>Restaurant</option><option>Café</option><option>Hotel</option><option>Retail shop</option><option>Salon / Spa</option><option>Clinic</option></select></div>
          <div><label className="label">Address</label><input className="input" placeholder="DHA Phase 5, Karachi" /></div>
          <div><label className="label">Phone (public on expired page)</label><input className="input" placeholder="+92 21 3539 xxxx" /></div>
        </div>
        <div><label className="label">Brand color (for printed cards)</label>
          <div className="flex gap-2">{['#004643', '#D1AC00', '#F6BE9A', '#0C1618', '#FAF4D3'].map((c, i) => <button key={c} className={`h-10 w-10 rounded-xl border-2 ${i === 0 ? 'ring-2 ring-offset-2 ring-teal border-transparent' : 'border-ink/10'}`} style={{ background: c }} />)}</div>
        </div>
        <div><label className="label">Logo upload</label>
          <div className="border-2 border-dashed border-ink/15 rounded-xl p-5 text-center text-xs font-bold text-ink/50">Drop PNG/SVG here (optional — templates work without it)</div></div>
        <button className="btn-primary" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1800) }}>
          {saved ? <><CheckCircle2 size={15} /> Saved</> : 'Save profile'}</button>
      </div>
      <div className="card-solid p-6">
        <h3 className="font-display font-semibold mb-3">Account & security</h3>
        <div className="text-sm space-y-2.5 text-ink/70">
          <p>Signed in as <b className="font-mono">{session.email}</b></p>
          <p className="chip-teal !bg-transparent !ring-teal/20 inline-flex"><Clock3 size={13} /> Sessions expire automatically · password change flow available</p>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary btn-sm">Change password</button>
          <Link to="/app/support" className="btn-ghost btn-sm">Close account <ChevronRight size={13} /></Link>
        </div>
      </div>
    </div>
  )
}
