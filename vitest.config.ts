import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const rendererAlias = {
  '@': path.resolve(__dirname, 'src/renderer/src'),
  '@shared': path.resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: rendererAlias,
  },
  test: {
    include: [
      'tests/main/**/*.test.ts',
      'tests/renderer/**/*.test.{ts,tsx}',
      'tests/shell/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/security/**/*.test.ts',
    ],
    environment: 'node',
    // Renderer tests opt into happy-dom via the per-file directive `// @vitest-environment happy-dom`.
    environmentMatchGlobs: [
      ['tests/renderer/**', 'happy-dom'],
    ],
    globals: false,
    testTimeout: 30_000,
  },
});
