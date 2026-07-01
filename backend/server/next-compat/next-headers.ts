// ============================================
// Shim for `next/headers` (cookies() / headers()).
// Reads from the active request and buffers writes into the request store;
// the adapter flushes buffered writes onto the Express response as Set-Cookie.
// cookies() is async to match Next 15's awaited API.
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
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
}

export async function cookies(): Promise<CompatCookieStore> {
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
    set(name: string | { name: string; value: string; [k: string]: unknown }, value?: string, options?: Record<string, unknown>) {
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

export async function headers(): Promise<Headers> {
  const store = getStore();
  const h = new Headers();
  for (const [key, val] of Object.entries(store.reqHeaders)) {
    if (Array.isArray(val)) val.forEach((v) => h.append(key, v));
    else if (val != null) h.set(key, String(val));
  }
  return h;
}
