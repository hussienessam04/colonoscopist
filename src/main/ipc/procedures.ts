// procedures:* IPC surface — create / get / list / finalize.
// Per CAPT-04/05/06 + AUDIT-01 + Fix 6 + D-02 + BLOCKER 4.
//
// Every handler:
//   1. re-validates input via zod (per Fix 5 + V5)
//   2. derives doctorId from `requireSession()` — the payload never includes it
//   3. writes an audit_log row in the same db.transaction() as the mutation

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, type Procedure, type ProcedureStatus } from '@shared/ipc-contract';
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
  presetSummary: import('@shared/ipc-contract').PresetSummary;
};

export function createProcedureStub(input: CreateProcedureInput, doctorId: string): Procedure {
  // ponytail: a future plan will extend create() to accept presetSummary; for
  // Plan 04-01, the IPC layer doesn't insert — recording.start does. This
  // function is reserved for future plans and intentionally not exported
  // through IpcContract.
  void input;
  void doctorId;
  throw new Error('createProcedureStub is reserved; use recording.start to insert');
}

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
        // presetSummary is a placeholder; recording.start rewrites the row
        // with the canonical preset before ffmpeg spawns.
        created = opts.createProcedure({ patientId, presetSummary: defaultPresetSummary() });
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
export type { ProcedureStatus };