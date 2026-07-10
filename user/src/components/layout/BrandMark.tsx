'use client';

// Brand mark used across nav / sidebars / auth cards. The Merra reference uses
// a solid purple rounded-square tile with a 2x2 diamond glyph.
import React from 'react';

export function BrandMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  const inner = Math.round(size * 0.5);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-brand-500 shadow-[0_6px_16px_rgba(109,74,255,0.28)] ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="7" rx="2" transform="rotate(45 7 7)" fill="#fff" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="2" transform="rotate(45 17 7)" fill="#fff" fillOpacity="0.85" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="2" transform="rotate(45 7 17)" fill="#fff" fillOpacity="0.85" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="2" transform="rotate(45 17 17)" fill="#fff" />
      </svg>
    </span>
  );
}

export function BrandLockup({ subtitle }: { subtitle?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={36} />
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-[color:var(--text)]">Kalpira</span>
        {subtitle && <span className="block text-[11px] text-[color:var(--muted)]">{subtitle}</span>}
      </span>
    </span>
  );
}

export default BrandMark;
