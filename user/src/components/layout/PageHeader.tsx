'use client';

// Page identity block — the title region every page opens with.
// Emits the shared `.page-header` grammar so titles, icons, back links and
// page-level actions land in the same place on every screen.
//
// When `back` is a route it renders a <Link> so Next prefetches the destination;
// the handler form stays a button, since it is an action rather than a place.
import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const BACK_BUTTON_CLASS = 'btn-ghost shrink-0 p-2';

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  back,
  children,
  className = '',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Small leading glyph (usually a lucide icon) shown in a tinted tile. */
  icon?: React.ReactNode;
  /** Page-level actions, right-aligned on desktop and wrapped below on mobile. */
  actions?: React.ReactNode;
  /** Back affordance: a route to link to, or a handler. */
  back?: string | (() => void);
  /** Secondary row under the title — filters, tabs, a search field. */
  children?: React.ReactNode;
  className?: string;
}) {
  const backGlyph = (
    <>
      <ArrowLeft size={18} />
    </>
  );

  const backControl =
    typeof back === 'function' ? (
      <button type="button" onClick={back} aria-label="Go back" className={BACK_BUTTON_CLASS}>
        {backGlyph}
      </button>
    ) : back ? (
      <Link href={back} aria-label="Go back" className={BACK_BUTTON_CLASS}>
        {backGlyph}
      </Link>
    ) : null;

  return (
    <div className={className}>
      <div className="page-header">
        <div className="flex min-w-0 items-center gap-3">
          {backControl}
          {icon && (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="page-title truncate">{title}</h1>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
        </div>

        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children}
    </div>
  );
}
