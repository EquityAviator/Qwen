/* ─────────────────────────────────────────────────────────────
   ReviewDoor · Route map (Design doc §5 — page inventory)
   Public: landing, pricing, legal, onboarding, auth, visitor resolver
   Client workspace (/app/*) and Admin console (/admin/*) are guarded
   by their layouts (RBAC redirect when no matching session).
   ──────────────────────────────────────────────────────────── */
import { Link, Route, Routes, useParams, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { ArrowUp } from 'lucide-react'
import { Landing, FaqList } from './pages/Landing'
import { Onboarding, Login, SignupEntry } from './pages/Onboarding'
import { Resolver } from './pages/resolver'
import { ClientLayout } from './components/ClientLayout'
import { AdminLayout } from './components/AdminLayout'
import { Overview, MyQrs, SubscriptionPage, SupportPage } from './pages/client'
import { Analytics, ClientReceipts, ClientCards, ProfilePage } from './pages/clientMore'
import { AdminOverview, AdminReceipts, AdminQrs, AdminOrders, AdminAudit } from './pages/admin'
import { Wordmark } from './components/Brand'
import { PLANS } from './lib/store'
import { money } from './lib/domain'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }), [pathname])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* public */}
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="/setup" element={<Onboarding />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignupEntry />} />
        <Route path="/q/:code" element={<Resolver />} />

        {/* client workspace */}
        <Route path="/app" element={<ClientLayout />}>
          <Route index element={<Overview />} />
          <Route path="qr" element={<MyQrs />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="receipts" element={<ClientReceipts />} />
          <Route path="cards" element={<ClientCards />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="support" element={<SupportPage />} />
        </Route>

        {/* admin console */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="receipts" element={<AdminReceipts />} />
          <Route path="qr" element={<AdminQrs />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}

/* ── Pricing page (full comparison + FAQ) ─────────────────── */
function PricingPage() {
  return (
    <div className="grain min-h-screen bg-cream text-ink">
      <header className="sticky top-0 z-40 bg-cream/85 backdrop-blur border-b border-ink/8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link to="/"><Wordmark /></Link>
          <nav className="ml-auto hidden sm:flex items-center gap-2">
            <Link to="/" className="btn-ghost btn-sm">Product</Link>
            <Link to="/login" className="btn-ghost btn-sm">Sign in</Link>
            <Link to="/setup" className="btn-primary btn-sm">Start free trial</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="text-center max-w-2xl mx-auto">
          <span className="chip-neutral">Pricing · PKR, VAT inclusive</span>
          <h1 className="display mt-4 text-4xl sm:text-5xl">One QR. One subscription.<br />Never reprint again.</h1>
          <p className="mt-4 text-ink/60 text-lg">Every plan includes the dynamic destination switch, expiry-safe visitor pages and email reminders. Cancel anytime — printed QRs keep working while your plan is active.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 mt-12 items-start">
          {PLANS.map(p => (
            <div key={p.id} className={`card-solid p-6 relative ${p.recommended ? 'ring-2 ring-gold shadow-lift md:-mt-3' : ''}`}>
              {p.recommended && <span className="absolute -top-3 left-1/2 -translate-x-1/2 chip bg-gold text-ink font-black"><ArrowUp size={12} className="rotate-180" /> Most popular</span>}
              <h3 className="font-display font-semibold text-xl">{p.name}</h3>
              <p className="mt-3"><span className="font-display font-semibold text-3xl">{money(p.priceMonthly)}</span><span className="text-sm text-ink/55"> /mo</span></p>
              <p className="text-xs text-ink/50 mt-1">or {money(p.priceYearly)} /yr · {p.trialDays}-day free trial</p>
              <ul className="mt-5 space-y-2.5">
                {p.features.map(f => (
                  <li key={f} className="flex gap-2.5 text-sm">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-teal-faint text-teal grid place-items-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6 grid gap-2">
                <Link to={`/setup?plan=${p.id}`} className={`w-full ${p.recommended ? 'btn-primary' : 'btn-secondary'}`}>Start {p.trialDays}-day trial</Link>
                <p className="text-[11px] text-ink/45 text-center">Renews every {p.durationDays} days · {p.graceDays}-day grace · {p.provisionalHours}h provisional access</p>
              </div>
            </div>
          ))}
        </div>

        <section className="mt-16 card-soft p-6 sm:p-8">
          <h2 className="display text-2xl">Frequently asked questions</h2>
          <div className="mt-5"><FaqList /></div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

/* ── Legal pages (Terms / Privacy) ────────────────────────── */
function LegalPage() {
  const { doc = 'terms' } = useParams()
  const T = doc === 'privacy'
    ? {
        title: 'Privacy Policy', updated: '6 October 2026',
        secs: [
          ['What we collect', 'Account details (email, business name), the review destinations you configure, anonymised scan metadata (device type, coarse region, timestamp) and payment receipts you upload for verification. We never sell data.'],
          ['How we use it', 'To resolve visitor QR scans to your chosen destination, show you analytics, verify subscription payments and provide support. Receipt images are processed with OCR solely for verification and retained until the decision is finalised plus 90 days for dispute handling.'],
          ['Retention & deletion', 'Scan aggregates are kept for 24 months. Deleting your account removes destinations within 30 days; audit records required for financial integrity are retained in redacted form.'],
          ['Your rights', 'Export or request deletion of your data any time from Business Profile → Data, or by emailing privacy@reviewdoor.app.'],
        ],
      }
    : {
        title: 'Terms of Service', updated: '6 October 2026',
        secs: [
          ['The service', 'ReviewDoor provides subscription-controlled dynamic QR redirection to third-party review platforms. A printed QR remains valid only while the corresponding subscription entitlement is active (including grace and provisional windows defined per plan).'],
          ['Acceptable use', 'Destinations must point to legitimate, publicly accessible review pages you own or operate. Suspicious, phishing or fraudulent destinations are suspended by moderation; suspensions are logged and appealable via Support.'],
          ['Payments & renewal', 'Manual payment methods (bank transfer, wallet, cash) require uploading a receipt. Provisional access granted after automated checks is revoked if a receipt is rejected. Approved credits apply exactly once per receipt (idempotent crediting).'],
          ['Limitations', 'Redirect availability targets 99.5% monthly. Third-party review platforms may change URLs; keeping destinations correct is the client’s responsibility, with tooling provided. Liability is capped at fees paid in the last 3 months.'],
        ],
      }
  return (
    <div className="grain min-h-screen bg-cream text-ink">
      <header className="sticky top-0 z-40 bg-cream/85 backdrop-blur border-b border-ink/8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link to="/"><Wordmark /></Link>
          <div className="ml-auto flex gap-2">
            <Link to="/legal/terms" className={`btn-sm btn ${doc === 'terms' ? 'btn-secondary' : 'btn-ghost'}`}>Terms</Link>
            <Link to="/legal/privacy" className={`btn-sm btn ${doc !== 'terms' ? 'btn-secondary' : 'btn-ghost'}`}>Privacy</Link>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="display text-4xl">{T.title}</h1>
        <p className="text-sm text-ink/50 mt-2">Last updated: {T.updated} · Summary version for the product demo.</p>
        {T.secs.map(([h, b]) => (
          <section key={h} className="mt-9">
            <h2 className="font-display font-semibold text-xl">{h}</h2>
            <p className="mt-2 text-ink/70 leading-relaxed">{b}</p>
          </section>
        ))}
        <div className="mt-12 card-soft p-5 text-sm text-ink/60">Questions? Write to <span className="font-bold text-ink">legal@reviewdoor.app</span> — we answer within 5 business days.</div>
      </main>
      <SiteFooter />
    </div>
  )
}

function NotFound() {
  return (
    <div className="grain min-h-screen bg-cream grid place-items-center p-6 text-center">
      <div>
        <div className="mx-auto w-fit mb-4"><Wordmark size={40} /></div>
        <p className="font-mono text-gold-deep font-bold text-sm tracking-widest">ERROR 404</p>
        <h1 className="display mt-2 text-4xl">This page took a wrong turn</h1>
        <p className="text-ink/60 mt-3 max-w-md mx-auto">The link you followed doesn’t exist. If you scanned a QR that landed here, the code may have been archived — the business can restore routing from their dashboard.</p>
        <div className="mt-6 flex gap-3 justify-center">
          <Link to="/" className="btn-primary">Back to home</Link>
          <Link to="/app" className="btn-secondary">My dashboard</Link>
        </div>
      </div>
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-ink/8 mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-ink/55">
        <span className="flex items-center gap-2"><Wordmark size={26} /></span>
        <div className="flex gap-5 font-semibold">
          <Link to="/pricing" className="hover:text-teal">Pricing</Link>
          <Link to="/legal/terms" className="hover:text-teal">Terms</Link>
          <Link to="/legal/privacy" className="hover:text-teal">Privacy</Link>
          <Link to="/setup" className="hover:text-teal">Get started</Link>
        </div>
        <p className="text-xs">© 2026 ReviewDoor · Karachi, Pakistan</p>
      </div>
    </footer>
  )
}
