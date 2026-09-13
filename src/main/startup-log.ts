import { app, safeStorage } from 'electron';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
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

// Quick task 20260913-5b0 — structured crash logger. The diagnostic page
// (`app:get-diagnostic`) reads back the same file so the clinic can ship
// us the log when something breaks. `context` is best-effort JSON-ish
// — Errors are stringified as `message + stack` (newlines escaped so
// each entry stays a single line); strings pass through; everything
// else falls through JSON.stringify and finally String().
export type LogLevel = 'info' | 'warn' | 'error';

export function logEvent(level: LogLevel, event: string, context?: Record<string, unknown>): void {
  const ctx = context
    ? ' | ' + Object.entries(context).map(([k, v]) => `${k}=${stringifyValue(v)}`).join(' | ')
    : '';
  const line = `[${new Date().toISOString()}] [${level}] ${event}${ctx}\n`;
  try {
    appendFileSync(logFile(), line, 'utf8');
  } catch {
    // Logging must never crash the app.
  }
}

export function readRecentLogLines(max = 200): string[] {
  try {
    const raw = readFileSync(logFile(), 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    return lines.slice(-max);
  } catch {
    return [];
  }
}

function stringifyValue(v: unknown): string {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`.replace(/\n/g, ' \\n ');
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
