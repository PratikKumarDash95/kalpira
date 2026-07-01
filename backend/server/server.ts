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
// CORS: validate origin against allow-list (comma-separated env var). Include
// all three frontend origins so cookies flow across the static apps.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
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
