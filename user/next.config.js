/** @type {import('next').NextConfig} */

// Proxy /api/* to the backend so the browser only ever talks to THIS origin
// (www.kalpira.in). That keeps the session cookie first-party — no CORS, no
// third-party-cookie blocking. Override the target with API_PROXY_TARGET if the
// backend URL changes; falls back to the Render deployment.
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET || 'https://kalpira-backend.onrender.com').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    externalDir: true,
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` },
    ];
  },
}

module.exports = nextConfig
