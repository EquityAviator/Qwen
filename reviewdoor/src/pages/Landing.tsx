import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  QrCode, RefreshCcw, CalendarClock, ShieldCheck, Star, MapPin, ArrowRight,
  Check, Play, Printer, LineChart, Wallet, Sparkles, ChevronDown, Menu, X, Quote,
} from 'lucide-react'
import { Wordmark } from '../components/Brand'
import { ScanPhoneMock, QrView } from '../components/Ui'
import { PLANS, useApp } from '../lib/store'
import { money } from '../lib/domain'

const PLATFORMS = ['Google Maps', 'Foodpanda', 'TripAdvisor', 'Facebook', 'Instagram', 'Custom URL']

export function Landing() {
  const [menu, setMenu] = useState(false)
  const session = useApp(s => s.session)
  const dashTo = session?.role === 'admin' ? '/admin' : '/app'

  return (
    <div className="grain">
      {/* ── Header ─────────────────────────── */}
      <header className="sticky top-0 z-40 bg-cream/85 backdrop-blur border-b border-ink/8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
          <Link to="/"><Wordmark /></Link>
          <nav className="hidden md:flex items-center gap-1 text-sm font-bold text-ink/65">
            {[['#how', 'How it works'], ['#demo', 'Live demo'], ['#cards', 'Printed cards'], ['/pricing', 'Pricing'], ['#faq', 'FAQ']].map(([h, l]) => (
              h.startsWith('#')
                ? <a key={l} href={h} className="px-3 py-2 rounded-lg hover:text-ink hover:bg-ink/5 transition">{l}</a>
                : <Link key={l} to={h} className="px-3 py-2 rounded-lg hover:text-ink hover:bg-ink/5 transition">{l}</Link>
            ))}
          </nav>
          <div className="flex-1" />
          <div className="hidden md:flex items-center gap-2">
            <Link to={session ? dashTo : '/login'} className="btn-secondary btn-sm">{session ? 'Dashboard' : 'Login'}</Link>
            <Link to="/signup" className="btn-primary btn-sm">Create My QR <ArrowRight size={14} /></Link>
          </div>
          <button className="md:hidden btn-ghost !p-2" onClick={() => setMenu(!menu)} aria-label="Menu">{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
        <AnimatePresence>
          {menu && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="md:hidden overflow-hidden border-t border-ink/8 bg-cream">
              <div className="p-4 grid gap-2">
                {['#how|#how it works', '#demo|#live demo', '#cards|#printed cards', '/pricing|pricing', '#faq|FAQ'].map(x => {
                  const [h, l] = x.split('|')
                  return h.startsWith('#')
                    ? <a key={l} href={h} onClick={() => setMenu(false)} className="sidebar-link" >{l}</a>
                    : <Link key={l} to={h} className="sidebar-link">{l}</Link>
                })}
                <div className="flex gap-2 pt-2">
                  <Link to={session ? dashTo : '/login'} className="btn-secondary flex-1">Login</Link>
                  <Link to="/signup" className="btn-primary flex-1">Create My QR</Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── Hero ─────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 dotgrid opacity-70 pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-20 lg:pt-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center relative">
          <div>
            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="kicker mb-4">
              <Sparkles size={14} className="text-gold" /> Subscription-controlled review QR platform
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 }}
              className="display text-[clamp(2.1rem,5vw,3.6rem)] leading-[1.04]"
            >
              Get more reviews<br />with <span className="relative whitespace-nowrap">one smart QR.
                <svg viewBox="0 0 220 12" className="absolute -bottom-1.5 left-0 w-full h-3 text-gold" preserveAspectRatio="none">
                  <path d="M2 9 C60 2 160 2 218 8" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
                </svg>
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .16 }}
              className="mt-6 text-base sm:text-lg text-ink/70 max-w-xl leading-relaxed"
            >
              Print once. Manage the destination online. Your customers keep scanning the <em>same card</em> while we
              update links, handle renewals and show a graceful page when a subscription lapses — never a broken code.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .24 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link to="/signup" className="btn-primary !px-6 !py-3 !text-base">Create My QR <ArrowRight size={17} /></Link>
              <a href="#demo" className="btn-secondary !px-6 !py-3 !text-base"><Play size={16} /> Try the live demo</a>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .35 }}
              className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold text-ink/60"
            >
              {['No reprint for link changes', 'Simple receipt renewals', 'Scan analytics included'].map(t => (
                <span key={t} className="inline-flex items-center gap-1.5"><Check size={15} className="text-teal" strokeWidth={3} /> {t}</span>
              ))}
            </motion.div>
          </div>

          <div className="justify-self-center lg:justify-self-end py-6">
            <ScanPhoneMock qrUrl="https://reviewdoor.app/q/DEMO42" />
          </div>
        </div>

        {/* platform marquee trust strip */}
        <div className="border-y border-ink/8 bg-white/60 py-4 overflow-hidden">
          <p className="text-center text-[11px] font-extrabold uppercase tracking-[0.2em] text-ink/45 mb-3">Routes to any review destination</p>
          <div className="relative">
            <div className="flex w-max animate-marquee gap-4 pr-4">
              {[...PLATFORMS, ...PLATFORMS, ...PLATFORMS].map((p, i) => (
                <span key={i} className="chip-neutral !bg-white !py-2 !px-4 !text-sm whitespace-nowrap">
                  <MapPin size={13} className="text-peach-deep" /> {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────── */}
      <section id="how" className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="flex items-end justify-between gap-6 mb-10">
          <div>
            <p className="kicker mb-3"><RefreshCcw size={14} className="text-teal" /> Three steps, minutes not days</p>
            <h2 className="display text-3xl sm:text-4xl">From kitchen counter to live QR</h2>
          </div>
          <Link to="/signup" className="btn-primary btn-sm hidden sm:inline-flex">Start now <ArrowRight size={14} /></Link>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { icon: QrCode, t: 'Create', d: 'Pick Google, Foodpanda, TripAdvisor or any link. We generate one dynamic QR that only stores our short route — never your raw link.', c: 'teal' },
            { icon: Printer, t: 'Activate', d: 'Choose a plan, pay by transfer/wallet and upload the receipt. Low-risk payments unlock provisional access immediately while we verify.', c: 'gold' },
            { icon: LineChart, t: 'Scan & grow', d: 'Every scan resolves server-side in milliseconds and lands on your current review page. Change the link anytime — same printed QR.', c: 'peach' },
          ].map((s, i) => (
            <motion.div key={s.t}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.1 }}
              whileHover={{ y: -6 }}
              className="card-solid p-6 relative overflow-hidden"
            >
              <span className={`absolute -right-6 -top-8 font-display font-semibold text-[120px] leading-none ${s.c === 'teal' ? 'text-teal/6' : s.c === 'gold' ? 'text-gold/10' : 'text-peach/30'}`}>{i + 1}</span>
              <div className={`w-11 h-11 rounded-xl grid place-items-center mb-4 ${s.c === 'teal' ? 'bg-teal text-cream' : s.c === 'gold' ? 'bg-gold text-ink' : 'bg-peach text-ink'}`}>
                <s.icon size={21} strokeWidth={2.4} />
              </div>
              <h3 className="display text-xl">{s.t}</h3>
              <p className="mt-2 text-sm text-ink/65 leading-relaxed">{s.d}</p>
            </motion.div>
          ))}
        </div>

        {/* state machine explainer strip */}
        <div className="mt-10 card p-6 grid lg:grid-cols-[auto_1fr] gap-6 items-center">
          <div className="flex items-center gap-2 font-bold text-sm text-teal"><ShieldCheck size={18} /> The smart part</div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            {[['Active', 'chip-teal'], ['Provisional', 'chip-gold'], ['Grace', 'chip-peach'], ['Expired → renewal page', 'chip-danger'], ['Suspended → safe page', 'chip-neutral']].map(([t, c]) => (
              <span key={t} className={`${c} !py-2`}>{t}</span>
            ))}
            <span className="text-ink/55 self-center ml-2">— the printed QR never changes; our service decides what a scan does.</span>
          </div>
        </div>
      </section>

      {/* ── Live demo ─────────────────────── */}
      <DemoSection />

      {/* ── Card showcase ─────────────────────── */}
      <CardShowcase />

      {/* ── Pricing preview ─────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-10">
          <p className="kicker mb-3 justify-center"><Wallet size={14} /> Honest pricing</p>
          <h2 className="display text-3xl sm:text-4xl">Plans that pay for themselves with a few reviews</h2>
          <p className="text-ink/60 mt-3">Monthly or yearly · 7-day free trial · grace period before anything stops working.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((p, i) => (
            <motion.div key={p.id}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * .08 }}
              className={`card-solid p-6 relative ${p.recommended ? 'ring-2 ring-gold shadow-glow' : ''}`}
            >
              {p.recommended && <span className="chip-gold absolute -top-3 left-1/2 -translate-x-1/2 !bg-gold !text-ink ring-0"><Star size={12} fill="currentColor" /> Most popular</span>}
              <h3 className="display text-xl">{p.name}</h3>
              <p className="mt-1 text-sm text-ink/55">{p.includedQrs} QR{p.includedQrs > 1 ? 's' : ''}{p.printEntitlement ? ' · print-ready' : ''}</p>
              <p className="mt-4"><span className="font-display font-semibold text-3xl">{money(p.priceMonthly)}</span><span className="text-sm text-ink/55"> /mo</span></p>
              <ul className="mt-5 space-y-2.5">
                {p.features.slice(0, 5).map(f => (
                  <li key={f} className="flex gap-2.5 text-sm text-ink/75"><Check size={16} className="text-teal shrink-0 mt-0.5" strokeWidth={2.8} /> {f}</li>
                ))}
              </ul>
              <Link to={`/signup?plan=${p.id}`} className={`${p.recommended ? 'btn-gold' : 'btn-secondary'} w-full mt-6`}>Choose {p.name}</Link>
            </motion.div>
          ))}
        </div>
        <p className="text-center mt-6"><Link to="/pricing" className="text-teal font-bold underline decoration-gold decoration-2 underline-offset-4 hover:text-teal-soft">Compare all features →</Link></p>
      </section>

      {/* ── Quote strip ─────────────────────── */}
      <section className="bg-teal text-cream">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid md:grid-cols-[auto_1fr_auto] gap-8 items-center">
          <Quote size={40} className="text-gold" />
          <blockquote className="font-display text-xl sm:text-2xl leading-snug">
            “We moved our Foodpanda link to Google reviews over a weekend. Same table cards, zero reprints, scans kept flowing.”
            <footer className="mt-3 text-sm font-sans font-bold text-cream/70">— Owner, Spice Route · Karachi</footer>
          </blockquote>
          <Link to="/signup" className="btn-gold self-center whitespace-nowrap">Create My QR <ArrowRight size={15} /></Link>
        </div>
      </section>

      {/* ── FAQ ─────────────────────── */}
      <FaqSection />

      {/* ── Final CTA ─────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="relative overflow-hidden rounded-2xl bg-ink text-cream p-10 sm:p-14 text-center">
          <div className="absolute inset-0 dotgrid opacity-[0.12]" />
          <CalendarClock size={34} className="mx-auto text-gold mb-4" />
          <h2 className="display text-3xl sm:text-4xl text-cream">Your next review is one scan away.</h2>
          <p className="mt-3 text-cream/70 max-w-lg mx-auto">Set up in minutes, cancel anytime. The QR you print today still works after every renewal.</p>
          <div className="mt-7 flex justify-center gap-3 flex-wrap">
            <Link to="/signup" className="btn-gold !px-7 !py-3 !text-base">Create My QR</Link>
            <a href="#demo" className="btn !px-7 !py-3 !text-base bg-white/10 text-cream hover:bg-white/20">Scan the demo</a>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────── */}
      <footer className="border-t border-ink/8 bg-white/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-[1.4fr_1fr_1fr_1fr] gap-8">
          <div>
            <Wordmark />
            <p className="text-sm text-ink/55 mt-3 max-w-xs">Dynamic review QR subscriptions for restaurants and local businesses. Print once, manage forever.</p>
          </div>
          {[
            { h: 'Product', ls: [['#how', 'How it works'], ['#demo', 'Live demo'], ['/pricing', 'Pricing'], ['#cards', 'Printed cards']] },
            { h: 'Support', ls: [['#faq', 'FAQ'], ['/support', 'Contact us'], ['/terms', 'Terms of service'], ['/privacy', 'Privacy policy']] },
            { h: 'Account', ls: [['/login', 'Login'], ['/signup', 'Create account'], ['/app', 'Client dashboard'], ['/admin', 'Admin console']] },
          ].map(col => (
            <div key={col.h}>
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-ink/45 mb-3">{col.h}</h4>
              <ul className="space-y-2 text-sm font-bold text-ink/70">
                {col.ls.map(([h, l]) => (
                  <li key={l}>{h.startsWith('#') ? <a className="hover:text-teal transition" href={h}>{l}</a> : <Link className="hover:text-teal transition" to={h}>{l}</Link>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-ink/8 py-5 text-center text-xs text-ink/45 font-semibold">
          © {new Date().getFullYear()} ReviewDoor · Made for local businesses · Reviews should always be honest.
        </div>
      </footer>
    </div>
  )
}

/* ── Demo section with scannable QR ── */
function DemoSection() {
  const [scanned, setScanned] = useState(false)
  useEffect(() => { if (scanned) { const t = setTimeout(() => setScanned(false), 4200); return () => clearTimeout(t) } }, [scanned])
  return (
    <section id="demo" className="bg-cream-dim/50 border-y border-ink/8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <p className="kicker mb-3"><Play size={14} /> Product demo</p>
          <h2 className="display text-3xl sm:text-4xl">Scan this. Watch the routing work.</h2>
          <p className="mt-4 text-ink/70 leading-relaxed">
            This live demo QR points at <span className="font-mono font-bold text-teal">reviewdoor.app/q/DEMO42</span>.
            On a real device your camera opens our resolver, which checks the subscription state server-side and hands the
            visitor to the business's current review page with a temporary redirect — nothing cached, nothing stale.
          </p>
          <ul className="mt-5 space-y-3 text-sm">
            {[
              ['302 temporary redirect', 'Browsers and proxies never pin an outdated destination.'],
              ['Async scan logging', 'Analytics can fail without ever blocking a customer.'],
              ['Branded fallback pages', 'Visitors see a calm “inactive” page instead of an error.'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3"><span className="mt-1 w-5 h-5 rounded-md bg-teal text-cream grid place-items-center shrink-0"><Check size={12} strokeWidth={3} /></span>
                <span><b className="text-ink">{t}.</b> <span className="text-ink/60">{d}</span></span></li>
            ))}
          </ul>
        </div>
        <div className="justify-self-center">
          <div className="card-solid p-8 text-center relative">
            <div className="flex justify-center"><QrView url="https://reviewdoor.app/q/DEMO42" size={210} /></div>
            <p className="mt-5 font-mono text-sm font-bold text-teal">/q/DEMO42</p>
            <p className="text-xs text-ink/50 mt-1">Spice Route · Active demo tenant</p>
            <button className="btn-primary w-full mt-5" onClick={() => setScanned(true)}>
              <QrCode size={16} /> Simulate a scan
            </button>
            <AnimatePresence>
              {scanned && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="absolute -bottom-20 left-0 right-0 card-solid p-4 flex items-center gap-3 text-left shadow-lift">
                  <span className="w-9 h-9 rounded-full bg-teal text-cream grid place-items-center shrink-0"><Check size={17} strokeWidth={3} /></span>
                  <div>
                    <p className="text-sm font-extrabold">Effective state: ACTIVE → 302</p>
                    <p className="text-xs text-ink/55">Redirecting visitor to Google reviews… scan event logged.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── Printed card showcase ── */
function CardShowcase() {
  const cards = [
    { name: 'Restaurant Dark', tpl: 'dark', tag: 'Best-selling' },
    { name: 'Minimal White', tpl: 'light', tag: 'Clean' },
    { name: 'Modern Accent', tpl: 'accent', tag: 'Bold' },
  ]
  return (
    <section id="cards" className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
      <div className="mb-10">
        <p className="kicker mb-3"><Printer size={14} /> Optional physical products</p>
        <h2 className="display text-3xl sm:text-4xl">Cards, tents & stickers — designed to be scanned</h2>
        <p className="text-ink/60 mt-3 max-w-2xl">Order branded plastic cards, table tents, counter cards or stickers. Every layout keeps a proper quiet zone and passes a decode check before print production.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-6">
        {cards.map((c, i) => (
          <motion.div key={c.name}
            initial={{ opacity: 0, rotateY: -14, y: 24 }} whileInView={{ opacity: 1, rotateY: 0, y: 0 }} viewport={{ once: true }}
            transition={{ delay: i * .12 }} whileHover={{ y: -8, rotate: i % 2 ? 1.2 : -1.2 }}
            className="perspective-1000"
          >
            <PhysicalCard tpl={c.tpl} />
            <div className="flex items-center justify-between mt-3 px-1">
              <p className="font-bold text-sm">{c.name}</p>
              <span className="chip-neutral">{c.tag}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

export function PhysicalCard({ tpl, business = 'Spice Route', cta = 'Rate us on Google', code = 'DEMO42' }: { tpl: string; business?: string; cta?: string; code?: string }) {
  const dark = tpl === 'dark', accent = tpl === 'accent'
  return (
    <div className={`relative overflow-hidden rounded-2xl aspect-[1.75/1] p-4 flex gap-4 items-center shadow-lift border
      ${dark ? 'bg-ink border-gold/30' : accent ? 'bg-peach-soft border-peach' : 'bg-white border-ink/10'}`}>
      {(accent || dark) && <span className={`absolute -right-8 -top-10 w-32 h-32 rounded-full ${dark ? 'bg-teal/60' : 'bg-gold/25'} blur-[2px]`} />}
      <div className="relative">
        <QrView url={`https://reviewdoor.app/q/${code}`} size={dark ? 86 : 82} dark={dark} />
      </div>
      <div className="relative min-w-0">
        <p className={`font-display font-semibold text-lg leading-tight truncate ${dark ? 'text-cream' : 'text-ink'}`}>{business}</p>
        <p className={`text-[11px] mt-1 font-bold ${dark ? 'text-gold' : accent ? 'text-[#9A5B33]' : 'text-teal'}`}>{cta}</p>
        <p className={`text-[9px] mt-2 font-mono ${dark ? 'text-cream/50' : 'text-ink/40'}`}>reviewdoor.app/q/{code}</p>
      </div>
    </div>
  )
}

/* ── FAQ ── */
const FAQS = [
  ['Does my printed QR stop working if I change review platforms?', 'No — that’s the point. The QR only stores our short route. Swap Google for Foodpanda in the dashboard and the very next scan goes to the new destination. No reprints.'],
  ['What happens to customers when my subscription expires?', 'They see a calm, branded “service currently inactive” page — never a scary error. Renew, and the same QR starts routing again within seconds. A configurable grace period runs before that.'],
  ['How do manual payment receipts work?', 'Transfer to our bank/wallet with the generated reference, upload the slip, and low-risk submissions unlock provisional access right away while operations verify. Approval extends your period exactly once — duplicates are blocked.'],
  ['Do you guarantee five-star reviews?', 'Never. ReviewDoor makes it effortless for happy guests to leave honest feedback. We don’t generate, filter or buy reviews — that would break platform policies.'],
  ['Can I order physical cards with my branding?', 'Yes — Business and Multi-Outlet plans include printed plastic cards, table tents, counter cards and stickers with logo, CTA and brand color. Designs pass a scannability gate before production.'],
  ['Is scanner data private?', 'We record aggregate scan counts, rough country/city and device category. No personal identification, no stored raw IPs beyond privacy-safe hashing, short retention windows.'],
]
export function FaqList({ limit }: { limit?: number }) {
  const items = limit ? FAQS.slice(0, limit) : FAQS
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="space-y-3">
      {items.map(([q, a], i) => (
        <div key={q} className="card-solid overflow-hidden">
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center gap-4 p-5 text-left" aria-expanded={open === i}>
            <span className="flex-1 font-bold">{q}</span>
            <ChevronDown size={18} className={`text-teal shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <p className="px-5 pb-5 text-sm text-ink/65 leading-relaxed">{a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}
function FaqSection() {
  return (
    <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-8">
        <p className="kicker mb-3 justify-center">Questions, answered</p>
        <h2 className="display text-3xl sm:text-4xl">Frequently asked</h2>
      </div>
      <FaqList />
    </section>
  )
}
