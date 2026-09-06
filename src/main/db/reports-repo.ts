// reports table repository — cached prepared statements only.
// Per CONTEXT.md D-05 (1:1 reports-per-procedure, UNIQUE on procedure_id)
// + D-06 (finalize freezes finalized_at; subsequent edits bump updated_at)
// + D-07 (post-finalize edits allowed but limited to the 8 free-text
// box columns via per-column UPDATE guarded by
// `status='finalized' AND finalized_at IS NOT NULL`).
// + D-08 (no role gate at the data layer — any signed-in doctor can edit
// a finalized report; the role check is intentionally absent).
//
// Quick task 20260812-redesign-report — replaces the old 4-column shape
// (findings/diagnosis/recommendations/procedureDetails) with 8
// procedure-type-specific boxes + procedure_type + instrument +
// premedication_override. procedure_type is set ONCE on first edit via
// setProcedureType (gated on the empty-state invariant:
// procedure_type still 'colon' AND every box column = '').

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';
import { IpcErrorException, ipcError } from '@shared/errors';
import type { Report } from '@shared/ipc-contract';

const BOX_FIELDS = [
  'esophagus',
  'stomach',
  'pylorus',
  'duodenum',
  'colon',
  'ileum',
  'conclusion',
  'recommendation',
] as const;
type BoxField = (typeof BOX_FIELDS)[number];

export type ReportRow = {
  id: string;
  procedure_id: string;
  doctor_id: string;
  procedure_type: 'colon' | 'upper_gi';
  instrument: string | null;
  premedication_override: string | null;
  esophagus: string;
  stomach: string;
  pylorus: string;
  duodenum: string;
  colon: string;
  ileum: string;
  conclusion: string;
  recommendation: string;
  status: 'draft' | 'finalized';
  finalized_at: number | null;
  pdf_path: string | null;
  pdf_generated_at: number | null;
  created_at: number;
  updated_at: number;
};

