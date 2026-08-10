// Phase 7 / Plan 07-01 — Restore zip → staging directory (D-13..D-16).
//
// Flow (per D-13..D-16 + D-15 path-traversal defense-in-depth):
//   1. yauzl.open(zipPath, { lazyEntries: true }) — stream entries
//   2. for each entry: safeEntryPath(entry, stagingDir)
//      - reject if absolute path
//      - reject if '..' segment
//      - reject if resolved path is outside stagingDir
//   3. unpack to stagingDir (mkdir recursive for directories)
//   4. integrityCheck(stagingDir) opens the staged db (separate connection)
//      and runs `PRAGMA integrity_check`. Returns the result string verbatim
//      ('ok' on pass, error string on fail).
//
// Per D-14 — staging is a sibling of the active data/ directory; the active
// folder is NEVER touched by this module.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import yauzl from 'yauzl';
import path from 'node:path';

/**
 * Per D-15 — defense-in-depth against zip-slip. Mirrors Phase 5 P04's
 * ALLOWED_SUBDIRS pattern but applies to the unpack target. Returns the
 * safe absolute path on accept, or `null` if the entry should be skipped.
 *
 * Steps:
 *   1. Normalize backslashes to forward slashes (zip spec).
 *   2. Reject if absolute (`/etc/passwd`, `C:\foo`, etc).
 *   3. Reject if any segment is `..`.
 *   4. Reject if `path.resolve(stagingDir, normalized)` is outside
 *      `path.resolve(stagingDir)` (catches symlink-like escapes).
 */
export function safeEntryPath(entry: yauzl.Entry, stagingDir: string): string | null {
  const normalized = entry.fileName.replace(/\\/g, '/');
  // ponytail: path.isAbsolute on POSIX detects leading '/'; on Windows it
  // also detects drive letters. Either case is an unsafe entry.
  if (path.isAbsolute(normalized)) return null;
  if (normalized.includes('..')) return null;
  const stagingResolved = path.resolve(stagingDir);
  const targetResolved = path.resolve(stagingResolved, normalized);
  // Use path.relative for the containment check — handles trailing separators
  // and Windows case-insensitive paths uniformly.
  const rel = path.relative(stagingResolved, targetResolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return targetResolved;
}

/**
 * Unpack the backup zip at `zipPath` into `stagingDir`. Returns the file
 * count + staging directory path. The active `data/` directory is NEVER
 * touched.
 *
 * Per D-15 — every entry is filtered through `safeEntryPath` BEFORE any
 * filesystem write. Unsafe entries are silently skipped (not thrown) so
 * a single malicious entry can't block the entire restore.
 */
export function unpackRestore(opts: {
  zipPath: string;
  stagingDir: string;
}): Promise<{ fileCount: number; stagingDir: string }> {
  return new Promise((resolve, reject) => {
    yauzl.open(opts.zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('yauzl.open returned null zip'));
        return;
      }
      let fileCount = 0;

      // Pre-create the staging dir so the first safe entry can write into it.
      mkdirSync(opts.stagingDir, { recursive: true });

      zip.on('error', (zipErr: Error) => reject(zipErr));
      zip.on('end', () => {
        resolve({ fileCount, stagingDir: opts.stagingDir });
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        const safe = safeEntryPath(entry, opts.stagingDir);
        if (safe === null) {
          // ponytail: skip unsafe entries silently. resolve(null) means
          // "don't write this file, move to the next entry".
          zip.readEntry();
          return;
        }
        if (/\/$/.test(entry.fileName)) {
          // Directory entry — mkdir recursive and continue.
          mkdirSync(safe, { recursive: true });
          zip.readEntry();
          return;
        }
        // Ensure parent directory exists.
        mkdirSync(path.dirname(safe), { recursive: true });

        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zip.close();
            reject(streamErr ?? new Error('yauzl.openReadStream returned null'));
            return;
          }
          // Stream into a Buffer (writeFileSync below). yauzl streams are
          // Node ReadStreams; buffer the bytes then write synchronously.
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => {
            try {
              writeFileSync(safe, Buffer.concat(chunks));
              fileCount += 1;
              zip.readEntry();
            } catch (writeErr) {
              zip.close();
              reject(writeErr as Error);
            }
          });
          readStream.on('error', (rsErr: Error) => {
            zip.close();
            reject(rsErr);
          });
        });
      });

      zip.readEntry();
    });
  });
}

/**
 * Per D-16 — open the staged db (NEW connection; do NOT use the main
 * getDb() handle) and run `PRAGMA integrity_check`. Returns the result
 * string verbatim ('ok' on pass, error description on fail).
 */
export function integrityCheck(stagingDir: string): string {
  const dbPath = path.join(stagingDir, 'app.db');
  if (!existsSync(dbPath)) {
    return 'staged app.db not found';
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    return row?.integrity_check ?? 'integrity_check returned no row';
  } catch (err) {
    return (err as Error).message;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Per D-13 step 2 — preview the contents of a backup zip BEFORE unpacking.
 * Sums uncompressed size from the zip's central directory, then counts
 * procedures in the staged DB after a throwaway unpack.
 *
 * For simplicity (and to avoid double-unpacking the whole zip), this
 * implementation:
 *   1. Parses zip entries via yauzl.open + readEntry (counts entries +
 *      accumulates uncompressed size)
 *   2. Unpacks to `stagingDir` (the IPC handler passes a unique timestamped
 *      staging dir per preview call)
 *   3. Runs integrityCheck on the staged DB
 *   4. Reads the procedure count from the staged DB
 *   5. Returns the preview shape
 *
 * The caller (IPC handler) decides whether to keep or discard the staging
 * dir; we do NOT delete it here.
 */
export async function previewRestore(opts: {
  zipPath: string;
  stagingDir: string;
}): Promise<{
  filename: string;
  totalSize: number;
  dbIntegrityCheck: string;
  procedureCount: number;
}> {
  // ponytail: yauzl doesn't expose total size via the streaming API, so we
  // walk entries and sum `uncompressedSize` first, then unpack.
  const totalSize = await new Promise<number>((resolve, reject) => {
    yauzl.open(opts.zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('yauzl.open returned null zip'));
        return;
      }
      let total = 0;
      zip.on('error', (e: Error) => reject(e));
      zip.on('end', () => resolve(total));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!/\/$/.test(entry.fileName)) {
          total += entry.uncompressedSize;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
  });

  // Unpack so we can inspect the DB.
  const { stagingDir } = await unpackRestore(opts);

  // Integrity check + procedure count.
  const dbIntegrityCheck = integrityCheck(stagingDir);

  // Procedure count from the staged DB (separate connection so the main
  // db handle is untouched).
  let procedureCount = 0;
  const stagedDbPath = path.join(stagingDir, 'app.db');
  if (existsSync(stagedDbPath)) {
    let stagedDb: Database.Database | null = null;
    try {
      stagedDb = new Database(stagedDbPath, { readonly: true, fileMustExist: true });
      const row = stagedDb
        .prepare('SELECT COUNT(*) AS c FROM procedures')
        .get() as { c: number };
      procedureCount = row.c;
    } catch {
      // ignore — preview should still return even if the DB is partially corrupt.
    } finally {
      if (stagedDb) {
        try {
          stagedDb.close();
        } catch {
          // best effort
        }
      }
    }
  }

  // ponytail: preview does NOT touch the live db — we only inspect the
  // staged copy. The renderer's "this will replace N procedures"
  // affordance reads the live count separately via the procedures IPC.
  return {
    filename: path.basename(opts.zipPath),
    totalSize,
    dbIntegrityCheck,
    procedureCount,
  };
}
