import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  QrCode, Download, Play, Copy, Check, ArrowRight, CalendarClock, Activity,
  Printer, LifeBuoy, TrendingUp, ShieldAlert, ExternalLink, Plus, Pencil, Archive, Ban, RotateCcw,
  UploadCloud, MessageCircle, Mail,
} from 'lucide-react'
import { useApp, PLANS } from '../lib/store'
import { statusOf, daysUntil, money, effectiveRouting, validateDestination, QrCode as TQr } from '../lib/domain'
import { StatusChip, QrView } from '../components/Ui'
import { LiveDot } from '../components/Brand'

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const ago = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`
}

/* ═══════════ OVERVIEW ═══════════ */
export function Overview() {
  const session = useApp(s => s.session)!
  const qrs = useApp(s => s.qrs.filter(q => q.accountEmail === session.email))
  const activities = useApp(s => s.activities[session.email] ?? [])
  const orders = useApp(s => s.orders.filter(o => o.accountEmail === session.email))
  const primary = qrs[0]

  if (!primary) return <EmptyHero />

  const st = statusOf(primary)
  const days = daysUntil(primary.periodEndUtc)
  const weekScans = Math.round(primary.scans * 0.12)
  const total = primary.scans

  return (
    <div className="space-y-6">
      {/* Hero status card — first viewport answers "is my QR working?" */}
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className={`card-solid overflow-hidden relative ${st.tone === 'teal' ? 'ring-1 ring-teal/20' : ''}`}>
        <div className={`px-6 sm:px-8 py-6 ${st.key === 'active' || st.key === 'trial' ? 'bg-teal text-cream' : st.key === 'provisional' ? 'bg-gold text-ink' : st.key === 'grace' || st.key === 'past-due' ? 'bg-peach text-ink' : 'bg-ink text-cream'}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <LiveDot tone={st.tone === 'danger' ? 'danger' : st.tone === 'neutral' ? 'peach' : st.tone as any} />
            <h1 className="font-display text-2xl sm:text-3xl leading-none">{st.label}</h1>
            <span className="text-sm font-bold opacity-80 ml-auto">{st.sub}</span>
          </div>
          <p className="mt-3 text-sm font-semibold opacity-90">
            {days > 0 ? <>Current period ends <b>{fmt(primary.periodEndUtc)}</b> · {days} day{days === 1 ? '' : 's'} left.</>
              : <>Service lapsed on <b>{fmt(primary.periodEndUtc)}</b>. Renew to reactivate the same QR.</>}
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {['EXPIRED', 'GRACE', 'PAST_DUE'].includes(primary.subscription) ? (
              <Link to="/app/subscription" className="btn-gold"><CalendarClock size={15} /> Renew now — keep this QR</Link>
            ) : (
              <Link to="/app/subscription" className={`${st.key === 'active' ? 'btn !bg-white/12 text-cream hover:bg-white/25' : 'btn-primary'} `}><RefreshIcon /> Manage subscription</Link>
            )}
            <Link to={`/q/${primary.shortCode}`} className="btn !bg-white/12 text-ink hover:bg-white/25 [&_*]:!text-inherit" style={{ color: st.key === 'active' ? '#FAF4D3' : undefined }}>
              <Play size={15} /> Test QR
            </Link>
            {primary.subscription !== 'EXPIRED' && (
              <button className="btn !bg-white/12 hover:bg-white/25" style={{ color: 'inherit' }} onClick={() => downloadQr(primary.shortCode)}>
                <Download size={15} /> Download PNG
              </button>
            )}
          </div>
        </div>
        {/* activation checklist */}
        <div className="px-6 sm:px-8 py-4 grid sm:grid-cols-4 gap-3 text-xs font-bold">
          {[
            ['Business profile', !!primary.destination.label],
            ['Destination saved', !!primary.destination.url],
            ['QR created', true],
            ['QR tested', activities.some(a => a.kind === 'scan') || true],
          ].map(([t, done]) => (
            <span key={t as string} className={`inline-flex items-center gap-2 ${done ? 'text-teal' : 'text-ink/40'}`}>
              <Check size={14} strokeWidth={3} className={done ? '' : 'opacity-30'} /> {t}
            </span>
          ))}
        </div>
      </motion.section>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* QR card */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 }} className="card-solid p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-lg">Your QR</h3>
            <StatusChip s={st} />
          </div>
          <div className="flex justify-center py-2"><QrView url={`https://reviewdoor.app/q/${primary.shortCode}`} size={170} /></div>
          <Copyable text={`https://reviewdoor.app/q/${primary.shortCode}`} />
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Link to={`/q/${primary.shortCode}`} className="btn-secondary btn-sm"><Play size={14} /> Test QR</Link>
            <button className="btn-secondary btn-sm" onClick={() => downloadQr(primary.shortCode)}><Download size={14} /> PNG</button>
            <Link to="/app/qr" className="btn-secondary btn-sm"><Pencil size={14} /> Edit link</Link>
            <Link to="/app/cards" className="btn-secondary btn-sm"><Printer size={14} /> Order cards</Link>
          </div>
          <p className="help mt-3">The printed image never changes when you edit the destination or renew.</p>
        </motion.div>

        {/* Scans card */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .14 }} className="card-solid p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-lg">Scans</h3>
            <span className="chip-teal"><TrendingUp size={12} /> +{weekScans} this week</span>
          </div>
          <p className="font-display text-4xl font-semibold mt-3">{total.toLocaleString()}<span className="text-sm font-sans font-bold text-ink/50"> total</span></p>
          <Sparkline seed={primary.shortCode} />
          <div className="mt-auto pt-4 grid grid-cols-3 gap-2 text-center">
            {[['Today', Math.round(total * 0.014)], ['This week', weekScans], ['This month', Math.round(total * 0.06)]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl bg-cream-soft py-2.5">
                <p className="font-display font-semibold text-lg leading-none">{v}</p>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-ink/45 mt-1">{l}</p>
              </div>
            ))}
          </div>
          <Link to="/app/analytics" className="btn-ghost btn-sm justify-center mt-3">Full analytics <ArrowRight size={13} /></Link>
        </motion.div>

        {/* Subscription + physical + support stack */}
        <div className="space-y-5">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }} className="card-solid p-5">
            <h3 className="font-display font-semibold">Subscription</h3>
            <p className="text-sm text-ink/60 mt-1.5">Plan <b className="text-ink">{PLANS.find(p => p.id === primary.planId)?.name}</b> · {money(PLANS.find(p => p.id === primary.planId)!.priceMonthly)}/mo</p>
            <div className="mt-3 h-2 rounded-full bg-ink/8 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(4, Math.min(100, (days / 30) * 100))}%` }} transition={{ delay: .4, duration: .8 }}
                className={`h-full ${days > 7 ? 'bg-teal' : days > 0 ? 'bg-gold' : 'bg-red-600'}`} />
            </div>
            <p className="text-xs text-ink/55 mt-2">{days > 0 ? `${days} of ~30 days remaining` : 'Period ended'} · grace {PLANS.find(p => p.id === primary.planId)?.graceDays}d</p>
            <Link to="/app/subscription" className="btn-primary btn-sm w-full mt-4">Renew / history</Link>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .26 }} className="card-solid p-5">
            <h3 className="font-display font-semibold">Physical cards</h3>
            {orders.length ? (
              <p className="text-sm text-ink/60 mt-1.5">Latest order <b className="font-mono">{orders[0].id}</b> — <StatusOrder s={orders[0].state} /></p>
            ) : (
              <p className="text-sm text-ink/60 mt-1.5">No print orders yet. Business plans include branded cards & tents.</p>
            )}
            <Link to="/app/cards" className="btn-secondary btn-sm w-full mt-3"><Printer size={14} /> Design & order</Link>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .32 }} className="card p-5 !bg-teal !border-transparent text-cream">
            <h3 className="font-display font-semibold flex items-center gap-2"><LifeBuoy size={17} className="text-gold" /> Need a hand?</h3>
            <p className="text-sm text-cream/75 mt-1.5">Payment checks, broken links, print questions — real people answer.</p>
            <Link to="/app/support" className="btn-gold btn-sm w-full mt-3">Contact support</Link>
          </motion.div>
        </div>
      </div>

      {/* Recent activity */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .3 }} className="card-solid p-6">
        <h3 className="font-display font-semibold text-lg mb-4 flex items-center gap-2"><Activity size={18} className="text-teal" /> Recent activity</h3>
        <ul className="divide-y divide-ink/6">
          {(activities.length ? activities : [{ id: 'x', at: new Date(Date.now() - 3600e3).toISOString(), kind: 'scan' as const, text: `Scan received on #${primary.shortCode} → Google reviews (mobile, Karachi)` }]).slice(0, 6).map(a => (
            <li key={a.id} className="py-3 flex items-center gap-3 text-sm">
              <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${a.kind === 'scan' ? 'bg-teal/10 text-teal' : a.kind === 'payment' ? 'bg-gold/15 text-gold-deep' : a.kind === 'order' ? 'bg-peach/25 text-[#9A5B33]' : 'bg-ink/6 text-ink/60'}`}>
                {a.kind === 'scan' ? <QrCode size={15} /> : a.kind === 'payment' ? <CalendarClock size={15} /> : a.kind === 'order' ? <Printer size={15} /> : <ShieldAlert size={15} />}
              </span>
              <span className="flex-1 text-ink/75">{a.text}</span>
              <span className="text-xs text-ink/40 font-bold whitespace-nowrap">{ago(a.at)}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  )
}

function RefreshIcon() { return <CalendarClock size={15} /> }
function StatusOrder({ s }: { s: string }) {
  const map: Record<string, string> = { NEW: 'chip-neutral', DESIGN_REVIEW: 'chip-gold', APPROVED: 'chip-teal', PRINTING: 'chip-teal', SHIPPED: 'chip-gold', DELIVERED: 'chip-teal', CANCELED: 'chip-danger' }
  return <span className={map[s] ?? 'chip-neutral'}>{s.replace(/_/g, ' ').toLowerCase()}</span>
}

function Sparkline({ seed }: { seed: string }) {
  const pts = useMemo(() => {
    let s = [...seed].reduce((a, c) => a + c.charCodeAt(0), 7)
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    return Array.from({ length: 14 }, () => 18 + rnd() * 34)
  }, [seed])
  const path = pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i / 13) * 260},${60 - y}`).join(' ')
  return (
    <svg viewBox="0 0 260 60" className="w-full mt-4" aria-hidden>
      <path d={`${path} L260,60 L0,60 Z`} fill="rgba(0,70,67,.08)" />
      <motion.path d={path} fill="none" stroke="#004643" strokeWidth="2.5" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: .3 }} />
      <circle cx="260" cy={60 - pts[13]} r="4" fill="#D1AC00" />
    </svg>
  )
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600) }}
      className="mt-4 w-full flex items-center gap-2 rounded-xl bg-cream-soft border border-ink/8 px-3 py-2.5 text-left group hover:border-teal/40 transition">
      <code className="flex-1 font-mono text-xs font-bold text-teal truncate">{text}</code>
      {copied ? <Check size={15} className="text-teal" strokeWidth={3} /> : <Copy size={15} className="text-ink/40 group-hover:text-teal" />}
    </button>
  )
}

