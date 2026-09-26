'use client';

// The single chrome for every in-app page.
//
// Structure every page shares:
//   <PageShell>            navbar + centered content column + footer
//     <PageHeader />       page identity (title/subtitle/actions)
//     <PageSection />      one content region (optional title + actions)
//   </PageShell>
//
// Pages own only their content. Navigation, container width and vertical rhythm
// come from here, so a new page cannot invent its own top bar or container width.
//
// Note: the `.kalpira-light` repaint layer is applied once, globally, on <body>
// in app/layout.tsx — it is not repeated here. Pages authored against the old
// dark palette are normalised by that layer, so a page's own `bg-slate-950`
// classes are already neutral and need no special handling.
//
// `<main>` carries `animate-page-in`. Each navigation mounts a fresh page tree
// (the shell lives in the page, not a layout), so the animation replays on its
// own — no `key` and no `template.tsx`, both of which would remount and refetch
// the page's data. The navbar is deliberately outside it, so the chrome holds
// still and only the content moves.
import React from 'react';
import Navbar from './Navbar';
import Footer from './Footer';

export type PageWidth = 'narrow' | 'default' | 'wide' | 'full';

const WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: 'mx-auto w-full max-w-3xl px-4',
  default: 'app-container',
  wide: 'app-container-wide',
  // No container: the page manages its own full-bleed layout.
  full: 'w-full',
};

export default function PageShell({
  children,
  width = 'default',
  showProductNav = true,
  showFooter = true,
  padded = true,
}: {
  children: React.ReactNode;
  /** Content column width. `wide` for data-dense pages (dashboards, tables). */
  width?: PageWidth;
  showProductNav?: boolean;
  showFooter?: boolean;
  padded?: boolean;
}) {
  return (
    <div className="app-shell flex min-h-screen flex-col">
      <Navbar showProductNav={showProductNav} width={width} />
      <main className="animate-page-in flex-1">
        <div className={WIDTH_CLASS[width]}>
          <div className={padded ? 'py-8 sm:py-10' : ''}>{children}</div>
        </div>
      </main>
      {showFooter && <Footer width={width} />}
    </div>
  );
}
