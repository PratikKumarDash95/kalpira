/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  experimental: {
    externalDir: true,
  },
  env: {
    NEXT_PUBLIC_PORTAL: 'interviewer',
  },
};

module.exports = nextConfig;
