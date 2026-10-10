/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0C1618',
        teal: {
          DEFAULT: '#004643',
          deep: '#003734',
          soft: '#0B5B57',
          faint: '#E3EDEB',
        },
        cream: {
          DEFAULT: '#FAF4D3',
          soft: '#FDF9E8',
          dim: '#F2EAC2',
        },
        gold: {
          DEFAULT: '#D1AC00',
          soft: '#FBF3CF',
          deep: '#A88B00',
        },
        peach: {
          DEFAULT: '#F6BE9A',
          soft: '#FCEBDD',
          deep: '#E8A274',
        },
      },
      fontFamily: {
        display: ['"Clash Display"', '"Space Grotesk"', 'Manrope', 'sans-serif'],
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(12,22,24,0.04), 0 8px 24px -12px rgba(12,22,24,0.12)',
        lift: '0 2px 4px rgba(12,22,24,0.05), 0 16px 40px -16px rgba(0,70,67,0.22)',
        glow: '0 0 0 1px rgba(209,172,0,0.35), 0 8px 30px -8px rgba(209,172,0,0.35)',
      },
      opacity: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, String(i / 100)])),
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        scanline: {
          '0%': { top: '6%' },
          '50%': { top: '88%' },
          '100%': { top: '6%' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '80%,100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        scanline: 'scanline 3.2s cubic-bezier(.65,0,.35,1) infinite',
        marquee: 'marquee 30s linear infinite',
        pulseRing: 'pulseRing 2.2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
}
