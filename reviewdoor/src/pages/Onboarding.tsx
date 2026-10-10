import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ArrowRight, ArrowLeft, Star, QrCode, ShieldCheck, UploadCloud, Banknote, Sparkles } from 'lucide-react'
import { Wordmark } from '../components/Brand'
import { QrView } from '../components/Ui'
import { PLANS, useApp } from '../lib/store'
import { money, validateDestination } from '../lib/domain'

const STEPS = ['Account', 'Business', 'Destination', 'QR', 'Plan', 'Payment', 'Activation']

export function Onboarding() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { signup, createQr, submitReceipt, session } = useApp()
  const [step, setStep] = useState(session ? 1 : 0)
  const [form, setForm] = useState({
    email: '', pw: '', business: '', category: 'Restaurant', platform: 'google' as any, url: '',
    planId: params.get('plan') ?? 'business', method: 'bank-transfer' as any, amount: '', txn: '', ref: '', fileName: '',
  })
  const [qr, setQr] = useState<ReturnType<typeof createQr> | null>(null)
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [provisional, setProvisional] = useState(false)

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const plan = PLANS.find(p => p.id === form.planId)!

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep(s => Math.max(s - 1, 0))

  const doCreateQr = () => {
    const q = createQr(form.business || 'My business', form.platform, form.url, form.planId, 'TRIAL')
    setQr(q); next()
  }
  const doSignup = () => {
    if (!form.email.includes('@')) return
    if (session) { next(); return }
    signup(form.email, form.business || 'My business')
    next()
  }
  const doPayment = () => {
    const ref = `RD-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${plan.id.slice(0, 2).toUpperCase()}`
    const res = submitReceipt({
      code: qr?.shortCode ?? 'NEWQR', planId: plan.id,
      amount: form.amount || String(plan.priceMonthly),
      txn: form.txn, reference: form.ref || ref, method: form.method,
      fileName: form.fileName || 'receipt-upload.jpg',
    })
    setProvisional(res.provisional)
    next()
  }

  return (
    <div className="grain min-h-screen flex flex-col">
      <header className="h-16 flex items-center px-4 sm:px-6 border-b border-ink/8 bg-cream/85 backdrop-blur sticky top-0 z-30">
        <Link to="/"><Wordmark /></Link>
        <span className="ml-auto chip-teal hidden sm:inline-flex"><Sparkles size={13} /> Guided setup · autosaved</span>
      </header>

      {/* stepper */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-8">
        <ol className="flex items-center gap-1 sm:gap-2" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-none">
              <button onClick={() => i < step && setStep(i)} disabled={i > step}
                className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[11px] font-extrabold transition-colors ${i === step ? 'bg-teal text-cream' : i < step ? 'bg-gold/20 text-gold-deep hover:bg-gold/30' : 'bg-ink/6 text-ink/40'}`}
                title={s}>
                {i < step ? <Check size={12} strokeWidth={3.2} /> : <span>{i + 1}</span>}
                <span className="hidden md:inline">{s}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < step ? 'bg-teal/50' : 'bg-ink/10'}`} />}
            </li>
          ))}
        </ol>
      </div>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <AnimatePresence mode="wait">
          <motion.div key={step}
            initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ duration: .28 }}>

            {step === 0 && (
              <Panel t="Create your account" d="One login for everything — QRs, renewals, analytics.">
                <label className="label">Work email</label>
                <input className="input" placeholder="owner@yourrestaurant.pk" value={form.email} onChange={e => set('email', e.target.value)} />
                <div className="mt-4"><label className="label">Password</label>
                  <input className="input" type="password" placeholder="min. 10 characters" value={form.pw} onChange={e => set('pw', e.target.value)} /></div>
                <p className="help mt-3 inline-flex items-start gap-2"><ShieldCheck size={15} className="text-teal shrink-0 mt-0.5" /> Passwords are hashed with a vetted algorithm; sessions expire and can be revoked. We never store payment data in the QR.</p>
                <Primary onClick={doSignup} disabled={!form.email.includes('@')}>Continue <ArrowRight size={15} /></Primary>
              </Panel>
            )}

            {step === 1 && (
              <Panel t="Tell us about your business" d="Just the name for now — branding can come later.">
                <label className="label">Business name</label>
                <input className="input" placeholder="Spice Route DHA" value={form.business} onChange={e => set('business', e.target.value)} />
                <div className="mt-4"><label className="label">Category</label>
                  <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
                    {['Restaurant', 'Café', 'Hotel', 'Retail shop', 'Salon / Spa', 'Clinic', 'Service business', 'Other'].map(c => <option key={c}>{c}</option>)}
                  </select></div>
                <Nav back={back} next={next} nextLabel="Save & continue" />
              </Panel>
            )}

            {step === 2 && (
              <Panel t="Where should scans go?" d="Paste your review link. You can change this anytime without reprinting.">
                <label className="label">Review platform</label>
                <div className="grid grid-cols-3 gap-2">
                  {[['google', 'Google'], ['foodpanda', 'Foodpanda'], ['tripadvisor', 'TripAdvisor'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['custom', 'Custom URL']].map(([v, l]) => (
                    <button key={v} onClick={() => set('platform', v)}
                      className={`rounded-xl border-2 px-2 py-2.5 text-xs font-extrabold transition-all ${form.platform === v ? 'border-teal bg-teal text-cream shadow-lift' : 'border-ink/10 bg-white hover:border-teal/40'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <details className="mt-4 card !p-4 text-sm">
                  <summary className="font-bold cursor-pointer text-teal">How do I get my {form.platform} review link?</summary>
                  <ol className="list-decimal ml-5 mt-3 space-y-1.5 text-ink/70">
                    <li>Search your business on {form.platform === 'google' ? 'Google Maps' : form.platform}.</li>
                    <li>Open the <b>Reviews</b> tab.</li>
                    <li>Copy the address-bar URL (or use “Share → Copy link”).</li>
                    <li>Paste it here. We validate the format — we can’t guarantee third-party availability forever.</li>
                  </ol>
                </details>
                <div className="mt-4"><label className="label">Review destination URL</label>
                  <input className="input font-mono" placeholder="https://www.google.com/maps/place/..." value={form.url}
                    onChange={e => { set('url', e.target.value); setUrlMsg(validateDestination(form.platform, e.target.value)) }} />
                  {urlMsg && <p className={`help font-semibold ${urlMsg.ok ? 'text-teal' : 'text-red-700'}`}>{urlMsg.message}</p>}
                </div>
                <Nav back={back} next={next} disabled={!urlMsg?.ok} nextLabel="Validate & continue" />
              </Panel>
            )}

            {step === 3 && (
              <Panel t="Your dynamic QR is ready" d="It encodes only our short route — never your raw link.">
                <div className="flex flex-col sm:flex-row gap-6 items-center">
                  <div className="animate-floaty"><QrView url={`https://reviewdoor.app/q/${qr?.shortCode ?? 'PREVIEW'}`} size={170} /></div>
                  <div className="text-sm space-y-3">
                    <p><span className="label !mb-0.5">Route</span><code className="font-mono font-bold text-teal">reviewdoor.app/q/{qr?.shortCode ?? 'AB12CD34'}</code></p>
                    <p><span className="label !mb-0.5">Destination</span><span className="break-all text-ink/70">{form.url || '—'}</span></p>
                    <p className="chip-teal !bg-teal !text-cream ring-0"><QrCode size={13} /> Trial starts after activation</p>
                  </div>
                </div>
                <Primary onClick={doCreateQr}>Generate this QR <ArrowRight size={15} /></Primary>
                <button className="btn-ghost w-full mt-2 text-xs" onClick={next}>Skip preview, choose plan →</button>
              </Panel>
            )}

            {step === 4 && (
              <Panel t="Choose your plan" d="Every plan includes the dynamic routing core. Prices snapshotted at purchase.">
                <div className="space-y-3">
                  {PLANS.map(p => (
                    <button key={p.id} onClick={() => set('planId', p.id)}
                      className={`w-full text-left card-solid p-4 flex gap-4 items-start transition-all ${form.planId === p.id ? 'ring-2 ring-teal shadow-lift' : 'hover:border-teal/30'}`}>
                      <span className={`mt-1 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${form.planId === p.id ? 'border-teal bg-teal' : 'border-ink/25'}`}>
                        {form.planId === p.id && <Check size={12} className="text-cream" strokeWidth={3.5} />}
                      </span>
                      <span className="flex-1">
                        <span className="flex items-center gap-2 font-display font-semibold text-lg">{p.name}
                          {p.recommended && <span className="chip-gold"><Star size={11} fill="currentColor" /> recommended</span>}</span>
                        <span className="block text-xs text-ink/55 mt-0.5">{p.includedQrs} QR · {p.graceDays}d grace · {p.provisionalHours}h provisional window{p.printEntitlement ? ' · print entitlement' : ''}</span>
                        <span className="block mt-2 text-sm text-ink/70">{p.features.slice(0, 3).join(' · ')}</span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="font-display font-semibold text-lg block">{money(p.priceMonthly)}</span>
                        <span className="text-[11px] text-ink/50">/mo · {money(p.priceYearly)}/yr</span>
                      </span>
                    </button>
                  ))}
                </div>
                <Nav back={back} next={next} nextLabel="Continue to payment" />
              </Panel>
            )}

            {step === 5 && (
              <Panel t="Pay & upload evidence" d="Transfer using your unique reference, then upload the slip. Low-risk receipts unlock provisional access instantly while ops verifies.">
                <div className="card p-4 mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="label !mb-0.5">Your payment reference — write it in the transfer note</p>
                    <p className="font-mono text-xl font-bold text-teal">RD-{(qr?.shortCode ?? 'NEW').slice(0, 4)}-{plan.id.slice(0, 2).toUpperCase()}</p>
                  </div>
                  <div className="text-right">
                    <p className="label !mb-0.5">Amount due</p>
                    <p className="font-display font-semibold text-xl">{money(plan.priceMonthly)}</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><label className="label">Method</label>
                    <select className="input" value={form.method} onChange={e => set('method', e.target.value)}>
                      <option value="bank-transfer">Bank transfer</option><option value="wallet">Mobile wallet</option><option value="card">Card (gateway — soon)</option>
                    </select></div>
                  <div><label className="label">Amount paid</label>
                    <input className="input" inputMode="numeric" placeholder={String(plan.priceMonthly)} value={form.amount} onChange={e => set('amount', e.target.value)} /></div>
                  <div><label className="label">Transaction ID</label>
                    <input className="input font-mono" placeholder="HBL TRF 55190233" value={form.txn} onChange={e => set('txn', e.target.value)} /></div>
                  <div><label className="label">Reference (from transfer note)</label>
                    <input className="input font-mono" placeholder="RD-…" value={form.ref} onChange={e => set('ref', e.target.value)} /></div>
                </div>
                <label className="mt-4 block cursor-pointer">
                  <div className="border-2 border-dashed border-teal/30 hover:border-teal rounded-xl p-5 text-center text-sm font-bold text-ink/60 bg-white/60 transition">
                    <UploadCloud size={22} className="mx-auto mb-1.5 text-teal" />
                    {form.fileName || 'Upload receipt photo / PDF (jpg, png, pdf · max 8 MB)'}
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={e => set('fileName', e.target.files?.[0]?.name ?? '')} />
                  </div>
                </label>
                <div className="flex gap-2 mt-3 text-xs text-ink/55 items-start"><Banknote size={15} className="text-gold shrink-0" />
                  Manual verification is the launch flow; gateway checkout is a future adapter. The original receipt always remains the authoritative evidence.</div>
                <Primary onClick={doPayment} disabled={!form.fileName}>Submit receipt <ArrowRight size={15} /></Primary>
              </Panel>
            )}

            {step === 6 && (
              <Panel t={provisional ? 'Provisionally activated 🎉' : 'Receipt received'} d={provisional
                ? `Your QR routes live for ${plan.provisionalHours}h while we verify payment. Final approval extends the full period.`
                : 'Risk flags put your receipt in manual review. Your QR stays inactive until approval — you’ll be notified either way.'}>
                <div className="flex flex-col sm:flex-row gap-6 items-center">
                  <div className="relative">
                    <QrView url={`https://reviewdoor.app/q/${qr?.shortCode ?? 'DEMO42'}`} size={180} />
                    {provisional && <span className="absolute -top-3 -right-3 chip-gold shadow-card"><Sparkles size={12} /> live</span>}
                  </div>
                  <ul className="text-sm space-y-2.5 w-full">
                    {[
                      ['QR short code immutable', 'Print it on cards, tents, stickers — it survives every renewal.'],
                      ['Download unlocked', 'HD PNG available now; SVG/print files follow final approval.'],
                      ['Expiry reminders', "You'll get notices at 14, 7, 3 and 1 days before expiry."],
                    ].map(([t, d]) => (
                      <li key={t} className="flex gap-2.5"><Check size={16} className="text-teal shrink-0 mt-0.5" strokeWidth={3} /><span><b>{t}.</b> <span className="text-ink/60">{d}</span></span></li>
                    ))}
                  </ul>
                </div>
                <div className="flex gap-3 mt-6">
                  <Link to="/app" className="btn-primary flex-1">Open dashboard <ArrowRight size={15} /></Link>
                  <Link to={`/q/${qr?.shortCode ?? 'DEMO42'}`} className="btn-secondary">Test QR now</Link>
                </div>
              </Panel>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

function Panel({ t, d, children }: { t: string; d: string; children: React.ReactNode }) {
  return (
    <div className="card-solid p-6 sm:p-8">
      <h2 className="display text-2xl">{t}</h2>
      <p className="text-sm text-ink/60 mt-1.5 mb-6 leading-relaxed">{d}</p>
      {children}
    </div>
  )
}
function Primary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} className="btn-primary w-full mt-6">{children}</button>
}
function Nav({ back, next, nextLabel, disabled }: { back: () => void; next: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 mt-6">
      <button onClick={back} className="btn-secondary"><ArrowLeft size={15} /> Back</button>
      <button onClick={next} disabled={disabled} className="btn-primary flex-1">{nextLabel} <ArrowRight size={15} /></button>
    </div>
  )
}

/* ── Login / Signup simple pages ── */
export function Login() {
  const nav = useNavigate()
  const login = useApp(s => s.login)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const submit = () => {
    if (!email) return
    login(email, pw)
    nav(email.startsWith('admin') ? '/admin' : '/app')
  }
  return (
    <AuthShell title="Welcome back" sub="Log in to manage your review QR.">
      <label className="label">Email</label>
      <input className="input" placeholder="you@business.pk" value={email} onChange={e => setEmail(e.target.value)} />
      <p className="help">Tip: start the email with <b>admin</b> to enter the operations console (demo RBAC).</p>
      <div className="mt-4"><label className="label">Password</label>
        <input className="input" type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></div>
      <button className="btn-primary w-full mt-6" onClick={submit}>Log in <ArrowRight size={15} /></button>
      <div className="flex justify-between mt-4 text-sm font-bold">
        <Link to="/signup" className="text-teal hover:underline">Create account</Link>
        <a className="text-ink/50 hover:text-ink cursor-pointer">Forgot password?</a>
      </div>
    </AuthShell>
  )
}

export function SignupEntry() {
  return (
    <div className="grain min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-teal text-cream p-10 relative overflow-hidden">
        <div className="absolute inset-0 dotgrid opacity-[0.15]" />
        <Link to="/" className="relative w-fit"><Wordmark dark /></Link>
        <div className="relative">
          <h2 className="font-display text-3xl leading-tight">“Print once.<br />Manage the destination online.”</h2>
          <ul className="mt-6 space-y-3 text-sm font-semibold text-cream/85">
            {['Activate a QR in minutes, not days', 'Change links without reprints', 'Renewals with instant provisional access', 'Analytics that respect customer privacy'].map(t => (
              <li key={t} className="flex gap-2.5"><Check size={16} className="text-gold shrink-0" strokeWidth={3} /> {t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-cream/50">© ReviewDoor · Trusted by restaurants, cafés & clinics across Pakistan</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Link to="/" className="lg:hidden inline-block mb-8"><Wordmark /></Link>
          <h1 className="display text-3xl">Create your account</h1>
          <p className="text-sm text-ink/60 mt-2 mb-8">Start the guided setup — you'll have a working dynamic QR in about five minutes.</p>
          <Link to="/setup" className="btn-primary w-full !py-3">Begin onboarding <ArrowRight size={16} /></Link>
          <p className="text-sm text-center mt-5 text-ink/60">Already registered? <Link to="/login" className="font-bold text-teal hover:underline">Log in</Link></p>
        </div>
      </div>
    </div>
  )
}

function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="grain min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-block mb-8"><Wordmark /></Link>
        <div className="card-solid p-7">
          <h1 className="display text-2xl">{title}</h1>
          <p className="text-sm text-ink/60 mt-1.5 mb-6">{sub}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
