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

// Express matches in registration order, so a dynamic segment registered first
// swallows every literal sibling underneath it. Sorting the files as paths put
// `[id]` before `export` — '[' is 0x5B, 'e' is 0x65 — which made
// GET /api/interviews/export unreachable: `/api/interviews/:id` matched it with
// id="export" and answered "Interview not found" for every CSV download. Next.js
// itself resolves static before dynamic; the mount order now does too.
function segmentRank(segment: string): number {
  return segment.startsWith(':') || segment === '*' || segment === '' ? 1 : 0;
}

function compareRoutes(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;

    // Literals first; only then compare the segments themselves.
    const rank = segmentRank(x) - segmentRank(y);
    if (rank !== 0) return rank;
    if (x !== y) return x < y ? -1 : 1;
  }

  return 0;
}

export function mountApiRoutes(app: Express, apiRoot: string): void {
  const routes = walk(apiRoot)
    .map((file) => ({ file, expressPath: toExpressPath(file, apiRoot) }))
    .sort((a, b) => compareRoutes(a.expressPath, b.expressPath));

  let mounted = 0;

  for (const { file, expressPath } of routes) {
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
