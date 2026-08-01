// Test scaffolding: stubs electron.app.getPath + safeStorage so DB code runs
// under vitest without booting Electron. Each test gets its own tempdir that
// is cleaned up before + after.

import { afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let activeDir: string | null = null;

export function setupTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'colonosco-'));
  activeDir = dir;
  return dir;
}

export function teardownTempDataDir(): void {
  if (activeDir) {
    try {
      rmSync(activeDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    activeDir = null;
  }
}

export function currentTempDir(): string | null {
  return activeDir;
}

// Standard beforeEach/afterEach hooks for any test that opens the DB.
export function useTempDataDir(): { before: () => string; after: () => void } {
  return {
    before: () => setupTempDataDir(),
    after: () => teardownTempDataDir(),
  };
}

beforeEach(() => {
  // no-op; tests opt in via setupTempDataDir() in their own beforeEach.
});

afterEach(() => {
  teardownTempDataDir();
});