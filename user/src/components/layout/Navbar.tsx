'use client';

// The app's single navigation surface. Brand left, product nav center,
// account right — plus the mobile drawer, so pages never build their own
// hamburger/menu again.
//
// Width is passed down from PageShell so the bar lines up with the content
// column on narrow, default and wide pages alike.

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Menu, UserCircle, X } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { BrandLockup } from './BrandMark';
import type { PageWidth } from './PageShell';

interface HeaderProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
  role?: string;
}

export interface NavLink {
  label: string;
  onClick: () => void;
  /** Route this link points at, used to mark it active and to close the drawer. */
  href?: string;
}

const WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: 'mx-auto w-full max-w-3xl px-4',
  default: 'app-container',
  wide: 'app-container-wide',
  full: 'w-full px-4 sm:px-6',
};

export default function Navbar({
  transparent = false,
  showProductNav = true,
  width = 'default',
}: {
  transparent?: boolean;
  showProductNav?: boolean;
  width?: PageWidth;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';
  const [profile, setProfile] = useState<HeaderProfile | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.profile) setProfile(data.profile);
      })
      .catch(() => {});
  }, []);

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
    links.push({ label: 'Studies', href: '/studies', onClick: () => router.push('/studies') });
    if (!profile || profile.role === 'interviewer' || profile.role === 'admin') {
      links.push({ label: 'Interviewer', href: '/interviewer/dashboard', onClick: () => router.push('/login?role=interviewer') });
    }
    if (!profile || profile.role === 'admin') {
      links.push({ label: 'Admin', onClick: () => { window.location.href = adminUrl; } });
    }
  }

  const isActive = (href?: string) =>
    Boolean(href && (pathname === href || pathname.startsWith(`${href}/`)));

  return (
    <header
      className={`sticky top-0 z-40 border-b border-[color:var(--line)] ${
        transparent ? 'bg-[color:var(--bg)]/80' : 'bg-[color:var(--surface)]/90'
      } backdrop-blur-md`}
    >
      <div className={`${WIDTH_CLASS[width]} flex h-16 items-center justify-between gap-4`}>
        <button onClick={() => router.push('/')} className="flex items-center text-left">
          <BrandLockup />
        </button>

        {/* Desktop nav */}
        {links.length > 0 && (
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            {links.map((l) => (
              <button
                key={l.label}
                onClick={l.onClick}
                aria-current={isActive(l.href) ? 'page' : undefined}
                className={`link-sweep rounded-lg px-3.5 py-2 transition-colors hover:text-[color:var(--brand-strong)] ${
                  isActive(l.href) ? 'text-[color:var(--brand-strong)]' : 'text-[color:var(--muted)]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {profile ? (
            <button
              onClick={() => router.push('/profile')}
              className="btn-secondary px-3 py-2 text-sm"
            >
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <UserCircle size={20} className="text-brand-700" />
              )}
              <span className="hidden sm:inline max-w-[120px] truncate">{profile.name || profile.email}</span>
            </button>
          ) : (
            <button onClick={() => router.push('/login')} className="btn-primary sheen px-4 py-2 text-sm">
              Sign in <ArrowRight size={16} />
            </button>
          )}

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
            {links.map((l) => (
              <button
                key={l.label}
                onClick={l.onClick}
                aria-current={isActive(l.href) ? 'page' : undefined}
                className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  isActive(l.href) ? 'text-[color:var(--brand-strong)]' : 'text-[color:var(--muted)]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
