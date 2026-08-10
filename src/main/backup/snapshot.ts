// Phase 7 / Plan 07-01 — Backup snapshot helpers (D-10).
//
// Per PITFALLS §Pitfall 9 (backup captures partial DB):
//   walCheckpoint(TRUNCATE) THEN db.backup(outPath) THEN zip the temp file.
// The WAL checkpoint guarantees the main DB file is fully coherent before
// `db.backup()` reads it. `db.backup(outPath)` is better-sqlite3's built-in
// SQLite Online Backup API — it writes a fully-formed DB without the WAL
// sidecar, so the zip can capture a single `app.db` file with no half-written
// pages.
//
// This module is pure JS — no electron import. Both helpers are exported
// so tests can use them on in-memory better-sqlite3 databases directly.

import type Database from 'better-sqlite3';

/**
 * Synchronous `PRAGMA wal_checkpoint(TRUNCATE)` against the open DB.
 * better-sqlite3 pragma calls are sync — no await needed. TRUNCATE mode
 * truncates the WAL file back to length 0 after the checkpoint so the
 * main DB file contains all committed pages. The renderer's `db` must
 * have been opened with `journal_mode = WAL` for this to be meaningful;
 * if WAL is off, the pragma is a no-op (which is also fine).
 */
export function walCheckpoint(db: Database.Database): void {
  // ponytail: better-sqlite3 returns a result object — we ignore it.
  // Throws only if the underlying WAL is corrupt; callers handle the throw.
  db.pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Copy the live DB to `outPath` via SQLite Online Backup API.
 * better-sqlite3 v11's `db.backup(path)` returns a promise; resolves when
 * the backup is complete. The file is LEFT ON DISK after this returns —
 * the caller (e.g. `createBackup` in backup/index.ts) consumes it
 * (zips it as `app.db`) and then cleans it up. Cleanup is the caller's
 * responsibility, NOT this helper's, because the cleanup-before-zip
 * ordering would otherwise delete the file while archiver is still
 * streaming it into the zip (PITFALLS §Pitfall 9 + D-10).
 */
export async function dbBackup(db: Database.Database, outPath: string): Promise<void> {
  await db.backup(outPath);
  // ponytail: caller-owned lifecycle. If the caller throws before
  // reading the file, the file lingers on disk — that's acceptable for
  // v1 because the destination is the same userData tree and the next
  // backup overwrites it. A safety-net unlink would silently delete
  // the file before the zipping caller could read it (Bug H-07-01).
}