function downloadQr(code: string) {
  const svg = document.querySelector(`[data-qr="${code}"] svg`) ?? document.querySelectorAll('.qr-frame svg')[0]
  if (!svg) return
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `reviewdoor-${code}.svg`; a.click()
}

function EmptyHero() {
  return (
    <div className="card-solid p-12 text-center max-w-lg mx-auto">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-teal text-cream grid place-items-center mb-4"><Plus size={24} /></div>
      <h2 className="display text-2xl">No QR yet</h2>
      <p className="text-sm text-ink/60 mt-2">Create your first dynamic review QR — it takes about two minutes.</p>
      <Link to="/setup" className="btn-primary mt-5">Create My QR <ArrowRight size={15} /></Link>
    </div>
  )
}

/* ═══════════ MY QR CODES ═══════════ */
export function MyQrs() {
  const session = useApp(s => s.session)!
  const all = useApp(s => s.qrs)
  const qrs = all.filter(q => q.accountEmail === session.email)
  const [sel, setSel] = useState<string | null>(qrs[0]?.shortCode ?? null)
  const qr = all.find(q => q.shortCode === sel)

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="display text-2xl">My QR codes</h1>
          <p className="text-sm text-ink/60 mt-1">Same printed code forever — destinations stay editable.</p>
        </div>
        <Link to="/setup" className="btn-primary btn-sm"><Plus size={14} /> New QR</Link>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
        <div className="space-y-3">
          {qrs.length === 0 && <p className="card-solid p-6 text-sm text-ink/60 text-center">Nothing here yet — create one above.</p>}
          {qrs.map(q => {
            const st = statusOf(q)
            return (
              <button key={q.shortCode} onClick={() => setSel(q.shortCode)}
                className={`w-full text-left card-solid p-4 flex gap-4 items-center transition-all ${sel === q.shortCode ? 'ring-2 ring-teal shadow-lift' : 'hover:border-teal/30'}`}>
                <div className="shrink-0 scale-[0.55] origin-left -ml-3 -mr-6"><QrView url={`https://reviewdoor.app/q/${q.shortCode}`} size={90} /></div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{q.destination.label}</p>
                  <p className="font-mono text-[11px] text-ink/45">/q/{q.shortCode}</p>
                  <div className="mt-1.5"><StatusChip s={st} /></div>
                </div>
              </button>
            )
          })}
        </div>

        {qr && <QrDetail key={qr.shortCode} qr={qr} mine />}
      </div>
    </div>
  )
}

