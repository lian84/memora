import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@memora/shared': path.resolve(import.meta.dirname, './packages/shared/src/index.ts'),
      '@memora/agent': path.resolve(import.meta.dirname, './packages/agent/src/index.ts'),
      '@memora/memory': path.resolve(import.meta.dirname, './packages/memory/src/index.ts'),
    },
  },
});