export type ReportUpdatePatch = Partial<{
  esophagus: string;
  stomach: string;
  pylorus: string;
  duodenum: string;
  colon: string;
  ileum: string;
  conclusion: string;
  recommendation: string;
}>;

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  getById: Stmt;
  getByProcedure: Stmt;
  updateDraft: Stmt;
  updateFinalized: Stmt;
  finalize: Stmt;
  setPdfPath: Stmt;
  setProcedureType: Stmt;
  setInstrument: Stmt;
  setPremedicationOverride: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO reports
        (id, procedure_id, doctor_id, procedure_type, instrument,
         premedication_override, esophagus, stomach, pylorus, duodenum,
         colon, ileum, conclusion, recommendation, status,
         finalized_at, pdf_path, pdf_generated_at, created_at, updated_at)
       VALUES
        (@id, @procedure_id, @doctor_id, 'colon', NULL, NULL,
         '', '', '', '', '', '', '', '', 'draft',
         NULL, NULL, NULL, @now, @now)`,
    ),
    getById: db.prepare(`SELECT * FROM reports WHERE id = ?`),
    getByProcedure: db.prepare(`SELECT * FROM reports WHERE procedure_id = ?`),
    // D-07 — only the 8 box fields land in the SET clause; procedure_id
    // / doctor_id / finalized_at / created_at are immutable post-insert.
    // The `status='draft'` guard makes the UPDATE a no-op once finalized,
    // routing subsequent edits to updateFinalized via the IPC handler.
    updateDraft: db.prepare(
      `UPDATE reports SET
         esophagus      = @esophagus,
         stomach        = @stomach,
         pylorus        = @pylorus,
         duodenum       = @duodenum,
         colon          = @colon,
         ileum          = @ileum,
         conclusion     = @conclusion,
         recommendation = @recommendation,
         updated_at     = @updated_at
       WHERE id = @id AND status = 'draft'`,
    ),
    updateFinalized: db.prepare(
      `UPDATE reports SET
         esophagus      = @esophagus,
         stomach        = @stomach,
         pylorus        = @pylorus,
         duodenum       = @duodenum,
         colon          = @colon,
         ileum          = @ileum,
         conclusion     = @conclusion,
         recommendation = @recommendation,
         updated_at     = @updated_at
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
    // Quick task 20260812-redesign-report — procedure_type is set ONCE
    // on first edit. The empty-state invariant (procedure_type still
    // 'colon' AND every box = '') makes the UPDATE a no-op once the
    // Quick task 20260906-report-editor-polish — the procedure-type
    // toggle is now free (no SQL guard). The doctor can flip the
    // type at any time, even after typing in boxes; the renderer
    // re-renders against the new anatomy set on the next paint.
    setProcedureType: db.prepare(
      `UPDATE reports SET procedure_type = @procedure_type, updated_at = @now
       WHERE id = @id`,
    ),
    setInstrument: db.prepare(
      `UPDATE reports SET instrument = @instrument, updated_at = @now
       WHERE id = @id`,
    ),
    setPremedicationOverride: db.prepare(
      `UPDATE reports SET premedication_override = @override, updated_at = @now
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
    procedureType: row.procedure_type,
    instrument: row.instrument,
    premedicationOverride: row.premedication_override,
    esophagus: row.esophagus,
    stomach: row.stomach,
    pylorus: row.pylorus,
    duodenum: row.duodenum,
    colon: row.colon,
    ileum: row.ileum,
    conclusion: row.conclusion,
    recommendation: row.recommendation,
    status: row.status,
    finalizedAt: row.finalized_at,
    pdfPath: row.pdf_path,
    pdfGeneratedAt: row.pdf_generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function patchToRow(
  patch: ReportUpdatePatch,
  current: ReportRow,
): Record<BoxField, string> {
  const merged = { ...current } as unknown as Record<BoxField, string>;
  for (const k of BOX_FIELDS) {
    const incoming = patch[k];
    merged[k] = incoming ?? current[k];
  }
  return merged;
}

export const reportsRepo = {
  // D-05 — 1:1 with procedure. If a row already exists, returns it; the
  // UNIQUE(procedure_id) constraint protects against double-insert. The
  // inserted row's status defaults to 'draft' with empty box columns +
  // procedure_type='colon' (the default per migration 0010).
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
    const merged = patchToRow(patch, current);
    stmts().updateDraft.run({
      id,
      ...merged,
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
    const merged = patchToRow(patch, current);
    const info = stmts().updateFinalized.run({
      id,
      ...merged,
      updated_at: Date.now(),
    });
    if (info.changes === 0) {
      throw new IpcErrorException(
        ipcError('IPC_VALIDATION', 'Report is not finalized'),
      );
    }
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  // D-06 — flips draft → finalized, stamps finalized_at.
  // Quick task 20260906-finalize-idempotent — made idempotent.
  // The renderer calls `finalize` then `regenPdf` sequentially; if
  // the doctor clicks Back between the two calls, the row lands in
  // `status='finalized', pdfPath=null` (half-finalized). When the
  // doctor re-enters and clicks Finalize again, the old code threw
  // "already finalized" and the report was stuck until something
  // else triggered a regenPdf. Idempotent finalize: rows in
  // 'finalized' state no-op the UPDATE and return the existing row
  // so the renderer's `regenPdf` call writes the PDF and the
  // report recovers. Throws only when the row truly doesn't exist.
  finalize(id: string): Report {
    const current = stmts().getById.get(id) as ReportRow | undefined;
    if (current === undefined) {
      throw new IpcErrorException(
        ipcError('IPC_NOT_FOUND', `Report ${id} not found`),
      );
    }
    if (current.status === 'draft') {
      stmts().finalize.run({ id, now: Date.now() });
    }
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  setPdfPath(id: string, pdfPath: string): Report {
    stmts().setPdfPath.run({ id, pdf_path: pdfPath, now: Date.now() });
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  // Quick task 20260812-redesign-report — procedure_type is set ONCE.
  // SQL guard: succeeds only if procedure_type is still 'colon' AND
  // Quick task 20260906-report-editor-polish — procedure type is
  // free to toggle at any time. No SQL guard, no IPC_VALIDATION
  // throw. If the row doesn't exist, the UPDATE is a no-op (info.changes === 0)
  // and we throw IPC_NOT_FOUND for the caller's benefit.
  setProcedureType(id: string, procedureType: 'colon' | 'upper_gi'): Report {
    const info = stmts().setProcedureType.run({
      id,
      procedure_type: procedureType,
      now: Date.now(),
    });
    if (info.changes === 0) {
      throw new IpcErrorException(
        ipcError('IPC_NOT_FOUND', `Report ${id} not found`),
      );
    }
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  setInstrument(id: string, instrument: string | null): Report {
    stmts().setInstrument.run({ id, instrument, now: Date.now() });
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },

  setPremedicationOverride(id: string, override: string | null): Report {
    stmts().setPremedicationOverride.run({ id, override, now: Date.now() });
    return rowToReport(stmts().getById.get(id) as ReportRow);
  },
};

export { BOX_FIELDS };
export type { BoxField };
