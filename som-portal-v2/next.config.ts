// som-portal-v2/next.config.ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  basePath: '/v2',
  // Node-only mail packages stay out of the bundle and load from node_modules at runtime.
  serverExternalPackages: ['imapflow', 'mailparser'],
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
