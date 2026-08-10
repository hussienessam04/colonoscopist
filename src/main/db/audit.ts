// Audit log helper + read-only list (Phase 7 renders the page; Phase 2 ships the IPC).
// Per AUDIT-01 + AUDIT-02.

import type Database from 'better-sqlite3';
import { getDb } from './index';
import { session } from '../auth/session';

export type AuditInsertInput = {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  outcome?: 'ok' | 'failed' | 'rate_limited';
  userId?: string | null;
};

export type AuditListInput = {
  from?: number;
  to?: number;
  action?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
};

export type AuditListRow = {
  id: number;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: string | null;
  outcome: string;
  created_at: number;
};

let cached: {
  insert: Database.Statement;
  list: Database.Statement;
  count: Database.Statement;
} | null = null;

function stmts() {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, outcome, created_at)
       VALUES (@user_id, @action, @entity_type, @entity_id, @metadata, @outcome, @created_at)`,
    ),
    list: db.prepare(
      `SELECT id, user_id, action, entity_type, entity_id, metadata, outcome, created_at
       FROM audit_log
       WHERE (@from IS NULL OR created_at >= @from)
         AND (@to IS NULL OR created_at <= @to)
         AND (@action IS NULL OR action = @action)
         AND (@userId IS NULL OR user_id = @userId)
       ORDER BY created_at DESC, id DESC
       LIMIT @limit OFFSET @offset`,
    ),
    count: db.prepare(
      `SELECT COUNT(*) AS c
       FROM audit_log
       WHERE (@from IS NULL OR created_at >= @from)
         AND (@to IS NULL OR created_at <= @to)
         AND (@action IS NULL OR action = @action)
         AND (@userId IS NULL OR user_id = @userId)`,
    ),
  };
  return cached;
}

export function __resetAuditCache(): void {
  cached = null;
}

// Synchronous insert — better-sqlite3 is sync end-to-end.
// Per PITFALLS §Performance Traps: single-row inserts go outside transactions.
export function audit(opts: AuditInsertInput): void {
  const userId = opts.userId !== undefined ? opts.userId : session.currentUserId;
  const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;
  stmts().insert.run({
    user_id: userId,
    action: opts.action,
    entity_type: opts.entityType ?? null,
    entity_id: opts.entityId ?? null,
    metadata: metadataJson,
    outcome: opts.outcome ?? 'ok',
    created_at: Date.now(),
  });
}

// ponytail: same insert surfaced via the repo namespace so the
// AUDIT_LOG IPC handler can call `auditRepo.append(...)` instead of
// reaching into the free function. The shape mirrors AuditInsertInput
// verbatim (no behaviour change) — the IPC layer doesn't need to know
// about session defaults; it passes userId explicitly because
// `requireSession()` already proved the caller is authenticated.
const MAX_PAGE_SIZE = 200;

export const auditRepo = {
  // Append a single audit row. Mirrors the free `audit()` helper but
  // routes through the repo namespace so the AUDIT_LOG IPC handler
  // can use the same call shape as `auditRepo.list()`.
  append(opts: AuditInsertInput): void {
    const userId = opts.userId !== undefined ? opts.userId : session.currentUserId;
    const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;
    stmts().insert.run({
      user_id: userId,
      action: opts.action,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      metadata: metadataJson,
      outcome: opts.outcome ?? 'ok',
      created_at: Date.now(),
    });
  },
  list(filter: AuditListInput): { rows: AuditListRow[]; total: number } {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 50;
    const limit = Math.min(pageSize, MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;
    const rows = stmts().list.all({
      from: filter.from ?? null,
      to: filter.to ?? null,
      action: filter.action ?? null,
      userId: filter.userId ?? null,
      limit,
      offset,
    }) as AuditListRow[];
    const total = (stmts().count.get({
      from: filter.from ?? null,
      to: filter.to ?? null,
      action: filter.action ?? null,
      userId: filter.userId ?? null,
    }) as { c: number }).c;
    return { rows, total };
  },
};