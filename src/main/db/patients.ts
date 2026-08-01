// patients table repository — cached prepared statements only (per anti-pattern: no raw SQL in repos).
// Per PAT-01/02/03/04 + AUDIT-01 + Fix 6.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';
import type { Patient } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';

// Internal row shape (snake_case columns). Converted to `Patient` (camelCase) at the repo boundary
// so the IPC layer + tests don't need a separate mapper.
export type PatientRow = {
  id: string;
  full_name: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  mrn: string | null;
  phone: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type PatientCreateInput = {
  fullName: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  mrn: string | null;
  phone: string | null;
  notes: string | null;
};

// Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'mrn' | 'phone' | 'notes'>> — using string column
// names here keeps the update SQL straightforward; conversion happens at the repo entry.
export type PatientPatchInput = Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'mrn' | 'phone' | 'notes'>>;

export type PatientListInput = {
  search?: string;
  mrn?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  get: Stmt;
  getIncludingDeleted: Stmt;
  listActive: Stmt;
  listAll: Stmt;
  countActive: Stmt;
  countAll: Stmt;
  listByMrnActive: Stmt;
  listByMrnAll: Stmt;
  countByMrnActive: Stmt;
  countByMrnAll: Stmt;
  listBySearchActive: Stmt;
  listBySearchAll: Stmt;
  countBySearchActive: Stmt;
  countBySearchAll: Stmt;
  update: Stmt;
  softDelete: Stmt;
  restore: Stmt;
} | null = null;

function stmts() {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO patients (id, full_name, dob, gender, mrn, phone, notes, created_at, updated_at, deleted_at)
       VALUES (@id, @full_name, @dob, @gender, @mrn, @phone, @notes, @created_at, @updated_at, NULL)`,
    ),
    get: db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL'),
    getIncludingDeleted: db.prepare('SELECT * FROM patients WHERE id = ?'),
    listActive: db.prepare(
      'SELECT * FROM patients WHERE deleted_at IS NULL ORDER BY full_name COLLATE NOCASE LIMIT @limit OFFSET @offset',
    ),
    listAll: db.prepare(
      'SELECT * FROM patients ORDER BY full_name COLLATE NOCASE LIMIT @limit OFFSET @offset',
    ),
    countActive: db.prepare('SELECT COUNT(*) AS c FROM patients WHERE deleted_at IS NULL'),
    countAll: db.prepare('SELECT COUNT(*) AS c FROM patients'),
    listByMrnActive: db.prepare(
      'SELECT * FROM patients WHERE deleted_at IS NULL AND mrn = @mrn ORDER BY full_name COLLATE NOCASE LIMIT @limit OFFSET @offset',
    ),
    listByMrnAll: db.prepare(
      'SELECT * FROM patients WHERE mrn = @mrn ORDER BY full_name COLLATE NOCASE LIMIT @limit OFFSET @offset',
    ),
    countByMrnActive: db.prepare(
      'SELECT COUNT(*) AS c FROM patients WHERE deleted_at IS NULL AND mrn = @mrn',
    ),
    countByMrnAll: db.prepare('SELECT COUNT(*) AS c FROM patients WHERE mrn = @mrn'),
    listBySearchActive: db.prepare(
      `SELECT * FROM patients
       WHERE deleted_at IS NULL AND full_name LIKE @search COLLATE NOCASE
       ORDER BY full_name COLLATE NOCASE LIMIT @limit OFFSET @offset`,
    ),
    listBySearchAll: db.prepare(
      `SELECT * FROM patients
       WHERE full_name LIKE @search COLLATE NOCASE
       ORDER BY full_name COLLATE NOCASE LIMIT @limit OFFSET @offset`,
    ),
    countBySearchActive: db.prepare(
      `SELECT COUNT(*) AS c FROM patients WHERE deleted_at IS NULL AND full_name LIKE @search COLLATE NOCASE`,
    ),
    countBySearchAll: db.prepare(
      `SELECT COUNT(*) AS c FROM patients WHERE full_name LIKE @search COLLATE NOCASE`,
    ),
    update: db.prepare(
      `UPDATE patients
       SET full_name = @full_name, dob = @dob, gender = @gender,
           mrn = @mrn, phone = @phone, notes = @notes, updated_at = @updated_at
       WHERE id = @id AND deleted_at IS NULL`,
    ),
    // ponytail: softDelete is the only deletion path (per PAT-04). No DELETE FROM patients exists anywhere.
    softDelete: db.prepare(
      'UPDATE patients SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    ),
    restore: db.prepare(
      'UPDATE patients SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL',
    ),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements must be dropped.
export function __resetPatientRepoCache(): void {
  cached = null;
}

function rowToPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    fullName: row.full_name,
    dob: row.dob,
    gender: row.gender,
    mrn: row.mrn,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const MAX_PAGE_SIZE = 200;

export const patientRepo = {
  create(input: PatientCreateInput): Patient {
    const id = randomUUID();
    const now = Date.now();
    try {
      stmts().insert.run({
        id,
        full_name: input.fullName,
        dob: input.dob,
        gender: input.gender,
        mrn: input.mrn,
        phone: input.phone,
        notes: input.notes,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      // per PAT-01 — MRN uniqueness index `idx_patients_mrn` (WHERE mrn IS NOT NULL AND deleted_at IS NULL)
      // throws SQLITE_CONSTRAINT_UNIQUE on collision. Translate to IPC_VALIDATION so the renderer
      // can surface "MRN already in use" without exposing SQLite codes.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new IpcErrorException(ipcError('IPC_VALIDATION', 'MRN already in use', { field: 'mrn' }));
      }
      throw err;
    }
    const created = stmts().getIncludingDeleted.get(id) as PatientRow | undefined;
    if (!created) {
      throw new Error('patient row missing immediately after insert');
    }
    return rowToPatient(created);
  },

  get(id: string): Patient | undefined {
    const row = stmts().get.get(id) as PatientRow | undefined;
    return row ? rowToPatient(row) : undefined;
  },

  // ponytail: include-deleted variant is reserved for restore + admin audit review (per T-02-PAT-01).
  getIncludingDeleted(id: string): Patient | undefined {
    const row = stmts().getIncludingDeleted.get(id) as PatientRow | undefined;
    return row ? rowToPatient(row) : undefined;
  },

  list(filter: PatientListInput): { rows: Patient[]; total: number } {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 25;
    const limit = Math.min(pageSize, MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;
    const includeDeleted = filter.includeDeleted === true;
    const hasSearch = !!filter.search && filter.search.length > 0;
    const hasMrn = !!filter.mrn && filter.mrn.length > 0;

    let listStmt: Stmt;
    let countStmt: Stmt;
    const params: Record<string, unknown> = { limit, offset };

    if (hasMrn) {
      params.mrn = filter.mrn;
      listStmt = includeDeleted ? stmts().listByMrnAll : stmts().listByMrnActive;
      countStmt = includeDeleted ? stmts().countByMrnAll : stmts().countByMrnActive;
    } else if (hasSearch) {
      params.search = `%${filter.search}%`;
      listStmt = includeDeleted ? stmts().listBySearchAll : stmts().listBySearchActive;
      countStmt = includeDeleted ? stmts().countBySearchAll : stmts().countBySearchActive;
    } else {
      listStmt = includeDeleted ? stmts().listAll : stmts().listActive;
      countStmt = includeDeleted ? stmts().countAll : stmts().countActive;
    }

    const rows = listStmt.all(params) as PatientRow[];
    const total = (countStmt.get(params) as { c: number }).c;
    return { rows: rows.map(rowToPatient), total };
  },

  update(id: string, patch: PatientPatchInput): Patient {
    const current = stmts().getIncludingDeleted.get(id) as PatientRow | undefined;
    if (!current || current.deleted_at !== null) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Patient not found'));
    }
    const merged: PatientRow = {
      ...current,
      full_name: patch.fullName ?? current.full_name,
      dob: patch.dob ?? current.dob,
      gender: patch.gender === undefined ? current.gender : patch.gender,
      mrn: patch.mrn === undefined ? current.mrn : patch.mrn,
      phone: patch.phone === undefined ? current.phone : patch.phone,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      updated_at: Date.now(),
    };
    try {
      stmts().update.run({
        id,
        full_name: merged.full_name,
        dob: merged.dob,
        gender: merged.gender,
        mrn: merged.mrn,
        phone: merged.phone,
        notes: merged.notes,
        updated_at: merged.updated_at,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new IpcErrorException(ipcError('IPC_VALIDATION', 'MRN already in use', { field: 'mrn' }));
      }
      throw err;
    }
    const refreshed = stmts().getIncludingDeleted.get(id) as PatientRow;
    return rowToPatient(refreshed);
  },

  // per PAT-04 — soft delete only. rowcount > 0 is the success signal.
  softDelete(id: string): boolean {
    const now = Date.now();
    const result = stmts().softDelete.run(now, now, id);
    return result.changes > 0;
  },

  // per D-02 + PAT-04 — restore is admin-gated at the IPC layer; this is just the SQL.
  restore(id: string): boolean {
    const now = Date.now();
    const result = stmts().restore.run(now, id);
    return result.changes > 0;
  },
};