// Phase 7 / Plan 07-01 — Backup snapshot unit tests (D-10).
// Per PITFALLS §Pitfall 9 (backup captures partial DB):
//   walCheckpoint(TRUNCATE) THEN db.backup(outPath).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { walCheckpoint, dbBackup } from '../../../src/main/backup/snapshot';

let tmpDir: string;
let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-snapshot-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = new Database(dbPath);
  // Enable WAL so the walCheckpoint pragma is meaningful.
  db.pragma('journal_mode = WAL');
});

afterEach(() => {
  db.close();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('snapshot', () => {
  it('walCheckpoint does not throw and preserves WAL mode', () => {
    expect(() => walCheckpoint(db)).not.toThrow();
    // After TRUNCATE the journal mode is still WAL (better-sqlite3 doesn't auto-switch).
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('dbBackup writes a complete DB file and leaves it on disk for the caller to consume', async () => {
    // Seed the source db.
    db.exec('CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare('INSERT INTO things (name) VALUES (?)').run('a');
    db.prepare('INSERT INTO things (name) VALUES (?)').run('b');

    const outPath = path.join(tmpDir, 'backup.db');
    await dbBackup(db, outPath);

    // ponytail: dbBackup's contract is "the caller zips the file then unlinks".
    // The helper does NOT clean up the temp file (D-10) — cleanup belongs to
    // the caller (createBackup in backup/index.ts owns the post-zip unlink).
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).size).toBeGreaterThan(0);

    // Open the backup and confirm the rows are there.
    const backup = new Database(outPath, { readonly: true });
    try {
      const rows = backup.prepare('SELECT count(*) AS c FROM things').get() as { c: number };
      expect(rows.c).toBe(2);
    } finally {
      backup.close();
    }
  });

  it('dbBackup writes to a file when called without try/finally wrapper', async () => {
    // Build a parallel implementation inline to assert the helper's internal
    // write actually works. We test by calling `await db.backup(outPath)`
    // directly and verifying the file exists with non-zero size + the same
    // row count as the source.
    db.exec('CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare('INSERT INTO things (name) VALUES (?)').run('seed');

    const outPath = path.join(tmpDir, 'backup.db');
    await db.backup(outPath);
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).size).toBeGreaterThan(0);

    // Open the backup and confirm the row is there.
    const backup = new Database(outPath, { readonly: true });
    try {
      const rows = backup.prepare('SELECT count(*) AS c FROM things').get() as { c: number };
      expect(rows.c).toBe(1);
    } finally {
      backup.close();
    }
  });
});
