'use client';

// Generic authed-page shell: sticky Navbar + centered content container + Footer.
// Lets inner pages drop their ad-hoc top bars and inherit consistent chrome.
import React from 'react';
import Navbar from './Navbar';
import Footer from './Footer';

export default function PageShell({
  children,
  showProductNav = true,
  showFooter = true,
  maxWidth = '1200px',
  padded = true,
}: {
  children: React.ReactNode;
  showProductNav?: boolean;
  showFooter?: boolean;
  maxWidth?: string;
  padded?: boolean;
}) {
  return (
    <div className="app-shell flex min-h-screen flex-col">
      <Navbar showProductNav={showProductNav} />
      <main className="flex-1">
        <div className="mx-auto w-full px-4" style={{ maxWidth }}>
          <div className={padded ? 'py-8 sm:py-10' : ''}>{children}</div>
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  );
}
