// Screenshots repository. Per D-04 + D-05 — captures of the preview /
// playback frame, persisted at
// <userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<tsMs>.jpg
// and indexed by `timestamp_in_video` for the timeline query.
//
// `file_path` is stored RELATIVE to userData (Anti-Pattern 2). Resolution to
// an absolute path happens at the read site via
//   path.join(app.getPath('userData'), row.file_path)
// so the row never depends on a specific machine's userData root.
//
// FK errors (procedure_id with no matching row) are translated to
// IPC_NOT_FOUND so the IPC handler can surface them as a 404.

import type Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { getDb } from './index';
import { IpcErrorException, ipcError } from '@shared/errors';
import type { Screenshot } from '@shared/ipc-contract';

type ScreenshotRow = {
  id: number;
  procedure_id: string;
  timestamp_in_video: number;
  file_path: string;
  annotation: string | null;
  created_at: number;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  get: Stmt;
  listByProcedure: Stmt;
  delete: Stmt;
  updateAnnotation: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO screenshots (procedure_id, timestamp_in_video, file_path, annotation, created_at)
       VALUES (@procedure_id, @timestamp_in_video, @file_path, @annotation, @created_at)`,
    ),
    get: db.prepare(`SELECT * FROM screenshots WHERE id = ?`),
    listByProcedure: db.prepare(
      `SELECT * FROM screenshots WHERE procedure_id = ? ORDER BY timestamp_in_video ASC`,
    ),
    delete: db.prepare(`DELETE FROM screenshots WHERE id = ?`),
    updateAnnotation: db.prepare(
      `UPDATE screenshots SET annotation = ? WHERE id = ?`,
    ),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements
// must be dropped on teardown.
export function __resetScreenshotsRepoCache(): void {
  cached = null;
}

function rowToScreenshot(row: ScreenshotRow): Screenshot {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    timestampInVideoMs: row.timestamp_in_video,
    filePath: row.file_path,
    annotation: row.annotation,
    createdAt: row.created_at,
  };
}

export type ScreenshotAddInput = {
  procedureId: string;
  timestampInVideoMs: number;
  filePath: string;
  createdAt: number;
  annotation?: string | null;
};

export const screenshotsRepo = {
  add(input: ScreenshotAddInput): Screenshot {
    let info: Database.RunResult;
    try {
      info = stmts().insert.run({
        procedure_id: input.procedureId,
        timestamp_in_video: input.timestampInVideoMs,
        file_path: input.filePath,
        annotation: input.annotation ?? null,
        created_at: input.createdAt,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ) {
        throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Procedure not found'));
      }
      throw err;
    }
    const row = stmts().get.get(Number(info.lastInsertRowid)) as ScreenshotRow;
    return rowToScreenshot(row);
  },

  get(id: number): Screenshot | undefined {
    const row = stmts().get.get(id) as ScreenshotRow | undefined;
    return row ? rowToScreenshot(row) : undefined;
  },

  listByProcedure(procedureId: string): Screenshot[] {
    return (stmts().listByProcedure.all(procedureId) as ScreenshotRow[]).map(rowToScreenshot);
  },

  // Per D-05 — hard delete + file unlink. `removeFile` defaults to true;
  // tests and the IPC handler always pass true (the file is owned by the
  // screenshot row). Synchronous to fit inside db.transaction() — better-sqlite3
  // requires sync stmts; small JPEGs unlink in microseconds.
  // Throws IPC_NOT_FOUND if the row doesn't exist (defensive — protects
  // against double-delete races after toast-undo is wired in Plan 02).
  delete(id: number, opts: { removeFile?: boolean } = {}): void {
    const removeFile = opts.removeFile ?? true;
    const row = stmts().get.get(id) as ScreenshotRow | undefined;
    if (!row) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', `Screenshot ${id} not found`));
    }
    stmts().delete.run(id);
    if (removeFile) {
      const abs = path.join(app.getPath('userData'), row.file_path);
      // ponytail: file may not exist if a previous delete crashed
      // mid-unlink — ENOENT is success not failure.
      if (existsSync(abs)) {
        try {
          unlinkSync(abs);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }
    }
  },

  updateAnnotation(id: number, annotation: string | null): Screenshot {
    let info: Database.RunResult;
    try {
      info = stmts().updateAnnotation.run(annotation, id);
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_CHECK'
      ) {
        throw new IpcErrorException(
          ipcError('IPC_VALIDATION', 'Annotation must be 1..1000 characters', {
            field: 'annotation',
          }),
        );
      }
      throw err;
    }
    if (info.changes === 0) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', `Screenshot ${id} not found`));
    }
    const row = stmts().get.get(id) as ScreenshotRow;
    return rowToScreenshot(row);
  },
};
