'use client';

// Merra-style footer: brand blurb + link columns + legal row.
import React from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Studies', href: '/studies' },
      { label: 'Practice', href: '/setup' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/' },
      { label: 'Interviewer portal', href: '/login?role=interviewer' },
      { label: 'Pricing', href: '/#pricing' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/' },
      { label: 'Terms', href: '/' },
      { label: 'GDPR', href: '/' },
    ],
  },
];

export default function Footer() {
  const router = useRouter();
  const go = (href: string) => {
    if (href.startsWith('/#')) {
      const el = document.getElementById(href.slice(2));
      if (el) return el.scrollIntoView({ behavior: 'smooth' });
    }
    router.push(href);
  };

  return (
    <footer className="border-t border-[color:var(--line)] bg-[color:var(--surface)]">
      <div className="app-container py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark size={36} />
              <span className="text-[15px] font-bold tracking-tight text-[color:var(--text)]">Kalpira</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[color:var(--muted)]">
              One consistent workspace for research studies, adaptive interview practice, and hiring — built for teams.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--faint)]">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <button
                      onClick={() => go(link.href)}
                      className="text-sm text-[color:var(--muted)] transition-colors hover:text-[color:var(--brand-strong)]"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-[color:var(--line)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[color:var(--faint)]">© {new Date().getFullYear()} Kalpira. All rights reserved.</p>
          <p className="text-xs text-[color:var(--faint)]">Built for research, practice, and hiring teams.</p>
        </div>
      </div>
    </footer>
  );
}
