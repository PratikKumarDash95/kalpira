'use client';

// The app's single navigation surface. Brand left, product nav center,
// account right — plus the mobile drawer, so pages never build their own
// hamburger/menu again.
//
// Width is passed down from PageShell so the bar lines up with the content
// column on narrow, default and wide pages alike.
//
// Two things here are load-bearing for how navigation feels:
//
//   1. Nav items are <Link>, not <button onClick={router.push}>. Next only
//      prefetches routes it can see as links, so buttons made every nav click a
//      cold server round trip that rendered the route's loading boundary — which
//      is what made moving between tabs feel like a page reload.
//   2. The account slot renders from the shared profile cache, so it does not
//      flip from "Sign in" to the avatar on every mount. Role-gated items are
//      held back until the session is *known*, so they can never appear and then
//      disappear once the role arrives.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Menu, UserCircle, X } from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';
import { BrandLockup } from './BrandMark';
import type { PageWidth } from './PageShell';

export interface NavLink {
  label: string;
  /** Destination. Internal hrefs are rendered as <Link> so Next can prefetch. */
  href: string;
  /**
   * Path prefix used to mark the item active, when it differs from `href`
   * (e.g. Interviewer points at /login when signed out but is "current" on any
   * /interviewer route).
   */
  activePrefix?: string;
  /** Render as a plain anchor instead of a prefetching <Link> (cross-origin). */
  external?: boolean;
}

const WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: 'mx-auto w-full max-w-3xl px-4',
  default: 'app-container',
  wide: 'app-container-wide',
  full: 'w-full px-4 sm:px-6',
};

/** The account chip's footprint, so the slot never shifts as the session resolves. */
const ACCOUNT_PLACEHOLDER = 'h-9 w-24 rounded-xl';

export default function Navbar({
  transparent = false,
  showProductNav = true,
  width = 'default',
}: {
  transparent?: boolean;
  showProductNav?: boolean;
  width?: PageWidth;
}) {
  const pathname = usePathname();
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';
  const { status, profile } = useProfile();
  const [mobileOpen, setMobileOpen] = useState(false);

  // A route change closes the drawer — otherwise it stays open over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes it, matching every other overlay in the app.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const links: NavLink[] = [];
  if (showProductNav) {
    links.push({ label: 'Studies', href: '/studies' });
    // Personal to the signed-in user, so it is not role-gated: everyone who
    // practises has an ability map.
    links.push({ label: 'Ability', href: '/ability' });
    // Same reasoning as Ability: the delivery profile is about the signed-in
    // person's own answers, whoever they are in the product.
    links.push({ label: 'Delivery', href: '/delivery' });

    // Role-gated, so only offered once we actually know the role. Rendering
    // these while the profile is unknown is what made them flash in and out.
    if (status !== 'unknown') {
      const isInterviewer = profile?.role === 'interviewer' || profile?.role === 'admin';
      if (isInterviewer) {
        links.push({
          label: 'Interviewer',
          // Signed in as an interviewer: straight to their portal. Otherwise the
          // link is the way in, so it goes through the role-specific login.
          href: status === 'authed' ? '/interviewer/dashboard' : '/login?role=interviewer',
          activePrefix: '/interviewer',
        });
      } else if (status === 'guest') {
        // Offer the portal to signed-out visitors — it is how interviewers get in.
        links.push({
          label: 'Interviewer',
          href: '/login?role=interviewer',
          activePrefix: '/interviewer',
        });
      }

      if (profile?.role === 'admin') {
        links.push({ label: 'Admin', href: adminUrl, external: true });
      }
    }
  }

  const isActive = (link: NavLink) => {
    const prefix = link.activePrefix ?? link.href.split('?')[0];
    return Boolean(prefix) && (pathname === prefix || pathname.startsWith(`${prefix}/`));
  };

  const renderAccount = () => {
    // Unknown: a same-size placeholder rather than a guess. Showing "Sign in"
    // here and swapping it for the avatar is exactly the flicker we are fixing.
    if (status === 'unknown') {
      return <span className={`skeleton ${ACCOUNT_PLACEHOLDER}`} aria-hidden="true" />;
    }

    if (status === 'guest') {
      return (
        <Link href="/login" className="btn-primary sheen px-4 py-2 text-sm">
          Sign in <ArrowRight size={16} />
        </Link>
      );
    }

    return (
      <Link href="/profile" className="btn-secondary px-3 py-2 text-sm">
        {profile?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatarUrl}
            alt={profile.name || 'Profile'}
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <UserCircle size={20} className="text-brand-700" />
        )}
        <span className="hidden sm:inline max-w-[120px] truncate">
          {profile?.name || profile?.email}
        </span>
      </Link>
    );
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b border-[color:var(--line)] ${
        transparent ? 'bg-[color:var(--bg)]/80' : 'bg-[color:var(--surface)]/90'
      } backdrop-blur-md`}
    >
      <div className={`${WIDTH_CLASS[width]} flex h-16 items-center justify-between gap-4`}>
        <Link href="/" className="flex items-center text-left">
          <BrandLockup />
        </Link>

        {/* Desktop nav */}
        {links.length > 0 && (
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            {links.map((l) =>
              l.external ? (
                <a
                  key={l.label}
                  href={l.href}
                  className="link-sweep rounded-lg px-3.5 py-2 text-[color:var(--muted)] transition-colors hover:text-[color:var(--brand-strong)]"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label}
                  href={l.href}
                  aria-current={isActive(l) ? 'page' : undefined}
                  className={`link-sweep rounded-lg px-3.5 py-2 transition-colors hover:text-[color:var(--brand-strong)] ${
                    isActive(l) ? 'text-[color:var(--brand-strong)]' : 'text-[color:var(--muted)]'
                  }`}
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {renderAccount()}

          {links.length > 0 && (
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="btn-ghost p-2 md:hidden"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile drawer — the only place product nav lives below md. */}
      {mobileOpen && links.length > 0 && (
        <nav className="animate-fade-in-down border-t border-[color:var(--line)] md:hidden">
          <div className={`${WIDTH_CLASS[width]} flex flex-col py-2`}>
            {links.map((l) =>
              l.external ? (
                <a
                  key={l.label}
                  href={l.href}
                  className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[color:var(--muted)]"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label}
                  href={l.href}
                  aria-current={isActive(l) ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    isActive(l) ? 'text-[color:var(--brand-strong)]' : 'text-[color:var(--muted)]'
                  }`}
                >
                  {l.label}
                </Link>
              ),
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
