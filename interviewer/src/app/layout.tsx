import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kalpira Interviewer',
  description: 'Interviewer portal for creating interviews and reviewing candidates',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
