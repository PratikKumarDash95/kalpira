'use client';

// Lazy markdown renderer.
//
// react-markdown and its parser are among the larger dependencies in the
// interview bundle, and they are only needed once a message is actually on
// screen. Loading it on demand keeps it out of the initial JS of the interview
// routes — the app's heaviest — while the message text itself still appears
// immediately as plain text, so nothing looks missing while the chunk arrives.

import React, { useEffect, useState } from 'react';

type MarkdownProps = {
  children?: React.ReactNode;
  className?: string;
};

type Renderer = React.ComponentType<MarkdownProps>;

// Shared across every message: the first one to render fetches the chunk, the
// rest reuse it, and a remount after navigation skips the wait entirely.
let cachedRenderer: Renderer | null = null;

export function Markdown({ children, className }: MarkdownProps) {
  const [Renderer, setRenderer] = useState<Renderer | null>(cachedRenderer);

  useEffect(() => {
    if (cachedRenderer) return;
    let cancelled = false;

    import('react-markdown')
      .then(mod => {
        cachedRenderer = mod.default as unknown as Renderer;
        if (!cancelled) setRenderer(() => cachedRenderer);
      })
      .catch(() => {
        // Chunk failed to load — the plain-text fallback stays in place, which is
        // still perfectly readable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Renderer) {
    // Plain text, keeping the line breaks markdown would have produced.
    return (
      <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {children}
      </span>
    );
  }

  return <Renderer className={className}>{children}</Renderer>;
}

export default Markdown;
