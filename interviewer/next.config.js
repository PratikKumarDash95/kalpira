/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
  env: {
    NEXT_PUBLIC_PORTAL: 'interviewer',
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_USER_APP_URL || 'http://localhost:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
