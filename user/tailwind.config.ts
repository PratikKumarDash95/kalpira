import type { Config } from 'tailwindcss'
import path from 'path'

const fromHere = (glob: string) => path.join(__dirname, glob)

const config: Config = {
  content: [
    fromHere('src/pages/**/*.{js,ts,jsx,tsx,mdx}'),
    fromHere('src/components/**/*.{js,ts,jsx,tsx,mdx}'),
    fromHere('src/app/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../admin/**/*.{js,ts,jsx,tsx,mdx}'),
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
