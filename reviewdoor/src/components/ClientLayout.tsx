import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutDashboard, QrCode as QrIcon, BarChart3, CreditCard, ReceiptText,
  Printer, Store, LifeBuoy, LogOut, Menu, X, Bell, ShieldCheck, ChevronRight,
} from 'lucide-react'
import { Wordmark, LiveDot } from './Brand'
import { useApp } from '../lib/store'

const NAV = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/qr', label: 'My QR Codes', icon: QrIcon },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/subscription', label: 'Subscription', icon: CreditCard },
  { to: '/app/receipts', label: 'Payments / Receipts', icon: ReceiptText },
  { to: '/app/cards', label: 'Print Orders', icon: Printer },
  { to: '/app/profile', label: 'Business Profile', icon: Store },
  { to: '/app/support', label: 'Support', icon: LifeBuoy },
]

export function ClientLayout() {
  const session = useApp(s => s.session)
  const logout = useApp(s => s.logout)
  const qrs = useApp(s => s.qrs)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)

  if (!session || session.role !== 'client') {
    return <RedirectToLogin />
  }

  const myQrs = qrs.filter(q => q.accountEmail === session.email)
  const alerts = myQrs.filter(q => ['GRACE', 'EXPIRED', 'PROVISIONAL_ACTIVE'].includes(q.subscription)).length

  const Sidebar = (
    <aside className="w-[248px] shrink-0 h-full flex flex-col border-r border-ink/8 bg-white/70 backdrop-blur">
      <div className="px-5 h-16 flex items-center border-b border-ink/8">
        <Link to="/"><Wordmark /></Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end as boolean | undefined}
            className={({ isActive }) => isActive ? 'sidebar-link-active' : 'sidebar-link'}>
            <n.icon size={17} strokeWidth={2.4} /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-ink/8 space-y-2">
        <div className="card-solid p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-ink/60">
            <LiveDot tone={alerts ? 'gold' : 'teal'} /> Signed in as client
          </div>
          <p className="text-sm font-extrabold mt-1 truncate">{session.email}</p>
          <p className="text-[11px] text-ink/50">{myQrs.length} QR{myQrs.length === 1 ? '' : 's'} managed</p>
        </div>
        <button onClick={() => { logout(); nav('/') }} className="btn-ghost w-full justify-start !py-2 text-xs">
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </aside>
  )

  return (
    <div className="grain min-h-screen flex flex-col">
      {/* top bar */}
      <header className="h-16 shrink-0 sticky top-0 z-30 bg-cream/85 backdrop-blur border-b border-ink/8 flex items-center gap-3 px-4 lg:px-6">
        <button className="lg:hidden btn-ghost !p-2" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
        <div className="hidden lg:block w-[248px] -ml-2" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-lg leading-tight truncate">ReviewDoor · Client workspace</p>
          <p className="text-[11px] text-ink/50 -mt-0.5">Is my QR working, and what do I do next?</p>
        </div>
        <Link to="/app/subscription" className="relative btn-secondary btn-sm">
          <Bell size={14} /> Renew
          {alerts > 0 && <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-gold text-ink text-[9px] font-black grid place-items-center">{alerts}</span>}
        </Link>
        <Link to="/admin" className="btn-ghost btn-sm hidden sm:inline-flex"><ShieldCheck size={14} /> Admin view</Link>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="hidden lg:block sticky top-16 h-[calc(100vh-4rem)]">{Sidebar}</div>
        <AnimatePresence>
          {open && (
            <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
              <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
                className="absolute left-0 top-0 h-full bg-cream shadow-lift">
                <button className="absolute top-4 right-4 btn-ghost !p-2" onClick={() => setOpen(false)}><X size={18} /></button>
                {Sidebar}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

function RedirectToLogin() {
  return (
    <div className="grain min-h-screen grid place-items-center p-6">
      <div className="card-solid p-8 text-center max-w-sm">
        <div className="mx-auto w-fit mb-3"><Wordmark size={40} /></div>
        <h2 className="display text-xl">Sign in required</h2>
        <p className="text-sm text-ink/60 mt-2">The client workspace is protected by server-side authorization. Please log in.</p>
        <Link to="/login" className="btn-primary mt-5 w-full">Go to login <ChevronRight size={15} /></Link>
      </div>
    </div>
  )
}
