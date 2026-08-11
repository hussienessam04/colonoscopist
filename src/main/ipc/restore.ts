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
// RESTORE_PICK_ZIP: Phase 7 / Plan 07-05 — D-13 verbatim. Wraps
// Electron's `dialog.showOpenDialog` with a .zip filter so the
// renderer cannot accidentally feed a non-zip into preview/unpack.
//
// RESTORE_REVEAL_STAGING: Phase 7 / Plan 07-05 — wraps
// `shell.openPath(staging)` so the doctor can reveal the freshly
// unpacked staging folder in Windows Explorer without picking any
// other path. Uses shell.openPath (NOT showItemInFolder) because the
// operator wants the directory itself, not a selected file.
//
// On any throw, emits a `restore.failed` audit row and re-throws so the
// renderer can surface the failure.
//
// Per Phase 2 BLOCKER 4, no payload includes a `userId` field — main
// derives it from `requireSession()` for the audit row.

import { dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { z } from 'zod';

import { IPC } from '@shared/ipc-contract';
import {
  pickZipInput,
  restorePreviewInput,
  restoreRevealStagingInput,
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

  // Phase 7 / Plan 07-05 — D-13 verbatim dialog.showOpenDialog wrapper.
  // returns null when the operator cancels; the renderer short-circuits
  // without calling preview/unpack. The .zip filter keeps non-zip files
  // out of the restore pipeline even if the user types a wrong path.
  ipcMain.handle(IPC.RESTORE_PICK_ZIP, async (_e, raw) => {
    requireSession();
    safeParse(pickZipInput, raw);
    const result = await dialog.showOpenDialog({
      title: 'Choose backup file',
      properties: ['openFile'],
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Phase 7 / Plan 07-05 — open the staging directory in the OS file
  // manager. Uses shell.openPath (NOT showItemInFolder) because the
  // doctor wants the directory itself, not a selected file. Returns
  // `{ ok: true }` even when openPath prints a non-empty error string
  // (the doctor can manually navigate); we only surface true
  // exceptions through asIpcError.
  ipcMain.handle(IPC.RESTORE_REVEAL_STAGING, async (_e, raw) => {
    requireSession();
    const input = safeParse(restoreRevealStagingInput, raw);
    try {
      // ponytail: shell.openPath returns a Promise<string> in modern
      // Electron — a non-empty resolved string is the OS-reported
      // error, NOT a throw. Await it so we can log the error and still
      // return ok (the doctor can navigate manually). A genuine
      // exception falls through to asIpcError.
      const result = await shell.openPath(path.normalize(input.stagingDir));
      if (result && result.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[restore.reveal-staging] openPath reported: ${result}`);
      }
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  });
}