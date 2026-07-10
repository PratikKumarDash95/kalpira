'use client';

// Persistent chrome for the interviewer portal, mirroring admin's AdminShell but
// in the flat Merra style. Handles the two mount contexts the interviewer
// components run in: the standalone interviewer app (paths at root, e.g.
// /dashboard) and the user app under the /interviewer/* prefix. Callers pass the
// active key; navigation uses portalPath() to build the right href.

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, GraduationCap, CreditCard, UserCircle,
  LogOut, Menu, X, ChevronRight,
} from 'lucide-react';
import { apiFetch, clearSessionDrafts } from '@/lib/apiClient';
import { BrandMark } from './BrandMark';

export type PortalNavKey = 'dashboard' | 'studies' | 'billing' | 'profile';

const NAV: { key: PortalNavKey; label: string; icon: React.ElementType; path: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { key: 'billing', label: 'Billing', icon: CreditCard, path: '/billing' },
  { key: 'profile', label: 'Profile', icon: UserCircle, path: '/profile' },
];

export default function PortalSidebar({
  active,
  title,
  children,
}: {
  active: PortalNavKey;
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || '';

  // Standalone interviewer app => paths at root; embedded under user app => /interviewer/*.
  const isStandalonePortal =
    process.env.NEXT_PUBLIC_PORTAL === 'interviewer' || !pathname?.startsWith('/interviewer');
  const portalPath = (p: string) => (isStandalonePortal ? p : `/interviewer${p}`);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth', { method: 'DELETE' });
    } finally {
      clearSessionDrafts();
      router.push(portalPath('/login'));
    }
  };

  const heading = title || NAV.find((n) => n.key === active)?.label || 'Interviewer';

  return (
    <div className="app-shell flex min-h-screen">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 bg-[color:var(--text)]/30 lg:hidden"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--surface)] transition-transform duration-300 lg:static ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="border-b border-[color:var(--line)] p-5">
          <div className="flex items-center gap-2.5">
            <BrandMark size={36} />
            <div className="leading-tight">
              <p className="text-sm font-bold text-[color:var(--text)]">Interviewer</p>
              <p className="text-xs text-[color:var(--muted)]">Kalpira portal</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-auto p-4">
          {NAV.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                onClick={() => { setOpen(false); router.push(portalPath(item.path)); }}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]'
                    : 'text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]'
                }`}
              >
                <item.icon size={16} />
                {item.label}
                {isActive && <ChevronRight size={14} className="ml-auto" />}
              </button>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-[color:var(--line)] p-4">
          {mainAppUrl && (
            <button
              onClick={() => { window.location.href = mainAppUrl; }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-[color:var(--muted)] transition-all hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]"
            >
              <GraduationCap size={16} /> Main app
            </button>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-[color:var(--danger)] transition-all hover:bg-[color:var(--danger-soft)]"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-[color:var(--line)] bg-[color:var(--surface)]/90 px-4 py-4 backdrop-blur-md sm:px-6">
          <button
            onClick={() => setOpen(!open)}
            className="rounded-lg p-2 text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] lg:hidden"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <h1 className="text-lg font-bold text-[color:var(--text)]">{heading}</h1>
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
