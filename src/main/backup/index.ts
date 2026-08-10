// Phase 7 / Plan 07-01 — Create backup zip (D-09 + D-10 + D-11).
//
// Flow (per D-10 + PITFALLS §Pitfall 9):
//   1. walCheckpoint(db)                  — checkpoint the WAL into main DB
//   2. dbBackup(db, tempDbPath)           — full SQLite Online Backup to temp
//   3. archiver streams: tempDbPath as app.db + media/ + profiles/ + reports/
//   4. on 'close' event: resolve + unlink tempDbPath
//
// We use archiver (NOT in-memory zip libraries like adm-zip) — clinic-scale
// media can exceed the main process heap; archiver streams the zip entry-by-
// entry instead of buffering the whole archive in memory.

import { ZipArchive } from 'archiver';
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { unlink } from 'node:fs/promises';

import { getDb } from '../db';
import { mediaDir, profilesDir, reportsDir } from '../paths';
import { walCheckpoint, dbBackup } from './snapshot';

/**
 * Create a backup zip at `destZipPath`. Returns the path + on-disk size +
 * procedure count for the IPC handler to surface to the renderer + audit
 * row. The active `data/` directory is read but NEVER modified — backup is
 * purely additive.
 */
export async function createBackup(opts: {
  destZipPath: string;
}): Promise<{ path: string; sizeBytes: number; procedureCount: number }> {
  const db = getDb();

  // Per D-10 step 1 — checkpoint the WAL so the main DB file is coherent.
  walCheckpoint(db);

  // Per D-10 step 2 — copy the live DB to a temp file via SQLite Online
  // Backup API. The temp file lives next to the destination zip (NOT inside
  // the source data folder) so the source folder is never modified.
  const tempDbPath = `${opts.destZipPath}.db.tmp`;

  // Per D-10 step 3 — stream the zip.
  const output = createWriteStream(opts.destZipPath);
  // ponytail: archiver v8 is pure ESM — `ZipArchive` is the named export.
  // It extends `Archiver` and pre-binds the zip plugin + directory/symlink
  // support. Construction wires up the internal module pipe.
  const archive = new ZipArchive({ zlib: { level: 6 } });

  // ponytail: capture errors so we can reject + clean up the temp file.
  // archiver emits 'error' on the archive instance AND on its source streams.
  const closed = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', (err: Error) => reject(err));
    archive.on('error', (err: Error) => reject(err));
    archive.on('warning', (err: Error) => {
      // ponytail: archiver's 'warning' fires on statless entries (symlinks etc).
      // We treat it as non-fatal but log so the doctor can see if anything
      // odd happened during the backup.
      // eslint-disable-next-line no-console
      console.warn('[backup] archiver warning:', err.message);
    });
  });

  archive.pipe(output);

  // Per D-10 — zip the temp db as the canonical `app.db` entry. After the
  // stream closes we unlink the temp file (cleaned up by dbBackup's `finally`
  // already, but belt-and-suspenders).
  archive.file(tempDbPath, { name: 'app.db' });

  // Per D-09 — media/ + profiles/ + reports/ subtrees stream as directories.
  archive.directory(mediaDir(), 'media');
  archive.directory(profilesDir(), 'profiles');
  archive.directory(reportsDir(), 'reports');

  try {
    await dbBackup(db, tempDbPath);
    void archive.finalize();
    await closed;
  } catch (err) {
    // Cleanup on failure — half-written zip + temp db must NOT linger.
    try {
      await unlink(tempDbPath).catch(() => {});
    } catch {
      // best effort
    }
    try {
      await unlink(opts.destZipPath).catch(() => {});
    } catch {
      // best effort
    }
    throw err;
  }

  // Cleanup the temp db file after a successful zip.
  if (existsSync(tempDbPath)) {
    try {
      unlinkSync(tempDbPath);
    } catch {
      // best effort
    }
  }

  const sizeBytes = statSync(opts.destZipPath).size;
  // Procedure count is read from the LIVE db (snapshot already deleted).
  const procedureCount = (
    getDb().prepare('SELECT COUNT(*) AS c FROM procedures').get() as { c: number }
  ).c;

  return {
    path: opts.destZipPath,
    sizeBytes,
    procedureCount,
  };
}

/**
 * Reveal the backup zip in the OS file manager (Explorer / Finder / Nautilus).
 * Wraps `shell.showItemInFolder(path)` with a guard so unit tests that
 * exercise this function without a real Electron `shell` module don't crash.
 */
export function revealBackup(absPath: string): void {
  // Lazy import so tests that mock `electron` don't have to provide `shell`.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require('electron') as { shell?: { showItemInFolder(p: string): void } };
    if (shell && typeof shell.showItemInFolder === 'function') {
      shell.showItemInFolder(absPath);
      return;
    }
  } catch {
    // electron not available (test environment); fall through
  }
  // ponytail: best-effort reveal — fallback to a console message so the
  // caller's test can assert the function didn't throw.
  // eslint-disable-next-line no-console
  console.info(`[backup] reveal requested for: ${absPath}`);
}