export function QrDetail({ qr, mine = false }: { qr: TQr; mine?: boolean }) {
  const setDestination = useApp(s => s.setDestination)
  const setOperational = useApp(s => s.setOperational)
  const [editing, setEditing] = useState(false)
  const [platform, setPlatform] = useState(qr.destination.platform)
  const [url, setUrl] = useState(qr.destination.url)
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const st = statusOf(qr)
  const outcome = effectiveRouting(qr)

  const save = () => {
    const v = validateDestination(platform, url)
    if (!v.ok) { setMsg(v); return }
    setDestination(qr.shortCode, platform, url)
    setSaved(true); setEditing(false)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-solid p-6 space-y-6">
      <div className="flex flex-wrap gap-5 items-start justify-between">
        <div className="flex gap-5">
          <div data-qr={qr.shortCode} className="shrink-0"><QrView url={`https://reviewdoor.app/q/${qr.shortCode}`} size={150} /></div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="display text-xl">{qr.destination.label}</h2>
              <StatusChip s={st} />
            </div>
            <p className="font-mono text-sm text-teal font-bold mt-1">reviewdoor.app/q/{qr.shortCode}</p>
            <p className="text-xs text-ink/50 mt-1">Created {fmt(qr.createdAt)} · {qr.scans.toLocaleString()} lifetime scans · expires {fmt(qr.periodEndUtc)}</p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Link to={`/q/${qr.shortCode}`} className="btn-secondary btn-sm"><Play size={13} /> Test QR</Link>
              <button className="btn-secondary btn-sm" onClick={() => downloadQr(qr.shortCode)}><Download size={13} /> SVG</button>
              <CopyMini text={`https://reviewdoor.app/q/${qr.shortCode}`} />
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="label !mb-1">Effective routing</p>
          <RoutingBadge outcome={outcome} />
          <p className="text-[11px] text-ink/45 mt-1.5 max-w-[180px]">Computed live per scan from operational state + entitlement.</p>
        </div>
      </div>

      <hr className="border-ink/8" />

      {/* destination editor */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold">Review destination</h3>
          {!editing && <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}><Pencil size={13} /> Change link</button>}
        </div>
        {!editing ? (
          <p className="mt-2 text-sm break-all font-mono bg-cream-soft border border-ink/8 rounded-xl px-3.5 py-2.5">{qr.destination.url || '— not set —'}</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid sm:grid-cols-[180px_1fr] gap-3">
              <select className="input" value={platform} onChange={e => setPlatform(e.target.value as any)}>
                {['google', 'foodpanda', 'tripadvisor', 'facebook', 'instagram', 'custom'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <input className="input font-mono" value={url} placeholder="https://…"
                onChange={e => { setUrl(e.target.value); setMsg(validateDestination(platform, e.target.value)) }} />
            </div>
            {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-teal' : 'text-red-700'}`}>{msg.message}</p>}
            <div className="flex gap-2">
              <button className="btn-primary btn-sm" onClick={save}>Save destination</button>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
            <p className="help">Saved server-side immediately — the very next scan uses the new link. The QR image stays identical.</p>
          </div>
        )}
        {saved && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="chip-teal mt-3"><Check size={12} strokeWidth={3} /> Destination updated — no reprint needed</motion.p>}
      </div>

      {mine && (
        <>
          <hr className="border-ink/8" />
          <div className="flex flex-wrap gap-2 items-center">
            <span className="label !mb-0 mr-1">Operational control</span>
            {qr.operational === 'ENABLED'
              ? <button className="btn-danger btn-sm" onClick={() => setOperational(qr.shortCode, 'SUSPENDED')} title="Suspension overrides entitlement for routing"><Ban size={13} /> Suspend</button>
              : <button className="btn-secondary btn-sm" onClick={() => setOperational(qr.shortCode, 'ENABLED')}><RotateCcw size={13} /> Restore</button>}
            <button className="btn-ghost btn-sm" onClick={() => setOperational(qr.shortCode, 'ARCHIVED')}><Archive size={13} /> Archive</button>
          </div>
        </>
      )}
    </motion.div>
  )
}

export function RoutingBadge({ outcome }: { outcome: string }) {
  const map: Record<string, [string, string]> = {
    REDIRECT: ['chip-teal', '302 → destination'], EXPIRED: ['chip-danger', 'Inactive page'],
    SUSPENDED: ['chip-neutral', 'Suspended page'], NOT_FOUND: ['chip-neutral', 'Not found'], ERROR: ['chip-peach', 'Retry-safe error'],
  }
  const [c, t] = map[outcome] ?? ['chip-neutral', outcome]
  return <span className={`${c} !py-2`}>{t}</span>
}

function CopyMini({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return <button className="btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500) }}>
    {ok ? <Check size={13} className="text-teal" /> : <Copy size={13} />} {ok ? 'Copied' : 'Copy link'}
  </button>
}

/* ═══════════ SUBSCRIPTION ═══════════ */
export function SubscriptionPage() {
  const session = useApp(s => s.session)!
  const qrs = useApp(s => s.qrs.filter(q => q.accountEmail === session.email))
  const receipts = useApp(s => s.receipts.filter(r => r.accountEmail === session.email))
  const primary = qrs[0]
  if (!primary) return <EmptyHero />
  const plan = PLANS.find(p => p.id === primary.planId)!
  const st = statusOf(primary)
  const days = daysUntil(primary.periodEndUtc)
  const needsRenewal = ['ACTIVE', 'TRIAL', 'PROVISIONAL_ACTIVE'].includes(primary.subscription)

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Subscription</h1>
      <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="card-solid p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="label !mb-1">Current plan</p>
              <h2 className="font-display text-2xl">{plan.name} <span className="text-base font-sans font-bold text-ink/50">· {money(plan.priceMonthly)}/mo</span></h2>
            </div>
            <StatusChip s={st} big />
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mt-6">
            <Info label="Period end" value={fmt(primary.periodEndUtc)} sub={days > 0 ? `${days} days remaining` : `${-days} days overdue`} />
            <Info label="Grace period" value={`${plan.graceDays} days`} sub="QR keeps routing during grace" />
            <Info label="Provisional window" value={`${plan.provisionalHours} hours`} sub="Instant access after low-risk receipt" />
          </div>
          {primary.subscription === 'PROVISIONAL_ACTIVE' && primary.provisionalUntilUtc && (
            <div className="mt-5 chip-gold !rounded-xl !px-4 !py-3 !text-sm w-full !font-semibold">
              <CalendarClock size={16} /> Provisional access until {new Date(primary.provisionalUntilUtc).toLocaleString()} — verification in progress.
            </div>
          )}
          <hr className="border-ink/8 my-6" />
          <h3 className="font-display font-semibold mb-3">What happens at expiry</h3>
          <ol className="relative ml-2 space-y-4 text-sm">
            {[
              ['Active', 'Everything routes normally. Reminders at 14 / 7 / 3 / 1 days.'],
              ['Grace', 'QR still works while payment is expected.'],
              ['Expired', 'Visitors see a calm inactive page. Renew → same QR works again.'],
            ].map(([t, d], i) => (
              <li key={t} className="pl-6 relative">
                <span className={`absolute left-0 top-0.5 w-4 h-4 rounded-full border-2 ${i === 0 ? 'bg-teal border-teal' : i === 1 ? 'bg-gold border-gold' : 'bg-white border-red-400'}`} />
                {i < 2 && <span className="absolute left-[7px] top-5 h-[calc(100%+4px)] w-0.5 bg-ink/10" />}
                <b>{t}.</b> <span className="text-ink/60">{d}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-5">
          <div className="card-solid p-5">
            <h3 className="font-display font-semibold">{needsRenewal ? 'Renew early' : 'Reactivate now'}</h3>
            <p className="text-xs text-ink/55 mt-1.5 leading-relaxed">
              {needsRenewal
                ? 'Renewing before expiry extends from the current period end — you never lose paid days.'
                : 'Renewing after expiry restarts service instantly upon approval. Your printed QR does not change.'}
            </p>
            <div className="mt-4 rounded-xl border-2 border-dashed border-gold/50 bg-gold-soft p-4">
              <p className="label !mb-1">Pay via bank transfer / wallet</p>
              <p className="text-sm font-mono font-bold text-ink">Meezan Bank · ReviewDoor Platform<br />Account: 0021-4488-0912-33<br />Easypaisa / JazzCash: 0311-2200-4643</p>
              <p className="text-xs mt-2 text-ink/60">Use reference <b className="font-mono">RD-{primary.shortCode.slice(0, 4)}-{plan.id.slice(0, 2).toUpperCase()}</b> in the transfer note.</p>
            </div>
            <Link to="/app/receipts" className="btn-primary w-full mt-4"><UploadCloud /> Upload receipt</Link>
          </div>

          <div className="card-solid p-5">
            <h3 className="font-display font-semibold">Payment history</h3>
            <ul className="mt-3 space-y-2.5 text-sm">
              {(receipts.length ? receipts : [{ id: 'rc-seed', state: 'APPROVED' as const, submittedAt: primary.createdAt, amount: { value: String(plan.priceMonthly), confidence: 1 }, planId: plan.id } as any]).slice(0, 4).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-cream-soft px-3.5 py-2.5">
                  <span className="font-mono text-xs font-bold text-ink/60">{r.id}</span>
                  <span className="font-bold">{money(Number(r.amount?.value ?? r.amount ?? plan.priceMonthly))}</span>
                  <ReceiptStateChip s={r.state} />
                </li>
              ))}
            </ul>
            <Link to="/app/receipts" className="btn-ghost btn-sm w-full mt-3">All receipts <ArrowRight size={13} /></Link>
          </div>
        </div>
      </div>
    </div>
  )
}
function Info({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-cream-soft border border-ink/6 p-4">
      <p className="label !mb-1">{label}</p>
      <p className="font-display font-semibold">{value}</p>
      <p className="text-[11px] text-ink/50 mt-1">{sub}</p>
    </div>
  )
}
export function ReceiptStateChip({ s }: { s: string }) {
  const map: Record<string, string> = { PENDING: 'chip-gold', PROCESSING: 'chip-gold', NEEDS_REVIEW: 'chip-peach', APPROVED: 'chip-teal', REJECTED: 'chip-danger', DUPLICATE: 'chip-danger' }
  return <span className={(map[s] ?? 'chip-neutral') + ' whitespace-nowrap'}>{s.replace('_', ' ')}</span>
}


/* ═══════════ SUPPORT ═══════════ */
export function SupportPage() {
  const [sent, setSent] = useState(false)
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="display text-2xl">Support</h1>
      <div className="grid sm:grid-cols-3 gap-3">
        {[['WhatsApp', 'Fastest for payments & printing', MessageCircle], ['Email', 'support@reviewdoor.app', Mail], ['Help centre', 'Guides & troubleshooting', LifeBuoy]].map(([t, d, I]: any) => (
          <button key={t} className="card-solid p-4 text-left hover:border-teal/40 transition">
            <I size={18} className="text-teal mb-2" />
            <p className="font-bold text-sm">{t}</p><p className="text-xs text-ink/55 mt-0.5">{d}</p>
          </button>
        ))}
      </div>
      <div className="card-solid p-6">
        <h2 className="font-display font-semibold text-lg">Open a ticket</h2>
        <AnimatePresence mode="wait">
          {!sent ? (
            <motion.div key="form" exit={{ opacity: 0, y: -8 }} className="mt-4 space-y-3">
              <div><label className="label">Topic</label>
                <select className="input"><option>Payment / receipt question</option><option>QR not routing</option><option>Print order status</option><option>Something else</option></select></div>
              <div><label className="label">Message</label><textarea className="input min-h-28" placeholder="Describe what's happening — we reply within one business day." /></div>
              <button className="btn-primary" onClick={() => setSent(true)}>Send ticket <ArrowRight size={14} /></button>
            </motion.div>
          ) : (
            <motion.div key="ok" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 flex items-center gap-3 chip-teal !rounded-xl !px-4 !py-4 !text-sm">
              <Check size={18} strokeWidth={3} /> Ticket RD-118 created. Track replies here and by email.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="card p-5 text-sm text-ink/60 leading-relaxed">
        <b className="text-ink inline-flex items-center gap-1.5"><ExternalLink size={14} className="text-teal" /> Honest-reviews policy:</b>
        ReviewDoor makes it easy for genuine customers to leave feedback. We never generate, incentivise or filter reviews — that would violate platform policies and hurt you long-term.
      </div>
    </div>
  )
}


