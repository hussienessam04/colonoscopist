// procedures:* IPC surface — create / get / list / finalize + procedure-notes:*.
// Per CAPT-04/05/06/08 + AUDIT-01 + Fix 6 + D-02/06/07 + BLOCKER 4.
//
// Every handler:
//   1. re-validates input via zod (per Fix 5 + V5)
//   2. derives doctorId from `requireSession()` — the payload never includes it
//   3. writes an audit_log row in the same db.transaction() as the mutation

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, type Procedure, type ProcedureNote, type ProcedureStatus } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';
import { getDb } from '../db';
import { proceduresRepo } from '../db/procedures-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import {
  proceduresCreateInput,
  proceduresGetInput,
  proceduresListQueryInput,
  proceduresFinalizeInput,
  procedureNoteCreateInput,
  procedureNoteListInput,
  proceduresTrimInput,
  proceduresRestoreInput,
} from '@shared/validators';

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

export type CreateProcedureInput = {
  patientId: string;
  doctorId: string;
  presetSummary: import('@shared/ipc-contract').PresetSummary;
};

// IPC surface ───────────────────────────────────────────────────────────

export function registerProceduresIpc(opts: {
  createProcedure: (input: CreateProcedureInput) => Procedure;
}): void {
  ipcMain.handle(IPC.PROCEDURES_CREATE, (_e, raw) => {
    try {
      const { patientId } = safeParse(proceduresCreateInput, raw, 'patientId');
      const doctorId = requireSession();
      const db = getDb();
      let created: Procedure = {} as Procedure;
      db.transaction(() => {
        // presetSummary is a placeholder; recording.start does not rewrite
        // this row — the row inserted here is the canonical procedure row
        // for the entire session. The preset is updated via
        // proceduresRepo.updateFinalized on stop, but for Plan 02 the
        // initial preset is sufficient.
        created = opts.createProcedure({
          patientId,
          doctorId,
          presetSummary: defaultPresetSummary(),
        });
        audit({
          action: 'procedure.create',
          entityType: 'procedure',
          entityId: created.id,
          userId: doctorId,
          metadata: { stage: 'create' },
        });
      })();
      return created;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PROCEDURES_GET, (_e, raw) => {
    try {
      const { id } = safeParse(proceduresGetInput, raw, 'id');
      const userId = requireSession();
      const row = proceduresRepo.get(id);
      audit({
        action: 'procedure.view',
        entityType: 'procedure',
        entityId: id,
        userId,
      });
      return row ?? null;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PROCEDURES_LIST, (_e, raw) => {
    try {
      const parsed = safeParse(proceduresListQueryInput, raw ?? {});
      const userId = requireSession();
      const result = proceduresRepo.list(parsed);
      audit({
        action: 'procedure.list',
        entityType: 'procedure',
        entityId: null,
        userId,
        metadata: {
          patientId: parsed.patientId ?? null,
          status: parsed.status ?? null,
          page: parsed.page ?? 1,
          pageSize: parsed.pageSize ?? 25,
        },
      });
      return result;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PROCEDURES_FINALIZE, (_e, raw) => {
    try {
      const parsed = safeParse(proceduresFinalizeInput, raw, 'id');
      const userId = requireSession();
      const db = getDb();
      let updated: Procedure = {} as Procedure;
      db.transaction(() => {
        updated = proceduresRepo.updateFinalized(parsed.id, {
          endedAt: parsed.endedAt,
          durationSeconds: parsed.durationSeconds,
          status: parsed.status,
          videoPath: parsed.videoPath,
        });
        audit({
          action: 'procedure.finalize',
          entityType: 'procedure',
          entityId: parsed.id,
          userId,
          metadata: { status: parsed.status, durationSeconds: parsed.durationSeconds },
        });
      })();
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  // Procedure notes — append-only chronological log per D-06/D-07/D-09.
  ipcMain.handle(IPC.PROCEDURE_NOTES_CREATE, (_e, raw) => {
    try {
      const { procedureId, body } = safeParse(procedureNoteCreateInput, raw);
      const userId = requireSession();
      const db = getDb();
      let created: ProcedureNote = {} as ProcedureNote;
      db.transaction(() => {
        try {
          created = proceduresRepo.insertNote({ procedureId, body });
        } catch (err) {
          if (
            err instanceof Error &&
            'code' in err &&
            (err as { code: string }).code === 'SQLITE_CONSTRAINT_CHECK'
          ) {
            throw new IpcErrorException(
              ipcError('IPC_VALIDATION', 'Note body must be 1..1000 characters', {
                field: 'body',
              }),
            );
          }
          throw err;
        }
        // Per Fix 6 — audit metadata carries the LENGTH only, never the body content.
        audit({
          action: 'procedure.note_added',
          entityType: 'procedure',
          entityId: procedureId,
          userId,
          metadata: { bodyLength: body.length },
        });
      })();
      return created;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PROCEDURE_NOTES_LIST, (_e, raw) => {
    try {
      const { procedureId } = safeParse(procedureNoteListInput, raw);
      const userId = requireSession();
      const rows = proceduresRepo.listNotes(procedureId);
      audit({
        action: 'procedure.note_list',
        entityType: 'procedure',
        entityId: procedureId,
        userId,
        metadata: { procedureId, count: rows.length },
      });
      return rows;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  // Phase 5 / Plan 01 — Trim + Restore IPC surface is declared so the renderer
  // contract doesn't shift. The handlers are stubs that validate input via
  // safeParse (so the stub still rejects malformed payloads) then throw
  // IPC_NOT_IMPLEMENTED. Real impl lands in Plan 03.
  ipcMain.handle(IPC.PROCEDURES_TRIM, (_e, raw) => {
    try {
      // Validate input first so T-05-09 (negative-range DoS) is mitigated
      // even before Plan 03 ships. The schema's .refine rejects outMs <= inMs
      // as IPC_VALIDATION.
      safeParse(proceduresTrimInput, raw, 'id');
      throw new IpcErrorException(
        ipcError(
          'IPC_NOT_IMPLEMENTED',
          'Trim ships in Plan 03/05-03',
        ),
      );
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PROCEDURES_RESTORE, (_e, raw) => {
    try {
      safeParse(proceduresRestoreInput, raw, 'id');
      throw new IpcErrorException(
        ipcError(
          'IPC_NOT_IMPLEMENTED',
          'Restore ships in Plan 03/05-03',
        ),
      );
    } catch (err) {
      throw asIpcError(err);
    }
  });

  // Phase 5 / Plan 02 — pause-marker source for the review scrubber (D-11).
  // Returns rows in their canonical order (segmentIndex ASC).
  ipcMain.handle(IPC.PROCEDURES_LIST_SEGMENTS, (_e, raw) => {
    try {
      const { procedureId } = safeParse(
        z.object({ procedureId: z.string().uuid() }),
        raw,
        'procedureId',
      );
      const userId = requireSession();
      const rows = proceduresRepo.listSegments(procedureId);
      audit({
        action: 'procedure.segments_list',
        entityType: 'procedure',
        entityId: procedureId,
        userId,
        metadata: { procedureId, count: rows.length },
      });
      return rows;
    } catch (err) {
      throw asIpcError(err);
    }
  });
}

function defaultPresetSummary(): import('@shared/ipc-contract').PresetSummary {
  return { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' };
}

// Re-export for the test suite; not part of the IPC surface.
export const __test = {
  safeParse,
  fromZodError,
  asIpcError,
  requireSession,
  defaultPresetSummary,
};
// Status union re-exported to keep zod's enum in sync with the IPC type.
export type { ProcedureStatus, ProcedureNote };