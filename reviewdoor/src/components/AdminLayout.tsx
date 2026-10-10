import { Link, NavLink, Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldCheck, QrCode, ScrollText, LogOut, Bell, LayoutDashboard, ReceiptText, Printer, Users } from 'lucide-react'
import { Wordmark } from './Brand'
import { useApp } from '../lib/store'

const NAV = [
  { to: '/admin', label: 'Operations', icon: LayoutDashboard, end: true },
  { to: '/admin/receipts', label: 'Receipt queue', icon: ReceiptText },
  { to: '/admin/qr', label: 'QR moderation', icon: QrCode },
  { to: '/admin/orders', label: 'Card orders', icon: Printer },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
]

export function AdminLayout() {
  const session = useApp(s => s.session)
  const logout = useApp(s => s.logout)
  const receipts = useApp(s => s.receipts)
  const pending = receipts.filter(r => ['PENDING', 'PROCESSING', 'NEEDS_REVIEW'].includes(r.state)).length

  if (!session || session.role !== 'admin') {
    return (
      <div className="grain min-h-screen grid place-items-center p-6">
        <div className="card-solid p-8 text-center max-w-sm">
          <div className="mx-auto w-fit mb-3"><Wordmark size={40} /></div>
          <h2 className="display text-xl">Admin area protected</h2>
          <p className="text-sm text-ink/60 mt-2">Sign in with an admin account (email starting with <span className="font-mono font-bold">admin</span>) to access operations.</p>
          <Link to="/login" className="btn-primary mt-5 w-full">Go to login</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="grain min-h-screen flex flex-col bg-ink text-cream">
      <header className="h-16 shrink-0 border-b border-white/10 flex items-center gap-4 px-4 sm:px-6 bg-ink/95 backdrop-blur sticky top-0 z-40">
        <Link to="/"><Wordmark dark /></Link>
        <span className="chip bg-gold/15 text-gold ring-1 ring-inset ring-gold/40 hidden sm:inline-flex"><ShieldCheck size={13} /> Admin console</span>
        <div className="flex-1" />
        <span className="relative hidden sm:inline-flex btn !bg-white/5 text-cream/80 hover:bg-white/10 btn-sm"><Bell size={14} /> Ops
          {pending > 0 && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-gold text-ink text-[9px] font-black grid place-items-center">{pending}</span>}
        </span>
        <div className="hidden md:flex items-center gap-2 text-xs text-cream/60"><Users size={14} /> {session.email}</div>
        <button onClick={() => { logout(); window.location.href = '/' }} className="btn !bg-white/5 text-cream/80 hover:bg-white/10 btn-sm"><LogOut size={13} /> Sign out</button>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="hidden lg:flex w-[230px] shrink-0 flex-col gap-1 p-3 border-r border-white/10 sticky top-16 h-[calc(100vh-4rem)]">
          {NAV.map(n => (
            <NavLinkDark key={n.to} to={n.to} end={n.end as boolean | undefined} icon={n.icon} label={n.label} badge={n.to === '/admin/receipts' ? pending : undefined} />
          ))}
          <div className="mt-auto card !bg-white/5 !border-white/10 p-3 text-[11px] text-cream/60 leading-relaxed">
            Queue-oriented UI: filters, risk chips, drawers and full audit trail. Every action records actor + reason.
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            {/* mobile nav */}
            <div className="lg:hidden flex gap-2 overflow-x-auto pb-3 mb-3">
              {NAV.map(n => (
                <NavLinkDark key={n.to} to={n.to} end={n.end as boolean | undefined} icon={n.icon} label={n.label} compact />
              ))}
            </div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

function NavLinkDark({ to, end, icon: Icon, label, badge, compact }: any) {
  return (
    <motion.span whileHover={{ x: 2 }}>
      <NavLink to={to} end={end}
        className={({ isActive }) =>
          `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${isActive ? 'bg-teal text-cream' : 'text-cream/60 hover:text-cream hover:bg-white/5'} ${compact ? 'whitespace-nowrap' : ''}`}>
        <Icon size={16} strokeWidth={2.4} /> {label}
        {badge ? <span className="ml-auto h-5 min-w-5 px-1 rounded-full bg-gold text-ink text-[10px] font-black grid place-items-center">{badge}</span> : null}
      </NavLink>
    </motion.span>
  )
}
