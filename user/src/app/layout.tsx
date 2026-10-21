import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import PreviewBanner from '@/components/PreviewBanner'
import AppCacheWarmer from '@/components/AppCacheWarmer'

// next/font downloads these at build time and serves them from our own origin,
// so the browser never makes a render-blocking request to fonts.googleapis.com
// before it can paint. Both are variable fonts, so one file covers every weight
// the design system uses (300–800) instead of the six static faces the old
// @import in globals.css pulled down. display: 'swap' paints text immediately in
// the fallback and swaps the webfont in when it arrives, so text is never
// invisible while fonts load.
const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Kalpira – AI Interview Practice',
  description: 'AI-powered adaptive interview practice and coaching platform',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="kalpira-light min-h-screen font-sans antialiased">
        <PreviewBanner />
        <AppCacheWarmer />
        {children}
      </body>
    </html>
  )
}
