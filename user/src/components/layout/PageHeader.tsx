'use client';

// Page identity block — the title region every page opens with.
// Emits the shared `.page-header` grammar so titles, icons, back links and
// page-level actions land in the same place on every screen.
import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

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
  /** Back affordance: a route to push, or a handler. */
  back?: string | (() => void);
  /** Secondary row under the title — filters, tabs, a search field. */
  children?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();

  const goBack = () => {
    if (typeof back === 'function') back();
    else if (back) router.push(back);
  };

  return (
    <div className={className}>
      <div className="page-header">
        <div className="flex min-w-0 items-center gap-3">
          {back && (
            <button
              type="button"
              onClick={goBack}
              aria-label="Go back"
              className="btn-ghost shrink-0 p-2"
            >
              <ArrowLeft size={18} />
            </button>
          )}
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
