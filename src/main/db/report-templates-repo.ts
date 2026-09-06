// report_text_templates table repository — global saved-text library.
//
// Quick task 20260812-redesign-report — each box in the report editor
// (esophagus / stomach / pylorus / duodenum / colon / ileum / conclusion /
// recommendation) can save its current text as a named template and
// later paste any saved template into the same scope. The library is
// workstation-wide (no per-doctor profile_id) per the user's design
// decision in the quick task.
//
// Schema invariant: UNIQUE(scope, label) — the same label under different
// scopes is fine (e.g. "Normal" in `colon` and "Normal" in `esophagus`),
// but the same label under the same scope is rejected at the SQLite
// boundary. The repo surfaces SQLITE_CONSTRAINT_UNIQUE as an
// IPC_VALIDATION error so the renderer's toast can tell the doctor to
// pick a different label.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';
import { IpcErrorException, ipcError } from '@shared/errors';

export const REPORT_BOX_SCOPES = [
  'esophagus',
  'stomach',
  'pylorus',
  'duodenum',
  'colon',
  'ileum',
  'conclusion',
  'recommendation',
] as const;
export type ReportTemplateScope = (typeof REPORT_BOX_SCOPES)[number];

export type ReportTemplateRow = {
  id: string;
  scope: ReportTemplateScope;
  label: string;
  body: string;
  created_at: number;
  updated_at: number;
};

export type ReportTemplate = {
  id: string;
  scope: ReportTemplateScope;
  label: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type ReportTemplateAddInput = {
  scope: ReportTemplateScope;
  label: string;
  body: string;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  listByScope: Stmt;
  listAll: Stmt;
  getById: Stmt;
  remove: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO report_text_templates
        (id, scope, label, body, created_at, updated_at)
       VALUES
        (@id, @scope, @label, @body, @now, @now)`,
    ),
    listByScope: db.prepare(
      `SELECT * FROM report_text_templates
       WHERE scope = ?
       ORDER BY label COLLATE NOCASE ASC`,
    ),
    listAll: db.prepare(
      `SELECT * FROM report_text_templates
       ORDER BY scope ASC, label COLLATE NOCASE ASC`,
    ),
    getById: db.prepare(`SELECT * FROM report_text_templates WHERE id = ?`),
    remove: db.prepare(`DELETE FROM report_text_templates WHERE id = ?`),
  };
  return cached;
}

export function __resetReportTemplatesRepoCache(): void {
  cached = null;
}

function rowToTemplate(row: ReportTemplateRow): ReportTemplate {
  return {
    id: row.id,
    scope: row.scope,
    label: row.label,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const reportTemplatesRepo = {
  listByScope(scope: ReportTemplateScope): ReportTemplate[] {
    const rows = stmts().listByScope.all(scope) as ReportTemplateRow[];
    return rows.map(rowToTemplate);
  },

  listAll(): ReportTemplate[] {
    const rows = stmts().listAll.all() as ReportTemplateRow[];
    return rows.map(rowToTemplate);
  },

  getById(id: string): ReportTemplate | null {
    const row = stmts().getById.get(id) as ReportTemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  },

  // Inserts a new template. UNIQUE(scope, label) is enforced by SQLite
  // — a duplicate under the same scope surfaces as IPC_VALIDATION with a
  // doctor-readable hint. No update path exists by design (the doctor's
  // "Save current as template" creates a fresh row; if they want to
  // rewrite, they delete + recreate).
  add(input: ReportTemplateAddInput): ReportTemplate {
    const id = randomUUID();
    const now = Date.now();
    try {
      stmts().insert.run({
        id,
        scope: input.scope,
        label: input.label,
        body: input.body,
        now,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new IpcErrorException(
          ipcError(
            'IPC_VALIDATION',
            `A template named "${input.label}" already exists for ${input.scope}`,
          ),
        );
      }
      throw err;
    }
    const row = stmts().getById.get(id) as ReportTemplateRow;
    return rowToTemplate(row);
  },

  remove(id: string): { ok: true } {
    stmts().remove.run(id);
    return { ok: true };
  },
};