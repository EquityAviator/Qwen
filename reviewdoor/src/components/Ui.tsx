import { QRCodeSVG } from 'qrcode.react'
import { motion } from 'framer-motion'
import { Check, Clock3, AlertTriangle, Ban, Archive } from 'lucide-react'
import { StatusModel } from '../lib/domain'

/* Dynamic QR render — encodes ONLY the platform route (FR-07) */
export function QrView({ url, size = 168, dark = false }: { url: string; size?: number; dark?: boolean }) {
  return (
    <div className="qr-frame bg-white p-3 rounded-xl shadow-card" style={{ width: size + 24 }}>
      <span className="brk absolute inset-0 pointer-events-none" />
      <QRCodeSVG value={url} size={size} bgColor="#FFFFFF" fgColor={dark ? '#FAF4D3' : '#0C1618'} level="H" marginSize={1} />
    </div>
  )
}

const ICONS = { check: Check, clock: Clock3, alert: AlertTriangle, ban: Ban, archive: Archive }
const TONES: Record<StatusModel['tone'], string> = {
  teal: 'chip-teal', gold: 'chip-gold', peach: 'chip-peach', danger: 'chip-danger', neutral: 'chip-neutral',
}

/* Icon + text chip — never color alone (§10.2) */
export function StatusChip({ s, big = false }: { s: StatusModel; big?: boolean }) {
  const Icon = ICONS[s.iconHint]
  return (
    <span className={`${TONES[s.tone]} ${big ? 'px-3.5 py-1.5 text-sm' : ''}`} role="status">
      <Icon size={big ? 16 : 13} strokeWidth={2.6} aria-hidden />
      {s.label}
    </span>
  )
}

/* phone mock with animated scan line — hero centerpiece */
export function ScanPhoneMock({ qrUrl }: { qrUrl: string }) {
  return (
    <motion.div
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      className="relative w-[240px] sm:w-[260px]"
    >
      {/* pulse rings behind phone */}
      <span className="absolute -inset-8 rounded-full border-2 border-teal/15 animate-pulseRing" />
      <span className="absolute -inset-8 rounded-full border-2 border-gold/20 animate-pulseRing [animation-delay:1.1s]" />
      <div className="relative rounded-[2.4rem] border-[6px] border-ink bg-ink p-2 shadow-lift">
        <div className="rounded-[1.9rem] overflow-hidden bg-cream">
          <div className="flex items-center justify-between px-5 pt-3 pb-1 text-[10px] font-bold text-ink/50">
            <span>9:41</span><span className="tracking-widest">SCAN</span><span>▂▄▆ ⚡87</span>
          </div>
          <div className="dotgrid flex flex-col items-center gap-3 px-5 pt-6 pb-7">
            <div className="relative">
              <QrView url={qrUrl} size={150} />
              {/* moving scan line */}
              <span className="absolute left-1 right-1 h-[3px] rounded-full bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_12px_rgba(209,172,0,.8)] animate-scanline" />
            </div>
            <div className="text-center">
              <p className="font-display font-semibold text-ink text-sm leading-tight">Spice Route</p>
              <p className="text-[11px] text-ink/55 mt-0.5">Opening your Google review…</p>
            </div>
            <motion.div
              className="w-full rounded-xl bg-teal text-cream text-xs font-bold py-2.5 text-center"
              animate={{ opacity: [1, 0.55, 1] }} transition={{ duration: 2.4, repeat: Infinity }}
            >
              Redirecting in 1s →
            </motion.div>
          </div>
        </div>
      </div>
      {/* floating chips around phone */}
      <motion.span
        className="absolute -left-16 top-16 card-solid px-3 py-2 text-xs font-bold text-teal flex items-center gap-1.5"
        animate={{ y: [0, 8, 0] }} transition={{ duration: 4, repeat: Infinity }}
      ><Check size={13} className="text-teal" strokeWidth={3} /> No reprint needed</motion.span>
      <motion.span
        className="absolute -right-14 bottom-24 card-solid px-3 py-2 text-xs font-bold text-gold-deep flex items-center gap-1.5"
        animate={{ y: [0, -8, 0] }} transition={{ duration: 5, repeat: Infinity, delay: .6 }}
      ><Clock3 size={13} strokeWidth={2.6} /> Grace period active</motion.span>
    </motion.div>
  )
}
