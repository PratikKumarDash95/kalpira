// ============================================
// Adapter: run a Next.js App-Router route handler inside Express.
// Express (req,res) -> Web Request -> handler -> Web Response -> Express.
// ============================================

import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { requestContext, parseCookieHeader, type RequestStore, type CookieSetItem } from './context';

type RouteHandler = (request: Request, context: { params: Record<string, string> }) => Response | Promise<Response>;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function serializeCookie(item: CookieSetItem): string {
  const { name, value, options = {} } = item;
  const o = options as Record<string, any>;
  let str = `${name}=${encodeURIComponent(value)}`;
  str += `; Path=${o.path ?? '/'}`;
  if (o.maxAge != null) str += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.expires) str += `; Expires=${new Date(o.expires).toUTCString()}`;
  if (o.domain) str += `; Domain=${o.domain}`;
  if (o.httpOnly) str += `; HttpOnly`;
  if (o.secure) str += `; Secure`;
  if (o.sameSite) str += `; SameSite=${cap(String(o.sameSite))}`;
  return str;
}

function toWebRequest(req: ExpressRequest): Request {
  const host = req.headers.host ?? 'localhost';
  const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const url = `${protocol}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (Array.isArray(val)) val.forEach((v) => headers.append(key, v));
    else if (val != null) headers.set(key, String(val));
  }

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      init.body = req.body as any;
    } else {
      init.body = JSON.stringify(req.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  return new Request(url, init);
}

export function adapt(handler: RouteHandler) {
  return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const store: RequestStore = {
      reqCookies: parseCookieHeader(req.headers.cookie),
      reqHeaders: req.headers,
      setCookies: [],
    };

    try {
      const webReq = toWebRequest(req);
      const response = await requestContext.run(store, () =>
        Promise.resolve(handler(webReq, { params: (req.params ?? {}) as Record<string, string> }))
      );

      if (!response) {
        res.status(500).json({ error: 'Handler returned no response.' });
        return;
      }

      res.status(response.status);

      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        res.setHeader(key, value);
      });

      const responseSetCookies =
        typeof (response.headers as any).getSetCookie === 'function'
          ? (response.headers as any).getSetCookie()
          : [];
      const cookieStrings = [
        ...responseSetCookies,
        ...store.setCookies.map(serializeCookie),
      ];
      if (cookieStrings.length) res.setHeader('Set-Cookie', cookieStrings);

      const body = Buffer.from(await response.arrayBuffer());
      res.send(body);
    } catch (err) {
      console.error('[next-compat/adapt] handler error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
    }
  };
}
