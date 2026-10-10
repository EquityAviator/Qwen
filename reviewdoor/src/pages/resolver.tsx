import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Clock3, ShieldAlert, MapPin, Phone, ExternalLink, QrCode, RefreshCcw } from 'lucide-react'
import { useApp, qrByCode } from '../lib/store'
import { effectiveRouting, statusOf, daysUntil } from '../lib/domain'
import { Wordmark } from '../components/Brand'

const DAY = 86400_000

/* Visitor resolver page — the only public-facing flow (Design §5.1) */
export function Resolver() {
  const { code = '' } = useParams()
  const recordScan = useApp(s => s.recordScan)
  const found = qrByCode(code)
  const [phase, setPhase] = useState<'resolving' | 'decided'>('resolving')

  const outcome = useMemo(() => (found ? effectiveRouting(found) : 'NOT_FOUND'), [found])

  useEffect(() => {
    if (found) recordScan(found.shortCode, outcome)
    const t = setTimeout(() => setPhase('decided'), 950)   // simulated server resolution latency
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return (
    <div className="grain min-h-screen flex flex-col bg-cream">
      <header className="h-16 flex items-center px-6 border-b border-ink/8">
        <Link to="/"><Wordmark size={30} /></Link>
        <span className="ml-auto chip-neutral hidden sm:inline-flex"><QrCode size={13} /> /q/{code}</span>
      </header>

      <main className="flex-1 grid place-items-center p-6">
        <AnimatePresence mode="wait">
          {phase === 'resolving' ? (
            <motion.div key="r" exit={{ opacity: 0, scale: .97 }} className="text-center">
              <div className="relative w-20 h-20 mx-auto">
                <span className="absolute inset-0 rounded-full border-4 border-teal/15" />
                <motion.span className="absolute inset-0 rounded-full border-4 border-transparent border-t-gold"
                  animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: .9, ease: 'linear' }} />
              </div>
              <p className="mt-5 font-display text-xl">Checking this QR…</p>
              <p className="text-sm text-ink/55 mt-1">Resolving the current destination securely.</p>
            </motion.div>
          ) : !found ? (
            <NotFound key="nf" code={code} />
          ) : outcome === 'REDIRECT' ? (
            <Redirecting key="rd" code={found.shortCode} url={found.destination.url} label={found.destination.label} business={found.destination.label.split('—')[0].trim()} />
          ) : outcome === 'SUSPENDED' ? (
            <Suspended key="sp" business={found.destination.label.split('—')[0].trim()} phone="+92 311 2200 4643" />
          ) : (
            <Expired key="ex" business={found.destination.label.split('—')[0].trim()} email={found.accountEmail} days={daysUntil(found.periodEndUtc)} />
          )}
        </AnimatePresence>
      </main>

      <footer className="py-4 text-center text-xs text-ink/40 font-semibold">
        ReviewDoor keeps printed QR codes working — <Link to="/" className="underline hover:text-teal">learn more</Link>
      </footer>
    </div>
  )
}

