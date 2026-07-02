const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    externalDir: true,
  },
  env: {
    NEXT_PUBLIC_PORTAL: 'interviewer',
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'framer-motion': require.resolve('framer-motion'),
      jszip: require.resolve('jszip'),
    };

    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '..', 'node_modules'),
      ...(config.resolve.modules || []),
    ];

    return config;
  },
};

module.exports = nextConfig;
