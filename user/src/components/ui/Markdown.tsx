'use client';

// Lightweight inline markdown renderer — no external dependencies, no eval().
//
// react-markdown pulls in `unified` + `micromark` which internally call
// `new Function(...)` / eval-like constructs. Vercel's default Content Security
// Policy blocks those, crashing the entire interview UI with:
//   "TypeError: Cannot read properties of undefined (reading 'rehypePlugins')"
//
// This renderer covers the subset of markdown actually produced by the AI
// interviewer (bold, italic, code spans, inline code, bullet lists, numbered
// lists, headings, blockquotes, line breaks). It is pure string → React JSX,
// with zero dynamic code execution, so CSP 'unsafe-eval' is never needed.

import React from 'react';

type MarkdownProps = {
  children?: React.ReactNode;
  className?: string;
};

// ─── Inline renderer ──────────────────────────────────────────────────────────
// Converts a single line of text containing inline markdown into React nodes.
function renderInline(text: string, key: string): React.ReactNode {
  // Patterns handled (in priority order):
  //   ***bold-italic***  **bold**  *italic*  `code`
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }

    if (match[2] !== undefined) {
      nodes.push(<strong key={`${key}-bi-${match.index}`}><em>{match[2]}</em></strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={`${key}-b-${match.index}`}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<em key={`${key}-i-${match.index}`}>{match[4]}</em>);
    } else if (match[5] !== undefined) {
      nodes.push(
        <code
          key={`${key}-c-${match.index}`}
          style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace', fontSize: '0.875em' }}
        >
          {match[5]}
        </code>
      );
    }

    last = match.index + match[0].length;
  }

  // Remaining plain text
  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes.length === 1 ? nodes[0] : <React.Fragment key={key}>{nodes}</React.Fragment>;
}

// ─── Block renderer ───────────────────────────────────────────────────────────
function renderBlocks(markdown: string): React.ReactNode[] {
  const lines = markdown.split('\n');
  const output: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line → spacer (handled by gap in list below)
    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading: # ## ###
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2], `h${i}`);
      const style: React.CSSProperties = {
        fontWeight: 700,
        marginTop: '0.5em',
        marginBottom: '0.25em',
        fontSize: level === 1 ? '1.25em' : level === 2 ? '1.1em' : '1em',
      };
      output.push(<div key={`h-${i}`} style={style}>{content}</div>);
      i++;
      continue;
    }

    // Blockquote: > ...
    if (line.startsWith('> ')) {
      const content = renderInline(line.slice(2), `bq${i}`);
      output.push(
        <div
          key={`bq-${i}`}
          style={{ borderLeft: '3px solid rgba(255,255,255,0.3)', paddingLeft: '0.75em', opacity: 0.8, marginBlock: '0.25em' }}
        >
          {content}
        </div>
      );
      i++;
      continue;
    }

    // Bullet list: starts with - or * or +
    if (/^[-*+]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(
          <li key={i} style={{ paddingLeft: '0.25em' }}>
            {renderInline(lines[i].replace(/^[-*+]\s/, ''), `li${i}`)}
          </li>
        );
        i++;
      }
      output.push(
        <ul key={`ul-${i}`} style={{ paddingLeft: '1.25em', listStyleType: 'disc', marginBlock: '0.25em' }}>
          {items}
        </ul>
      );
      continue;
    }

    // Numbered list: 1. 2. etc.
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(
          <li key={i} style={{ paddingLeft: '0.25em' }}>
            {renderInline(lines[i].replace(/^\d+\.\s/, ''), `oli${i}`)}
          </li>
        );
        i++;
      }
      output.push(
        <ol key={`ol-${i}`} style={{ paddingLeft: '1.25em', listStyleType: 'decimal', marginBlock: '0.25em' }}>
          {items}
        </ol>
      );
      continue;
    }

    // Horizontal rule: --- or ***
    if (/^[-*]{3,}$/.test(line.trim())) {
      output.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.2)', marginBlock: '0.5em' }} />);
      i++;
      continue;
    }

    // Plain paragraph
    output.push(
      <p key={`p-${i}`} style={{ marginBlock: '0.2em' }}>
        {renderInline(line, `p${i}`)}
      </p>
    );
    i++;
  }

  return output;
}

// ─── Public component ─────────────────────────────────────────────────────────
export function Markdown({ children, className }: MarkdownProps) {
  if (typeof children !== 'string' || !children.trim()) {
    return (
      <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {children ?? ''}
      </span>
    );
  }

  const blocks = renderBlocks(children);

  return (
    <div className={className} style={{ lineHeight: 1.6 }}>
      {blocks}
    </div>
  );
}

export default Markdown;
