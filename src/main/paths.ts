// Centralised userData path resolution (SET-03 foundation).
// Phase 2 will add dbPath() and mediaDir() helpers that build on this.

import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}