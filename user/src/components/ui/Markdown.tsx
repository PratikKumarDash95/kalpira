'use client';

// Lazy markdown renderer — compatible with react-markdown v9.
//
// react-markdown v9 is a pure-ESM package. It ships as a named export `Markdown`
// (not a default export). The component expects `children` to be a *string*
// (the raw markdown source) and handles all parsing internally.
//
// Loading it on demand keeps it out of the initial JS bundle while the message
// text still appears immediately as plain text, so nothing looks missing while
// the chunk arrives.

import React, { useEffect, useState } from 'react';

// react-markdown v9 Options: children must be a string.
type RMOptions = {
  children: string;
  className?: string;
};

type MarkdownComp = (props: RMOptions) => React.ReactElement;

// Shared across every message: first render fetches the chunk, the rest reuse it.
let cachedComp: MarkdownComp | null = null;

type MarkdownProps = {
  children?: React.ReactNode;
  className?: string;
};

export function Markdown({ children, className }: MarkdownProps) {
  const [Comp, setComp] = useState<MarkdownComp | null>(cachedComp);

  useEffect(() => {
    if (cachedComp) return;
    let cancelled = false;

    // react-markdown v9 re-exports Markdown as the default from its index.
    // mod.default is the correct way to access it via dynamic import.
    import('react-markdown')
      .then(mod => {
        // The index.d.ts does: export { Markdown as default, ... }
        const comp = (mod.default ?? (mod as any).Markdown) as MarkdownComp;
        if (comp) {
          cachedComp = comp;
          if (!cancelled) setComp(() => comp);
        }
      })
      .catch(() => {
        // Chunk failed — plain-text fallback stays in place, still readable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // react-markdown v9 requires children to be a string; anything else falls back.
  if (!Comp || typeof children !== 'string' || !children.trim()) {
    return (
      <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {children ?? ''}
      </span>
    );
  }

  try {
    return <Comp className={className}>{children}</Comp>;
  } catch {
    return (
      <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {children}
      </span>
    );
  }
}

export default Markdown;
