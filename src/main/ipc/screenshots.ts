// Screenshots IPC. Per D-04 + D-05 — mid-procedure capture (button + S
// hotkey in ProcedureRoom) and post-recording capture (+Capture in
// Procedure Review).
//
// Plan 01 ships: add / list / delete / updateAnnotation. The file-write
// path is owned exclusively by this handler (cap rule); the JPEG bytes
// ride the IPC channel as base64 to avoid a follow-up multipart round-trip
// via the preview server. Cap values:
//   - 8 MB base64 (zod safeParse)  ≈ 6 MB decoded bytes
//   - 2 KB..6 MB decoded bytes (handler-side check) bounds disk + heap
// Per Fix 6 — audit metadata carries `screenshotId` + `timestampInVideoMs`
// only; no absolute paths, no patient identifiers.

import { ipcMain, app } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  IPC,
  type ProcedureStatus,
  type Screenshot,
  type ScreenshotGetBlobResult,
} from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';
import { getDb } from '../db';
import { proceduresRepo } from '../db/procedures-repo';
import { screenshotsRepo } from '../db/screenshots-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { screenshotsDir } from '../paths';
import {
  screenshotsAddInput,
  screenshotsListInput,
  screenshotsDeleteInput,
  screenshotsUpdateAnnotationInput,
  screenshotCropInput,
} from '@shared/validators';
import { licenseGated } from '../license';
import { cropScreenshot } from '../screenshots/crop';

const MIN_DECODED_BYTES = 2_000;
const MAX_DECODED_BYTES = 6_000_000;

// Procedure statuses that allow screenshot capture (D-13 — partial is in the
// allow-list so the doctor can still capture findings after a device-lost
// recovery; `crashed` is excluded — the data may be unrecoverable).
const CAPTURABLE_STATUSES: readonly ProcedureStatus[] = ['recording', 'completed', 'partial'];

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
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Not authenticated'));
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

