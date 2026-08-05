// Versioned, append-only migration runner.
// Each migration runs inside db.transaction so a mid-migration failure rolls back.
// Per D-01 first-launch atomicity.

import type Database from 'better-sqlite3';
import initSql from './migrations/0001_init.sql?raw';
import proceduresSql from './migrations/0002_procedures.sql?raw';

type Migration = {
  id: number;
  name: string;
  up: string;
};

// SQL is embedded by Vite's ?raw import — no filesystem read at runtime.
const MIGRATIONS: Migration[] = [
  { id: 1, name: 'init', up: initSql },
  { id: 2, name: 'procedures', up: proceduresSql },
];

function loadMigrations(): typeof MIGRATIONS {
  return MIGRATIONS;
}

export function runMigrations(db: Database.Database): { applied: number[]; skipped: number[] } {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );

  const migrations = loadMigrations();
  const appliedRows = db.prepare('SELECT id FROM _migrations').all() as { id: number }[];
  const applied = new Set(appliedRows.map((r) => r.id));
  const insertApplied = db.prepare(
    'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  const appliedNow: number[] = [];
  const skipped: number[] = [];

  for (const m of migrations) {
    if (applied.has(m.id)) {
      skipped.push(m.id);
      continue;
    }
    const txn = db.transaction(() => {
      db.exec(m.up);
      insertApplied.run(m.id, m.name, Date.now());
    });
    txn();
    appliedNow.push(m.id);
  }

  return { applied: appliedNow, skipped };
}