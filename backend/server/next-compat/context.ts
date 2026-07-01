// ============================================
// Request-scoped context for the Next.js compat layer.
// Lets the cookies()/headers() shims reach the active request without
// threading them through every handler signature.
// ============================================

import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingHttpHeaders } from 'http';

export interface CookieSetItem {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export interface RequestStore {
  reqCookies: Map<string, string>;
  reqHeaders: IncomingHttpHeaders;
  setCookies: CookieSetItem[];
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getStore(): RequestStore {
  const store = requestContext.getStore();
  if (!store) {
    throw new Error('[next-compat] cookies()/headers() called outside of a request context');
  }
  return store;
}

export function parseCookieHeader(header?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) map.set(name, decodeURIComponent(value));
  }
  return map;
}