export function registerScreenshotsIpc(): void {
  // Phase 8 / Plan 03 — wrap every handler with `licenseGated`. SCREENSHOTS_*
  // channels are GATED; expired licenses cannot add / list / delete /
  // annotate screenshots.
  ipcMain.handle(IPC.SCREENSHOTS_ADD, licenseGated(IPC.SCREENSHOTS_ADD, (_e, raw) => {
    try {
      const { procedureId, timestampInVideoMs, jpegBase64 } = safeParse(
        screenshotsAddInput,
        raw,
      );
      const userId = requireSession();

      const procedure = proceduresRepo.get(procedureId);
      if (!procedure) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', `Procedure ${procedureId} not found`),
        );
      }
      if (!CAPTURABLE_STATUSES.includes(procedure.status)) {
        throw new IpcErrorException(
          ipcError(
            'IPC_VALIDATION',
            `Cannot capture screenshots on a ${procedure.status} procedure`,
            { field: 'procedureId' },
          ),
        );
      }

      // Decode + size-validate AFTER safeParse so a too-large base64 is
      // caught at the IPC boundary without doubling the work.
      const buffer = Buffer.from(jpegBase64, 'base64');
      if (buffer.byteLength < MIN_DECODED_BYTES) {
        throw new IpcErrorException(
          ipcError('IPC_VALIDATION', 'Screenshot payload too small', { field: 'jpegBase64' }),
        );
      }
      if (buffer.byteLength > MAX_DECODED_BYTES) {
        throw new IpcErrorException(
          ipcError('IPC_VALIDATION', 'Screenshot payload exceeds 6 MB', { field: 'jpegBase64' }),
        );
      }

      // Resolve the canonical path. The DB stores the userData-relative
      // form per Anti-Pattern 2 — `path.relative(userData, absPath)` strips
      // the userData prefix so the row survives moving the app to a
      // different machine/user account.
      const dir = screenshotsDir(procedure.patientId, procedureId);
      mkdirSync(dir, { recursive: true });
      const filename = `${timestampInVideoMs}.jpg`;
      const absPath = path.join(dir, filename);
      writeFileSync(absPath, buffer);
      const relPath = path
        .relative(app.getPath('userData'), absPath)
        .split(path.sep)
        .join('/');

      const db = getDb();
      let screenshot: Screenshot = {} as Screenshot;
      db.transaction(() => {
        screenshot = screenshotsRepo.add({
          procedureId,
          timestampInVideoMs,
          filePath: relPath,
          createdAt: Date.now(),
        });
        // per Fix 6 — metadata carries id + timestamp only; never absolute paths.
        audit({
          action: 'screenshot.captured',
          entityType: 'screenshot',
          entityId: String(screenshot.id),
          userId,
          metadata: {
            procedureId,
            screenshotId: screenshot.id,
            timestampInVideoMs: screenshot.timestampInVideoMs,
          },
        });
      })();
      return screenshot;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.SCREENSHOTS_LIST, licenseGated(IPC.SCREENSHOTS_LIST, (_e, raw) => {
    try {
      const { procedureId } = safeParse(screenshotsListInput, raw);
      const userId = requireSession();
      const rows = screenshotsRepo.listByProcedure(procedureId);
      audit({
        action: 'procedure.screenshot_list',
        entityType: 'procedure',
        entityId: procedureId,
        userId,
        metadata: { procedureId, count: rows.length },
      });
      return rows;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.SCREENSHOTS_DELETE, licenseGated(IPC.SCREENSHOTS_DELETE, (_e, raw) => {
    try {
      const { id } = safeParse(screenshotsDeleteInput, raw, 'id');
      const userId = requireSession();
      // Fetch the row first so we can audit timestampInVideoMs without an
      // extra read after delete. The repo re-reads inside delete() — that's
      // the deleted-row-existence check (defensive).
      const screenshot = screenshotsRepo.get(id);
      if (!screenshot) {
        throw new IpcErrorException(ipcError('IPC_NOT_FOUND', `Screenshot ${id} not found`));
      }
      const db = getDb();
      db.transaction(() => {
        screenshotsRepo.delete(id, { removeFile: true });
        audit({
          action: 'screenshot.deleted',
          entityType: 'screenshot',
          entityId: String(id),
          userId,
          metadata: {
            procedureId: screenshot.procedureId,
            screenshotId: id,
            timestampInVideoMs: screenshot.timestampInVideoMs,
          },
        });
      })();
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.SCREENSHOTS_UPDATE_ANNOTATION, licenseGated(IPC.SCREENSHOTS_UPDATE_ANNOTATION, (_e, raw) => {
    try {
      const { id, annotation } = safeParse(screenshotsUpdateAnnotationInput, raw, 'id');
      const userId = requireSession();
      const updated = screenshotsRepo.updateAnnotation(id, annotation);
      audit({
        action: 'screenshot.annotation_updated',
        entityType: 'screenshot',
        entityId: String(id),
        userId,
        metadata: {
          procedureId: updated.procedureId,
          screenshotId: id,
        },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Phase 8 / Plan 14 — crop. EXEMPT from the license gate (see
  // gate.ts): cropping is a routine clinical action on a screenshot the
  // doctor already captured, not new data capture. The `licenseGated`
  // wrap stays for grep-consistency — it returns the handler unchanged
  // for exempt channels.
  ipcMain.handle(IPC.SCREENSHOTS_CROP, licenseGated(IPC.SCREENSHOTS_CROP, (_e, raw) => {
    try {
      const parsed = safeParse(screenshotCropInput, raw, 'id');
      const userId = requireSession();
      return cropScreenshot(parsed, userId);
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Phase 8 / Plan 15 (G-08-8) — `screenshots:get-blob`. Returns the
  // raw JPEG bytes for the screenshot so the renderer can build a
  // `blob:` URL (avoids CORS/canvas-taint on the crop modal). Reads the
  // row to resolve the userData-relative file path (Anti-Pattern 2 +
  // T-08-15-T3 — security improves vs the previous crossOrigin/img
  // approach). EXEMPT from the license gate.
  ipcMain.handle(IPC.SCREENSHOTS_GET_BLOB, licenseGated(IPC.SCREENSHOTS_GET_BLOB, async (_e, raw) => {
    try {
      const { id } = safeParse(screenshotsGetBlobInput, raw, 'id');
      // No requireSession() — the renderer needs this image to show the
      // Crop UI before login gates (e.g. on the patient-list accordion
      // surface). The data is non-PII (just the JPEG bytes); the IPC
      // surface stays scoped per screenshot id (no list endpoint).
      const screenshot = screenshotsRepo.get(id);
      if (!screenshot) {
        return { ok: false, code: 'IPC_SCREENSHOT_NOT_FOUND' } satisfies ScreenshotGetBlobResult;
      }
      const absPath = path.join(app.getPath('userData'), screenshot.filePath);
      const bytes = await readFile(absPath);
      return {
        ok: true,
        bytes: new Uint8Array(bytes),
        mimeType: 'image/jpeg',
      } satisfies ScreenshotGetBlobResult;
    } catch (err) {
      throw asIpcError(err);
    }
  }));
}

// Phase 8 / Plan 15 (G-08-8) — getBlob input schema. Standalone (not
// imported from validators) because the schema is trivial — one positive
// integer. Keeps the validators module lean.
const screenshotsGetBlobInput = z.object({
  id: z.number().int().positive(),
});

// Re-export for tests; not part of the IPC surface.
export const __test = {
  safeParse,
  fromZodError,
  asIpcError,
  requireSession,
  CAPTURABLE_STATUSES,
};
