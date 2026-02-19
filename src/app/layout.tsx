import type { Metadata } from 'next'
import './globals.css'
import PreviewBanner from '@/components/PreviewBanner'

export const metadata: Metadata = {
  title: 'AI Interview Practice System',
  description: 'AI-powered adaptive interview practice and coaching platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 font-sans antialiased">
        <PreviewBanner />
        {children}
      </body>
    </html>
  )
}
