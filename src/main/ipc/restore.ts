// Phase 7 / Plan 07-01 — Restore IPC handlers (SET-06).
//
// RESTORE_PREVIEW: reads the zip's central directory, sums uncompressed
// sizes, then unpacks into a staging dir (sibling of the active data/
// directory per D-14) + runs PRAGMA integrity_check on the staged DB.
// Returns the preview shape (filename + totalSize + dbIntegrityCheck
// string + procedureCount). The active data/ folder is NEVER touched.
//
// RESTORE_UNPACK: streams the zip into the staging dir, file count
// returned. Same path-traversal defense-in-depth (safeEntryPath).
//
// On any throw, emits a `restore.failed` audit row and re-throws so the
// renderer can surface the failure.
//
// Per Phase 2 BLOCKER 4, no payload includes a `userId` field — main
// derives it from `requireSession()` for the audit row.

import { ipcMain } from 'electron';
import path from 'node:path';
import { z } from 'zod';

import { IPC } from '@shared/ipc-contract';
import {
  restorePreviewInput,
  restoreUnpackInput,
} from '@shared/validators';
import { IpcErrorException, ipcError } from '@shared/errors';

import { previewRestore, unpackRestore } from '../backup/restore';
import { audit } from '../db/audit';
import { session } from '../auth/session';

function fromZodError(err: z.ZodError, fallbackField?: string): IpcErrorException {
  const issue = err.issues[0];
  const field = (issue?.path[0] as string | undefined) ?? fallbackField;
  return new IpcErrorException(
    ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
  );
}

function safeParse<T>(schema: z.ZodType<T>, raw: unknown, fallbackField?: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) throw fromZodError(err, fallbackField);
    throw err;
  }
}

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_AUTH_REQUIRED', 'Not authenticated'));
  }
  return id;
}

function asIpcError(err: unknown): Error {
  if (err instanceof z.ZodError) return asIpcError(fromZodError(err));
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export function registerRestoreIpc(): void {
  ipcMain.handle(IPC.RESTORE_PREVIEW, async (_e, raw) => {
    const userId = requireSession();
    const input = safeParse(restorePreviewInput, raw);
    try {
      const preview = await previewRestore({
        zipPath: input.zipPath,
        stagingDir: input.stagingDir,
      });
      audit({
        action: 'restore.previewed',
        entityType: 'restore',
        entityId: path.basename(input.zipPath),
        userId,
        metadata: {
          zipPath: input.zipPath,
          stagingDir: input.stagingDir,
          contents: { procedureCount: preview.procedureCount },
          dbIntegrityCheck: preview.dbIntegrityCheck,
        },
      });
      return preview;
    } catch (err) {
      audit({
        action: 'restore.failed',
        entityType: 'restore',
        entityId: path.basename(input.zipPath),
        userId,
        outcome: 'failed',
        metadata: {
          stage: 'preview',
          error: err instanceof Error ? err.message : String(err),
          zipPath: input.zipPath,
        },
      });
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.RESTORE_UNPACK, async (_e, raw) => {
    const userId = requireSession();
    const input = safeParse(restoreUnpackInput, raw);
    try {
      const result = await unpackRestore({
        zipPath: input.zipPath,
        stagingDir: input.stagingDir,
      });
      audit({
        action: 'restore.completed',
        entityType: 'restore',
        entityId: path.basename(input.zipPath),
        userId,
        metadata: {
          stagingDir: result.stagingDir,
          fileCount: result.fileCount,
        },
      });
      return result;
    } catch (err) {
      audit({
        action: 'restore.failed',
        entityType: 'restore',
        entityId: path.basename(input.zipPath),
        userId,
        outcome: 'failed',
        metadata: {
          stage: 'unpack',
          error: err instanceof Error ? err.message : String(err),
          zipPath: input.zipPath,
          stagingDir: input.stagingDir,
        },
      });
      throw asIpcError(err);
    }
  });
}