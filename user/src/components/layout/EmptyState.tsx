'use client';

// The zero-data state every list/table page needs. Same shape everywhere:
// tinted glyph, title, one line of guidance, a single primary action.
import React from 'react';

export default function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Usually one primary button. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`surface flex flex-col items-center p-12 text-center ${className}`}>
      {icon && (
        <span className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]">
          {icon}
        </span>
      )}
      <h2 className="section-title mb-2">{title}</h2>
      {description && <p className="page-subtitle mb-6">{description}</p>}
      {action}
    </div>
  );
}
