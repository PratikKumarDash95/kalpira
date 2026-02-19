// ============================================
// Express Server — Entry Point
// ============================================

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { interviewRoutes, healthRoutes } = require('./routes');

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// ---- Middleware ----
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

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
