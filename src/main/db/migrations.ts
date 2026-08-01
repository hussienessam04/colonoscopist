// Versioned, append-only migration runner.
// Each migration runs inside db.transaction so a mid-migration failure rolls back.
// Per D-01 first-launch atomicity.

import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the migrations dir relative to this file.
// In the dev/test build electron-vite leaves migrations/ alongside this module;
// in the packaged build the directory is co-located via ASAR.
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_PATTERN = /^(\d{4})_(.+)\.sql$/;

type Migration = {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
};

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => FILE_PATTERN.test(f));
  files.sort();
  return files.map((f) => {
    const match = f.match(FILE_PATTERN)!;
    return {
      id: parseInt(match[1], 10),
      name: match[2],
      up: (db) => {
        const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
        db.exec(sql);
      },
    };
  });
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
      m.up(db);
      insertApplied.run(m.id, m.name, Date.now());
    });
    txn();
    appliedNow.push(m.id);
  }

  return { applied: appliedNow, skipped };
}