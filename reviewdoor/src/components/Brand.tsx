import { motion } from 'framer-motion'

/* ──────────────────────────────────────────────
   ReviewDoor brand logo — door + QR finder motif
   ──────────────────────────────────────────── */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden>
      <defs>
        <linearGradient id="rd-door-g" x1="8" y1="6" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0B5B57" /><stop offset="1" stopColor="#004643" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="42" height="42" rx="12" fill="#0C1618" />
      <rect x="1" y="1" width="42" height="42" rx="12" stroke="#D1AC00" strokeOpacity=".35" strokeWidth="1.2" />
      <path d="M13 36V20a9 9 0 0 1 18 0v16h-4.2V20.5a4.8 4.8 0 0 0-9.6 0V36H13Z" fill="url(#rd-door-g)" />
      <circle cx="22" cy="11.2" r="2.6" fill="#F6BE9A" />
      <rect x="18.4" y="23.4" width="7.2" height="7.2" rx="1.6" stroke="#FAF4D3" strokeWidth="1.8" fill="none" />
      <rect x="20.8" y="25.8" width="2.4" height="2.4" rx=".6" fill="#D1AC00" />
    </svg>
  )
}

export function Wordmark({ dark = false, size = 34 }: { dark?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 group">
      <LogoMark size={size} />
      <span className="font-display font-semibold text-[19px] leading-none tracking-tight">
        <span className={dark ? 'text-cream' : 'text-ink'}>Review</span>
        <span className="text-teal group-hover:text-gold transition-colors">Door</span>
      </span>
    </span>
  )
}

/* animated status dot used across dashboards */
export function LiveDot({ tone = 'teal' }: { tone?: 'teal' | 'gold' | 'danger' | 'peach' }) {
  const c = tone === 'teal' ? '#004643' : tone === 'gold' ? '#D1AC00' : tone === 'danger' ? '#B91C1C' : '#E8A274'
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: c }}
        animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
      />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: c }} />
    </span>
  )
}
