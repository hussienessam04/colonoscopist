// reports table repository — cached prepared statements only.
// Per CONTEXT.md D-05 (1:1 reports-per-procedure, UNIQUE on procedure_id)
// + D-06 (finalize freezes finalized_at; subsequent edits bump updated_at)
// + D-07 (post-finalize edits allowed but limited to four free-text fields
// via per-column UPDATE guarded by `status='finalized' AND
// finalized_at IS NOT NULL`).
// + D-08 (no role gate at the data layer — any signed-in doctor can edit
// a finalized report; the role check is intentionally absent).

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';
import { IpcErrorException, ipcError } from '@shared/errors';
import type { Report } from '@shared/ipc-contract';

export type ReportRow = {
  id: string;
  procedure_id: string;
  doctor_id: string;
  findings: string;
  diagnosis: string;
  recommendations: string;
  procedure_details: string;
  status: 'draft' | 'finalized';
  finalized_at: number | null;
  pdf_path: string | null;
  pdf_generated_at: number | null;
  created_at: number;
  updated_at: number;
};

export type ReportUpdatePatch = {
  findings?: string;
  diagnosis?: string;
  recommendations?: string;
  procedureDetails?: string;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  getById: Stmt;
  getByProcedure: Stmt;
  updateDraft: Stmt;
  updateFinalized: Stmt;
  finalize: Stmt;
  setPdfPath: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO reports
        (id, procedure_id, doctor_id, findings, diagnosis, recommendations,
         procedure_details, status, finalized_at, pdf_path, pdf_generated_at,
         created_at, updated_at)
       VALUES
        (@id, @procedure_id, @doctor_id, '', '', '', '', 'draft', NULL, NULL, NULL,
         @now, @now)`,
    ),
    getById: db.prepare(`SELECT * FROM reports WHERE id = ?`),
    getByProcedure: db.prepare(`SELECT * FROM reports WHERE procedure_id = ?`),
    // ponytail: only the four free-text fields land in the SET clause;
    // procedure_id / doctor_id / finalized_at / created_at are immutable
    // post-insert (locked per D-07). The `status='draft'` guard makes the
    // UPDATE a no-op once finalized, routing subsequent edits to
    // updateFinalized via the IPC handler.
    updateDraft: db.prepare(
      `UPDATE reports SET
         findings = @findings,
         diagnosis = @diagnosis,
         recommendations = @recommendations,
         procedure_details = @procedure_details,
         updated_at = @updated_at
       WHERE id = @id AND status = 'draft'`,
    ),
    updateFinalized: db.prepare(
      `UPDATE reports SET
         findings = @findings,
         diagnosis = @diagnosis,
         recommendations = @recommendations,
         procedure_details = @procedure_details,
         updated_at = @updated_at
       WHERE id = @id AND status = 'finalized' AND finalized_at IS NOT NULL`,
    ),
    finalize: db.prepare(
      `UPDATE reports SET status = 'finalized', finalized_at = @now, updated_at = @now
       WHERE id = @id AND status = 'draft'`,
    ),
    setPdfPath: db.prepare(
      `UPDATE reports SET pdf_path = @pdf_path, pdf_generated_at = @now, updated_at = @now
       WHERE id = @id`,
    ),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements
// must be dropped on teardown.
export function __resetReportsRepoCache(): void {
  cached = null;
}

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    doctorId: row.doctor_id,
    findings: row.findings,
    diagnosis: row.diagnosis,
    recommendations: row.recommendations,
    procedureDetails: row.procedure_details,
    status: row.status,
    finalizedAt: row.finalized_at,
    pdfPath: row.pdf_path,
    pdfGeneratedAt: row.pdf_generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function patchToRow(patch: ReportUpdatePatch): {
  findings: string | null;
  diagnosis: string | null;
  recommendations: string | null;
  procedure_details: string | null;
} {
  return {
    findings: patch.findings ?? null,
    diagnosis: patch.diagnosis ?? null,
    recommendations: patch.recommendations ?? null,
    procedure_details: patch.procedureDetails ?? null,
  };
}

export const reportsRepo = {
  // D-05 — 1:1 with procedure. If a row already exists, returns it; the
  // UNIQUE(procedure_id) constraint protects against double-insert. The
  // inserted row's status defaults to 'draft' with empty free-text fields.
  getOrCreate(procedureId: string, doctorId: string): Report {
    const existing = stmts().getByProcedure.get(procedureId) as ReportRow | undefined;
    if (existing) return rowToReport(existing);
    const id = randomUUID();
    const now = Date.now();
    try {
      stmts().insert.run({
        id,
        procedure_id: procedureId,
        doctor_id: doctorId,
        now,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        // ponytail: race window — a concurrent getOrCreate landed first.
        // Re-read instead of throwing IPC_VALIDATION so the second caller
        // still gets a usable row.
        const row = stmts().getByProcedure.get(procedureId) as ReportRow | undefined;
        if (row) return rowToReport(row);
      }
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'Procedure or doctor not found'),
        );
      }
      throw err;
    }
    const row = stmts().getById.get(id) as ReportRow;
    return rowToReport(row);
  },

  getById(id: string): Report | null {
    const row = stmts().getById.get(id) as ReportRow | undefined;
    return row ? rowToReport(row) : null;
  },

  getByProcedure(procedureId: string): Report | null {
    const row = stmts().getByProcedure.get(procedureId) as ReportRow | undefined;
    return row ? rowToReport(row) : null;
  },

  // D-07 / D-06 — only callable on draft rows (status='draft' guard).
  // Caller is expected to coalesce undefined fields against the existing
  // row's values so this UPDATE writes the merged final state.
  updateDraft(id: string, patch: ReportUpdatePatch): Report {
    const current = stmts().getById.get(id) as ReportRow | undefined;
    if (!current) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', `Report ${id} not found`));
    }
    const merged = patchToRow({
      findings: patch.findings ?? current.findings,
      diagnosis: patch.diagnosis ?? current.diagnosis,
      recommendations: patch.recommendations ?? current.recommendations,
      procedureDetails: patch.procedureDetails ?? current.procedure_details,
    });
    stmts().updateDraft.run({
      id,
      findings: merged.findings,
      diagnosis: merged.diagnosis,
      recommendations: merged.recommendations,
      procedure_details: merged.procedure_details,
      updated_at: Date.now(),
    });
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  // D-07 — same SET clause as updateDraft but gated on the finalized
  // status. finalize() must run before this is callable.
  updateFinalized(id: string, patch: ReportUpdatePatch): Report {
    const current = stmts().getById.get(id) as ReportRow | undefined;
    if (!current) {
      throw new IpcErrorException(ipcError('IPC_NOT_FOUND', `Report ${id} not found`));
    }
    const merged = patchToRow({
      findings: patch.findings ?? current.findings,
      diagnosis: patch.diagnosis ?? current.diagnosis,
      recommendations: patch.recommendations ?? current.recommendations,
      procedureDetails: patch.procedureDetails ?? current.procedure_details,
    });
    const info = stmts().updateFinalized.run({
      id,
      findings: merged.findings,
      diagnosis: merged.diagnosis,
      recommendations: merged.recommendations,
      procedure_details: merged.procedure_details,
      updated_at: Date.now(),
    });
    if (info.changes === 0) {
      throw new IpcErrorException(
        ipcError('IPC_VALIDATION', 'Report is not finalized'),
      );
    }
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  // D-06 — flips draft → finalized, stamps finalized_at. Idempotent only
  // in the no-op sense: a second finalize on the same row throws because
  // the status guard rejects rows that are already 'finalized'.
  finalize(id: string): Report {
    const info = stmts().finalize.run({ id, now: Date.now() });
    if (info.changes === 0) {
      throw new IpcErrorException(
        ipcError('IPC_NOT_FOUND', `Report ${id} not found or already finalized`),
      );
    }
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  setPdfPath(id: string, pdfPath: string): Report {
    stmts().setPdfPath.run({ id, pdf_path: pdfPath, now: Date.now() });
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },
};
