// ============================================
// Express Server — Entry Point (TypeScript, run via tsx)
// Owns ALL backend logic: migrated Next API routes + AI interview routes.
// ============================================

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
// Existing hand-written AI routes (kept as-is).
const { interviewRoutes, healthRoutes } = require('./routes');
const { createRateLimiter } = require('./utils/rateLimiter');
import { mountApiRoutes } from './next-compat/route-loader';

const app = express();
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3001);

// ---- Middleware ----
// CORS: validate origin against allow-list. Known production frontends are
// ALWAYS allowed (baseline) so a stale/misconfigured CORS_ORIGIN env var on the
// host can't lock out the live apps; CORS_ORIGIN adds any extra origins on top.
import { getAllowedOrigins } from './app/lib/oauthOrigin';
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  refreshSessionToken,
  getSessionCookieOptions,
  IDLE_SESSION_SECONDS,
} from './app/lib/auth';

const allowedOrigins = getAllowedOrigins();
console.log('[Server] CORS allow-list:', allowedOrigins.join(', '));

app.use(cors({
  origin(origin, cb) {
    // Allow same-origin / curl (no Origin) and explicit allow-list matches.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Disallowed: respond WITHOUT CORS headers instead of throwing. Throwing
    // surfaces as a 500 with no Access-Control-Allow-Origin, which breaks
    // preflight and masks the real cause; cb(null, false) is the clean reject.
    console.warn(`[Server] CORS: origin not allowed: ${origin}`);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Rate-limit the AI endpoints (30 req/min per IP).
const aiLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
app.use('/api/interview/ask', aiLimiter);
app.use('/api/interview/evaluate', aiLimiter);
app.use('/api/ai', aiLimiter);

// Request logging (production: swap for morgan/pino)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ---- Sliding session refresh ----
// User sessions carry a fixed 5-day absolute cap and a 2-day idle window. On
// every request bearing a still-valid session, slide the idle window forward
// (re-issuing the cookie) so active users stay signed in up to the 5-day cap,
// while 2 days of inactivity lets the cookie/token lapse → auto sign-out.
// Throttled to once/hour so we don't re-sign a JWT on every single request.
// Note: route handlers that set their own session cookie (login/logout) run
// AFTER this and overwrite the Set-Cookie via the next-compat adapter, so their
// intent always wins.
const SESSION_REFRESH_THROTTLE_SECONDS = 60 * 60;
app.use(async (req, res, next) => {
  try {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      const token = match
        ? decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1))
        : null;

      if (token) {
        const session = await verifySessionToken(token);
        const nowSec = Math.floor(Date.now() / 1000);
        const dueForRefresh =
          !session.issuedAt || nowSec - session.issuedAt > SESSION_REFRESH_THROTTLE_SECONDS;

        if (session.valid && session.absoluteExp && dueForRefresh) {
          const refreshed = await refreshSessionToken(session);
          if (refreshed) {
            const opts = getSessionCookieOptions(IDLE_SESSION_SECONDS);
            res.cookie(SESSION_COOKIE_NAME, refreshed, {
              httpOnly: opts.httpOnly,
              secure: opts.secure,
              sameSite: opts.sameSite,
              path: opts.path,
              ...(opts.domain ? { domain: opts.domain } : {}),
              maxAge: opts.maxAge * 1000, // express expects milliseconds
            });
          }
        }
      }
    }
  } catch {
    // Session refresh must never break a request — fall through unauthenticated.
  }
  next();
});

// ---- Migrated Next.js API routes (auth, sessions, studies, admin, ...) ----
mountApiRoutes(app, path.join(__dirname, 'app', 'api'));

// ---- Existing hand-written AI routes ----
app.use('/api/interview', interviewRoutes);
app.use('/api/ai', healthRoutes);

// Root health ping
app.get('/api/ping', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ---- 404 Handler ----
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ---- Global Error Handler ----
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Kalpira Backend (consolidated)`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  CORS: ${allowedOrigins.join(', ')}`);
  console.log(`========================================\n`);
});

export default app;
