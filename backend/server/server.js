// ============================================
// Express Server — Entry Point
// ============================================

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { interviewRoutes, healthRoutes } = require('./routes');
const { createRateLimiter } = require('./utils/rateLimiter');

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// ---- Middleware ----
// CORS: validate origin against allow-list (comma-separated env var)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Allow same-origin / curl (no origin) and explicit allow-list matches
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '64kb' }));

// Rate-limit the AI endpoints (30 req/min per IP). Tune per deployment.
const aiLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
app.use('/api/interview', aiLimiter);
app.use('/api/ai', aiLimiter);

// Request logging (production: swap for morgan/pino)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ---- Routes ----
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
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  OpenInterviewer Backend`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`========================================\n`);
});

module.exports = app;
