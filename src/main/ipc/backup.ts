// Phase 7 / Plan 07-01 — Backup IPC handlers (SET-05).
//
// BACKUP_CREATE: destPath is the absolute zip path (chosen by the
// renderer via Electron's `dialog.showSaveDialog` in Plan 07-05). The
// handler invokes `createBackup()` from src/main/backup/index.ts, which
// streams the active `data/` directory into a zip file. On success,
// emits a `backup.created` audit row carrying the path + sizeBytes +
// procedureCount. On any throw, emits a `backup.failed` audit row with
// the error message + re-throws so the renderer can surface the
// failure.
//
// BACKUP_REVEAL: invokes `revealBackup(path)` which delegates to
// `shell.showItemInFolder`. No audit row (read-only highlight).
//
// BACKUP_PICK_DESTINATION: Phase 7 / Plan 07-05 — D-11 verbatim. Wraps
// Electron's `dialog.showSaveDialog` with a pre-filled filename of
// `colonoscopist-backup-<timestamp>.zip`. The renderer never builds
// absolute paths; this channel is the only legitimate source of a
// `destPath` value that flows into BACKUP_CREATE.
//
// Per Phase 2 BLOCKER 4, no payload includes a `userId` field — main
// derives it from `requireSession()` for the audit row.

import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import { z } from 'zod';

import { IPC } from '@shared/ipc-contract';
import {
  backupCreateInput,
  backupRevealInput,
  pickDestinationInput,
} from '@shared/validators';
import { IpcErrorException, ipcError } from '@shared/errors';

import { createBackup, revealBackup } from '../backup';
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

export function registerBackupIpc(): void {
  ipcMain.handle(IPC.BACKUP_CREATE, async (_e, raw) => {
    const userId = requireSession();
    const input = safeParse(backupCreateInput, raw);
    try {
      const result = await createBackup({ destZipPath: input.destPath });
      audit({
        action: 'backup.created',
        entityType: 'backup',
        entityId: path.basename(input.destPath),
        userId,
        metadata: {
          path: result.path,
          sizeBytes: result.sizeBytes,
          procedureCount: result.procedureCount,
        },
      });
      return result;
    } catch (err) {
      // Per AUDIT-01 — failure paths must leave an audit trail so the
      // doctor can see what went wrong later. The IPC_AUTH_REQUIRED
      // gate is captured by the requireSession call above; any error
      // reaching this catch is a backup-engine failure (disk full,
      // ffmpeg crash, etc.).
      audit({
        action: 'backup.failed',
        entityType: 'backup',
        entityId: path.basename(input.destPath),
        userId,
        outcome: 'failed',
        metadata: {
          error: err instanceof Error ? err.message : String(err),
          path: input.destPath,
        },
      });
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.BACKUP_REVEAL, (_e, raw) => {
    requireSession();
    const input = safeParse(backupRevealInput, raw);
    try {
      revealBackup(input.path);
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  // Phase 7 / Plan 07-05 — D-11 verbatim dialog.showSaveDialog wrapper.
  // Pre-fills the suggested filename with a UTC timestamp suffix so
  // doctors don't have to edit the dialog manually. The picker returns
  // null when the user cancels — the renderer short-circuits without
  // invoking BACKUP_CREATE. No audit row for the picker itself (it's
  // a UI-only action; the CREATE call writes the audit trail).
  ipcMain.handle(IPC.BACKUP_PICK_DESTINATION, async (_e, raw) => {
    requireSession();
    safeParse(pickDestinationInput, raw);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const result = await dialog.showSaveDialog({
      title: 'Create backup',
      defaultPath: `colonoscopist-backup-${timestamp}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath;
  });
}