import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // The interviewer app renders components from the sibling user app; scan them
    // so their Tailwind classes (incl. the brand scale) are generated here too.
    '../user/src/components/**/*.{js,ts,jsx,tsx,mdx}',
    '../user/src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'sans': ['Inter', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(23,19,38,0.04), 0 8px 24px rgba(23,19,38,0.06)',
        'card-lg': '0 2px 4px rgba(23,19,38,0.05), 0 18px 48px rgba(23,19,38,0.10)',
      },
      colors: {
        // Merra brand — solid purple. Use `bg-brand`, `text-brand`, `border-brand`
        // in new components; 500 is the primary (#6D4AFF).
        brand: {
          50: '#f3f0ff',
          100: '#e9e3ff',
          200: '#d5cbff',
          300: '#b7a5ff',
          400: '#9376ff',
          500: '#6d4aff',
          600: '#5a38e8',
          700: '#4b2cc4',
          800: '#3e269e',
          900: '#33227d',
          950: '#1f1450',
        },
        // The legacy palette keys below are repainted at runtime by the
        // `.kalpira-light` layer in globals.css. We keep them mapped to LIGHT
        // neutrals here too, so any surface that escapes that layer still reads
        // light instead of dark. `violet`/`indigo` point at the brand purple so
        // stray accent utilities stay on-brand.
        slate: {
          50: '#fafaff',
          100: '#f4f3fb',
          200: '#eceaf5',
          300: '#dedbec',
          400: '#a4a0bd',
          500: '#6b6785',
          600: '#524e6b',
          700: '#3a3752',
          800: '#ffffff',
          900: '#ffffff',
          950: '#fafaff',
        },
        stone: {
          50: '#fafaff',
          100: '#f4f3fb',
          200: '#eceaf5',
          300: '#dedbec',
          400: '#a4a0bd',
          500: '#6b6785',
          600: '#524e6b',
          700: '#3a3752',
          800: '#ffffff',
          850: '#ffffff',
          900: '#ffffff',
          950: '#fafaff',
        },
        violet: {
          50: '#f3f0ff',
          100: '#e9e3ff',
          200: '#d5cbff',
          300: '#b7a5ff',
          400: '#9376ff',
          500: '#6d4aff',
          600: '#5a38e8',
          700: '#4b2cc4',
          800: '#3e269e',
          900: '#33227d',
          950: '#1f1450',
        },
        indigo: {
          50: '#f3f0ff',
          100: '#e9e3ff',
          200: '#d5cbff',
          300: '#b7a5ff',
          400: '#9376ff',
          500: '#6d4aff',
          600: '#5a38e8',
          700: '#4b2cc4',
          800: '#3e269e',
          900: '#33227d',
          950: '#1f1450',
        },
      },
    },
  },
  plugins: [],
}
export default config
