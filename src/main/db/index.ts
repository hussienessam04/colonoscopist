// DB singleton — opens app.db on first call, returns the same instance forever.
// Per D-01 + AUDIT-01 + PITFALLS §Pitfall 9 (WAL from day 1).

import Database from 'better-sqlite3';
import { dbPath } from '../paths';
import { runMigrations } from './migrations';
import { logStartup } from '../startup-log';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(dbPath());
  // Order matters: WAL first, then synchronous, then foreign_keys, then busy_timeout.
  // Per RESEARCH §02.1 + PITFALLS §Pitfall 9.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  logStartup('db-opened');

  const result = runMigrations(db);
  logStartup(`migrations-applied:${JSON.stringify({ applied: result.applied, skipped: result.skipped })}`);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}