function Redirecting({ url, label, business }: { url: string; code: string; label: string; business: string }) {
  const [count, setCount] = useState(3)
  useEffect(() => {
    const i = setInterval(() => setCount(c => c > 0 ? c - 1 : 0), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card-solid p-8 max-w-md w-full text-center">
      <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}
        className="w-16 h-16 mx-auto rounded-2xl bg-teal text-cream grid place-items-center mb-5">
        <ExternalLink size={26} />
      </motion.div>
      <h1 className="display text-2xl">Taking you to your review page</h1>
      <p className="mt-2 text-sm text-ink/60"><b>{business}</b> · {label.split('—')[1]?.trim()}</p>
      <div className="mt-5 rounded-xl bg-cream-soft border border-ink/8 p-3 text-xs break-all font-mono text-ink/60">{url || '(destination not set)'}</div>
      <a href={url || '#'} target="_blank" rel="noopener noreferrer nofollow"
        className={`btn-primary w-full mt-5 ${count === 0 ? 'animate-pulse' : ''}`}>
        Continue to reviews <span className="font-mono text-xs opacity-70">({count}s)</span>
      </a>
      <p className="help mt-3">Temporary redirect (302) — nothing about this destination is cached. Scans are logged anonymously in aggregate.</p>
    </motion.div>
  )
}

/* Expired visitor page — calm, honest, offers alternatives (FR-10) */
function Expired({ business, email, days }: { business: string; email: string; days: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full">
      <div className="card-solid overflow-hidden">
        <div className="bg-peach-soft border-b border-peach px-7 py-6 flex items-start gap-4">
          <Clock3 size={26} className="text-[#9A5B33] shrink-0 mt-0.5" />
          <div>
            <h1 className="display text-xl text-ink">This service is currently inactive</h1>
            <p className="text-sm text-ink/65 mt-1.5 leading-relaxed">
              <b>{business}</b>’s review QR is between subscription periods{days < 0 ? ` (ended ${-days} day${days === -1 ? '' : 's'} ago)` : ''}.
              The link will work again once it’s renewed — the card in your hand stays valid.
            </p>
          </div>
        </div>
        <div className="p-7">
          <h2 className="label">Find them another way</h2>
          <ul className="space-y-2.5">
            {[['Google Maps', 'Search the business name and open the Reviews tab'], ['Foodpanda', 'Order history → rate the store'], ['TripAdvisor', 'Look up listings for your city']].map(([t, d]) => (
              <li key={t} className="flex gap-3 items-start rounded-xl bg-cream-soft border border-ink/6 p-3.5">
                <MapPin size={16} className="text-teal shrink-0 mt-0.5" />
                <span className="text-sm"><b>{t}</b><br /><span className="text-ink/55 text-xs">{d}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between rounded-xl border-2 border-dashed border-teal/25 p-3.5">
            <span className="text-sm font-bold text-ink/70 inline-flex gap-2 items-center"><Phone size={14} className="text-teal" /> Are you the owner?</span>
            <Link to="/app/subscription" className="btn-gold btn-sm"><RefreshCcw size={12} /> Renew</Link>
          </div>
          <p className="help text-center mt-3">Owner contact on file: <span className="font-mono">{email}</span></p>
        </div>
      </div>
      <p className="text-center mt-4"><Link to="/" className="text-teal font-bold text-sm underline decoration-gold underline-offset-4">Powered by ReviewDoor →</Link></p>
    </motion.div>
  )
}

/* Suspended visitor page — safe fallback under moderation */
function Suspended({ business, phone }: { business: string; phone: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card-solid p-8 max-w-md w-full text-center">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-ink/6 text-ink/60 grid place-items-center mb-5"><ShieldAlert size={26} /></div>
      <h1 className="display text-2xl">Temporarily unavailable</h1>
      <p className="mt-3 text-sm text-ink/60 leading-relaxed">
        This QR is on a temporary hold while our team reviews it. You can still leave feedback for <b>{business}</b> by searching their name directly on Google Maps or your delivery app.
      </p>
      <p className="mt-4 text-xs text-ink/50">Business owner? Reach support at <span className="font-mono font-bold">{phone}</span>.</p>
      <button onClick={() => history.back()} className="btn-secondary mt-6"><ArrowLeft size={14} /> Go back</button>
    </motion.div>
  )
}

function NotFound({ code }: { code: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card-solid p-8 max-w-md w-full text-center">
      <p className="font-display text-5xl text-ink/15">404</p>
      <h1 className="display text-xl mt-2">QR not found</h1>
      <p className="text-sm text-ink/60 mt-2">Code <span className="font-mono font-bold">“{code}”</span> isn’t an active route. If this card was retired, search the business name on Google Maps instead.</p>
      <Link to="/" className="btn-primary mt-5">Visit ReviewDoor <ExternalLink size={14} /></Link>
    </motion.div>
  )
}
