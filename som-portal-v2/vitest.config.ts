// som-portal-v2/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'html'],
      provider: 'v8',
    },
  },
  resolve: {
    alias: [
      // Order matters: more specific first.
      { find: /^@\/config\/(.*)$/, replacement: path.resolve(__dirname, './config/$1') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^#config\/(.*)$/, replacement: path.resolve(__dirname, './config/$1') },
    ],
  },
});
