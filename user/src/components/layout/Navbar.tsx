'use client';

// Shared top navbar matching the Merra reference: brand left, centered nav,
// sign-in / profile right. Role-gated nav items mirror the logic that used to
// live inline in app/page.tsx. Reused across the landing page and authed pages.

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, UserCircle } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { BrandLockup } from './BrandMark';

interface HeaderProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
  role?: string;
}

export interface NavLink {
  label: string;
  onClick: () => void;
}

export default function Navbar({
  transparent = false,
  showProductNav = true,
}: {
  transparent?: boolean;
  showProductNav?: boolean;
}) {
  const router = useRouter();
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';
  const [profile, setProfile] = useState<HeaderProfile | null>(null);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.profile) setProfile(data.profile);
      })
      .catch(() => {});
  }, []);

  const links: NavLink[] = [];
  if (showProductNav) {
    links.push({ label: 'Studies', onClick: () => router.push('/studies') });
    if (!profile || profile.role === 'interviewer' || profile.role === 'admin') {
      links.push({ label: 'Interviewer', onClick: () => router.push('/login?role=interviewer') });
    }
    if (!profile || profile.role === 'admin') {
      links.push({ label: 'Admin', onClick: () => { window.location.href = adminUrl; } });
    }
  }

  return (
    <header
      className={`sticky top-0 z-40 border-b border-[color:var(--line)] ${
        transparent ? 'bg-[color:var(--bg)]/80' : 'bg-[color:var(--surface)]/90'
      } backdrop-blur-md`}
    >
      <div className="app-container flex h-16 items-center justify-between gap-4">
        <button onClick={() => router.push('/')} className="flex items-center text-left">
          <BrandLockup />
        </button>

        {links.length > 0 && (
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            {links.map((l) => (
              <button
                key={l.label}
                onClick={l.onClick}
                className="rounded-lg px-3.5 py-2 text-[color:var(--muted)] transition-colors hover:bg-[color:var(--brand-soft)] hover:text-[color:var(--brand-strong)]"
              >
                {l.label}
              </button>
            ))}
          </nav>
        )}

        {profile ? (
          <button
            onClick={() => router.push('/profile')}
            className="btn-secondary px-3 py-2 text-sm"
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <UserCircle size={20} className="text-brand-500" />
            )}
            <span className="hidden sm:inline max-w-[120px] truncate">{profile.name || profile.email}</span>
          </button>
        ) : (
          <button onClick={() => router.push('/login')} className="btn-primary px-4 py-2 text-sm">
            Sign in <ArrowRight size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
