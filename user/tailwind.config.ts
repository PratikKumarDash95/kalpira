import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'sans': ['Inter', 'sans-serif'],
        'serif': ['DM Serif Display', 'Georgia', 'serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      colors: {
        stone: {
          850: '#1c1917',
        }
      }
    },
  },
  plugins: [],
}
export default config
