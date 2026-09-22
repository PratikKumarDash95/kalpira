import type { Config } from 'tailwindcss'

/* ============================================================
   Kalpira design system — "Lumen" (yellow + white)
   ------------------------------------------------------------
   Single source of truth for the palette, type, motion and depth
   used by every Kalpira surface. `brand` is the only accent any
   new component should reach for.

   Every legacy accent key (pink/rose/fuchsia/purple/violet/indigo)
   is aliased onto `brand` so a stray old utility still renders
   on-palette instead of leaking pink/purple back into the UI.
   ============================================================ */

/* Brand — bright lemon yellow. 500 is the primary fill; 700 is the
   darkest step that still reads as brand TEXT on white. */
const brand = {
  50: '#fefce8',
  100: '#fef9c3',
  200: '#fef08a',
  300: '#fde047',
  400: '#facc15',
  500: '#facc15', // primary fill (buttons, active pills, tiles)
  600: '#eab308', // hover fill
  700: '#a16207', // brand text/icons on white
  800: '#854d0e',
  900: '#713f12',
  950: '#422006',
}

/* Warm neutrals — cream-tinted so white surfaces feel intentional
   rather than clinical. 800/900/950 are repainted to white/near-white
   to match the light surfaces the app is authored against. */
const warm = {
  50: '#fdfcf3',
  100: '#faf7ec',
  200: '#f2ecda',
  300: '#e6dcc2',
  400: '#a8a29e',
  500: '#78716c',
  600: '#57534e',
  700: '#3f3a2e',
  800: '#ffffff',
  850: '#ffffff',
  900: '#ffffff',
  950: '#fdfcf3',
}

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // One family across every Kalpira surface (all roles/apps). The leading
        // var() is injected by next/font in layout.tsx — self-hosted, so there is
        // no render-blocking request to fonts.googleapis.com. The literal family
        // names stay as fallbacks for any surface rendered without that class.
        sans: ['var(--font-sans)', 'Plus Jakarta Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-sans)', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand,
        // Legacy accent keys repainted to brand so old markup stays on-palette.
        yellow: brand,
        amber: brand,
        pink: brand,
        rose: brand,
        fuchsia: brand,
        purple: brand,
        violet: brand,
        indigo: brand,
        // Legacy neutral keys warmed to cream.
        slate: warm,
        stone: warm,
        gray: warm,
        zinc: warm,
        neutral: warm,
      },
      boxShadow: {
        card: '0 1px 2px rgba(64,50,10,0.05), 0 8px 24px rgba(64,50,10,0.07)',
        'card-lg': '0 2px 4px rgba(64,50,10,0.06), 0 18px 48px rgba(64,50,10,0.12)',
        glow: '0 6px 18px rgba(234,179,8,0.30)',
        'glow-lg': '0 10px 34px rgba(234,179,8,0.42)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.9)',
      },
      borderRadius: {
        card: '1rem',
        control: '0.75rem',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #facc15 0%, #eab308 100%)',
        'brand-sheen': 'linear-gradient(90deg, #eab308 0%, #facc15 50%, #eab308 100%)',
        'page-wash':
          'radial-gradient(circle at 12% -4%, rgba(250,204,21,0.14), transparent 42%), radial-gradient(circle at 96% 0%, rgba(234,179,8,0.10), transparent 40%)',
        'grid-fade':
          'linear-gradient(to right, rgba(64,50,10,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(64,50,10,0.05) 1px, transparent 1px)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-down': {
          from: { opacity: '0', transform: 'translateY(-16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(250,204,21,0)' },
          '50%': { boxShadow: '0 0 0 10px rgba(250,204,21,0.16)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'skeleton-wave': {
          '0%': { backgroundPosition: '120% 0' },
          '100%': { backgroundPosition: '-120% 0' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '60%': { opacity: '1', transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.55s cubic-bezier(0.22,1,0.36,1) both',
        'fade-down': 'fade-down 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.5s ease both',
        'scale-in': 'scale-in 0.42s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in-left': 'slide-in-left 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in-right': 'slide-in-right 0.5s cubic-bezier(0.22,1,0.36,1) both',
        float: 'float 6s ease-in-out infinite',
        glow: 'glow-pulse 2.4s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
        'gradient-pan': 'gradient-pan 6s ease infinite',
        skeleton: 'skeleton-wave 1.45s ease-in-out infinite',
        'pop-in': 'pop-in 0.4s cubic-bezier(0.22,1,0.36,1) both',
        'spin-slow': 'spin-slow 1.4s linear infinite',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
export default config
