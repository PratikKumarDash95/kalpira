// ============================================
// Shim for `next/headers` (cookies() / headers()).
// Reads from the active request and buffers writes into the request store;
// the adapter flushes buffered writes onto the Express response as Set-Cookie.
//
// The codebase mixes Next 14 (sync `cookies()`) and Next 15 (`await cookies()`)
// styles. Returning a PLAIN object satisfies both: sync callers use it directly,
// and `await <non-thenable>` simply resolves to the same object. (Do NOT make it
// a self-returning thenable — that causes infinite promise-assimilation and the
// await never settles.)
// ============================================

import { getStore } from './context';

interface CookieValue {
  name: string;
  value: string;
}

export interface CompatCookieStore {
  get(name: string): CookieValue | undefined;
  getAll(): CookieValue[];
  has(name: string): boolean;
  set(
    name: string | { name: string; value: string; [k: string]: unknown },
    value?: string,
    options?: Record<string, unknown>,
  ): void;
  delete(name: string): void;
}

export function cookies(): CompatCookieStore {
  const store = getStore();
  return {
    get(name: string) {
      if (!store.reqCookies.has(name)) return undefined;
      return { name, value: store.reqCookies.get(name)! };
    },
    getAll() {
      return [...store.reqCookies.entries()].map(([name, value]) => ({ name, value }));
    },
    has(name: string) {
      return store.reqCookies.has(name);
    },
    set(name, value, options) {
      if (typeof name === 'object') {
        const { name: n, value: v, ...opts } = name;
        store.setCookies.push({ name: n, value: v, options: opts });
        return;
      }
      store.setCookies.push({ name, value: value ?? '', options });
    },
    delete(name: string) {
      store.setCookies.push({ name, value: '', options: { maxAge: 0, path: '/' } });
    },
  };
}

export function headers(): Headers {
  const store = getStore();
  const h = new Headers();
  for (const [key, val] of Object.entries(store.reqHeaders)) {
    if (Array.isArray(val)) val.forEach((v) => h.append(key, v));
    else if (val != null) h.set(key, String(val));
  }
  return h;
}
