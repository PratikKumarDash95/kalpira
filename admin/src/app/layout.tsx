import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kalpira Admin',
  description: 'Standalone admin console for Kalpira',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="kalpira-light min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
