// ============================================
// Auto-mount Next.js App-Router route files onto an Express app.
// Scans server/app/api/** for route.ts files, converts the folder path to an
// Express path ([id] -> :id, [...slug] -> *), and mounts each exported
// HTTP method (GET/POST/PUT/PATCH/DELETE) through the adapter.
// ============================================

import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { adapt } from './adapt';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/^route\.(ts|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toExpressPath(routeFile: string, apiRoot: string): string {
  const rel = path.relative(apiRoot, path.dirname(routeFile));
  const segments = rel.split(path.sep).filter(Boolean).map((seg) => {
    if (seg.startsWith('[...') && seg.endsWith(']')) return '*';
    if (seg.startsWith('[') && seg.endsWith(']')) return ':' + seg.slice(1, -1);
    return seg;
  });
  return '/api' + (segments.length ? '/' + segments.join('/') : '');
}

export function mountApiRoutes(app: Express, apiRoot: string): void {
  const files = walk(apiRoot).sort();
  let mounted = 0;

  for (const file of files) {
    const expressPath = toExpressPath(file, apiRoot);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file);

    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler !== 'function') continue;
      const verb = method.toLowerCase() as Lowercase<Method>;
      (app as any)[verb](expressPath, adapt(handler));
      mounted++;
      console.log(`  [api] ${method.padEnd(6)} ${expressPath}`);
    }
  }

  console.log(`[next-compat] mounted ${mounted} route handler(s) from ${path.relative(process.cwd(), apiRoot)}`);
}
