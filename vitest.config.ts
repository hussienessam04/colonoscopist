import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['tests/main/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
  },
});