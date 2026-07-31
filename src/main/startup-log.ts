import { app, safeStorage } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let cachedBetterSqliteVersion: string | null = null;

function betterSqliteVersion(): string {
  if (cachedBetterSqliteVersion === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedBetterSqliteVersion = require('better-sqlite3/package.json').version as string;
  }
  return cachedBetterSqliteVersion;
}

function logFile(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'startup.log');
}

export function logStartup(event: string): void {
  const line = `[${new Date().toISOString()}] ${event} better-sqlite3=${betterSqliteVersion()}\n`;
  try {
    appendFileSync(logFile(), line, 'utf8');
  } catch {
    // Logging must never crash startup.
  }

  if (event === 'app-ready') {
    console.log(`[boot] better-sqlite3 binding version: ${betterSqliteVersion()}`);
    console.log(`[boot] safeStorage encryption available: ${safeStorage.isEncryptionAvailable()}`);
  }
}
