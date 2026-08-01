// patients:* IPC surface — list + get + create + update + softDelete + restore.
// Per PAT-01/02/03/04 + AUDIT-01 + Fix 6 + D-02.
//
// Every handler:
//   1. re-validates input via zod (per Fix 5 + V5)
//   2. writes an audit_log row in the same db.transaction() as the mutation (per AUDIT-01 + Fix 6)
//   3. translates sqlite + zod errors to IpcErrorException so the renderer can switch on `code`

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, type Patient } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';
import { getDb } from '../db';
import { patientRepo, type PatientCreateInput } from '../db/patients';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { userRepo } from '../db/users';
import {
  idInput,
  patientInput,
  patientListQueryInput,
  patientPatchInput,
} from '@shared/validators';

// Convert a zod error into IpcErrorException IPC_VALIDATION. Field is the first issue path segment.
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

// per D-02 + PAT-04 — restore is admin-only.
function requireAdmin(userId: string): void {
  const row = userRepo.get(userId);
  if (!row || row.is_first_admin !== 1) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Only the first admin can restore patients'));
  }
}

// ponytail: normalize optional zod fields to explicit null so Patient.gender/mrn/phone/notes are typed correctly.
function normalizeCreate(input: z.infer<typeof patientInput>): PatientCreateInput {
  return {
    fullName: input.fullName,
    dob: input.dob,
    gender: input.gender ?? null,
    mrn: input.mrn ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
  };
}

// per AUDIT-01 + Fix 6 — mutation + audit in one transaction so a trigger abort rolls back the row.
export function createPatient(input: unknown): Patient {
  const parsed = safeParse(patientInput, input, 'fullName');
  const userId = requireSession();
  const normalized = normalizeCreate(parsed);
  const db = getDb();
  let created: Patient = {} as Patient;
  db.transaction(() => {
    created = patientRepo.create(normalized);
    // ponytail: action names match RESEARCH.md IPC Contract Extension exactly.
    audit({ action: 'patient_create', entityType: 'patient', entityId: created.id, userId });
  })();
  return created;
}

export function updatePatient(id: string, patch: unknown): Patient {
  const { id: parsedId } = safeParse(idInput, { id }, 'id');
  const parsedPatch = safeParse(patientPatchInput, patch);
  const userId = requireSession();
  const db = getDb();
  let updated: Patient = {} as Patient;
  db.transaction(() => {
    // ponytail: patient_update metadata is the changed field NAMES only — never values (per Fix 6 PII guard).
    const fields = Object.keys(parsedPatch);
    updated = patientRepo.update(parsedId, parsedPatch);
    audit({
      action: 'patient_update',
      entityType: 'patient',
      entityId: parsedId,
      userId,
      metadata: { fields },
    });
  })();
  return updated;
}

export function softDeletePatient(id: string): { ok: true } {
  const { id: parsedId } = safeParse(idInput, { id }, 'id');
  const userId = requireSession();
  const db = getDb();
  let success = false;
  db.transaction(() => {
    success = patientRepo.softDelete(parsedId);
    if (!success) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Patient not found'));
    }
    audit({ action: 'patient_delete', entityType: 'patient', entityId: parsedId, userId });
  })();
  return { ok: true };
}

export function restorePatient(id: string): { ok: true } {
  const { id: parsedId } = safeParse(idInput, { id }, 'id');
  const userId = requireSession();
  // per D-02 + PAT-04 — admin gate BEFORE the transaction so non-admins don't get an audit row.
  requireAdmin(userId);
  const db = getDb();
  let success = false;
  db.transaction(() => {
    success = patientRepo.restore(parsedId);
    if (!success) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Patient not found or not deleted'));
    }
    audit({ action: 'patient_restore', entityType: 'patient', entityId: parsedId, userId });
  })();
  return { ok: true };
}

export function listPatients(query: unknown): { rows: Patient[]; total: number } {
  const parsed = safeParse(patientListQueryInput, query ?? {});
  const userId = requireSession();
  const result = patientRepo.list(parsed);
  // per Fix 6 + ROADMAP Phase 2 success criterion 5 — every read is auditable.
  // metadata echoes the filter, never patient data.
  audit({
    action: 'patient_list',
    entityType: 'patient',
    entityId: null,
    userId,
    metadata: {
      search: parsed.search ?? null,
      mrn: parsed.mrn ?? null,
      includeDeleted: parsed.includeDeleted ?? false,
      page: parsed.page ?? 1,
      pageSize: parsed.pageSize ?? 25,
    },
  });
  return result;
}

export function getPatient(id: string): Patient | null {
  const { id: parsedId } = safeParse(idInput, { id }, 'id');
  const userId = requireSession();
  const row = patientRepo.get(parsedId);
  if (!row) {
    // per Fix 6 — get() against a missing row still emits a view attempt with entity_id so audit captures the lookup.
    audit({ action: 'patient_view', entityType: 'patient', entityId: parsedId, userId, outcome: 'ok' });
    return null;
  }
  audit({ action: 'patient_view', entityType: 'patient', entityId: parsedId, userId });
  return row;
}

export function registerPatientsIpc(): void {
  ipcMain.handle(IPC.PATIENTS_LIST, (_e, raw) => {
    try {
      return listPatients(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PATIENTS_GET, (_e, raw: string) => {
    try {
      return getPatient(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PATIENTS_CREATE, (_e, raw) => {
    try {
      return createPatient(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PATIENTS_UPDATE, (_e, raw: { id: string; patch: unknown }) => {
    try {
      return updatePatient(raw.id, raw.patch);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PATIENTS_SOFT_DELETE, (_e, raw: string) => {
    try {
      return softDeletePatient(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.PATIENTS_RESTORE, (_e, raw: string) => {
    try {
      return restorePatient(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });
}

function asIpcError(err: unknown): Error {
  if (err instanceof z.ZodError) {
    return asIpcError(fromZodError(err));
  }
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}