// som-portal-v2/next.config.ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  basePath: '/v2',
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/data/:path*',
        destination: 'http://localhost/data/:path*',
      },
    ];
  },
};

export default config;
