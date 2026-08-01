// Centralised userData path resolution (SET-03 foundation).
// Phase 2 adds dbPath() + mediaDir() for the data layer + Phase 4 video storage.

import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), 'app.db');
}

export function mediaDir(): string {
  const dir = path.join(dataDir(), 'media');
  mkdirSync(dir, { recursive: true });
  return dir;
}