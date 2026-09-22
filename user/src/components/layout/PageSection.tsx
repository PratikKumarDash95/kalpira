'use client';

// One region inside a page: an optional heading row (label / title / actions)
// over a block of content. Gives every page the same vertical rhythm instead of
// each one inventing its own spacing and heading markup.
import React from 'react';

export default function PageSection({
  title,
  label,
  description,
  actions,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  /** Small uppercase kicker above the title. */
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned controls for this region. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hasHeading = Boolean(title || label || description || actions);

  return (
    <section className={`mb-6 last:mb-0 ${className}`}>
      {hasHeading && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {label && <p className="section-label">{label}</p>}
            {title && <h2 className="section-title">{title}</h2>}
            {description && <p className="page-subtitle">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
