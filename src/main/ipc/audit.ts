// audit:* IPC handlers — read-only surface for Phase 7.
// Per AUDIT-01 + Fix 5.
//
// Phase 7 / Plan 07-01 — adds AUDIT_LOG: the renderer-initiated audit
// row write channel for "audit-on-every-read" patterns (D-08). The
// handler routes through the existing audit() helper in db/audit.ts;
// no other write surface exists for audit_log (Phase 2's append-only
// triggers reject UPDATE/DELETE).

import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import type { AuditEntry } from '@shared/ipc-contract';
import { auditRepo, type AuditListRow } from '../db/audit';
import { auditFilterInput, auditLogInput } from '@shared/validators';
import { session } from '../auth/session';
import { IpcErrorException, ipcError } from '@shared/errors';
import { licenseGated } from '../license';
import { z } from 'zod';

// ponytail: copied from patients.ts + auth.ts — same gate shape across
// all authenticated IPC handlers. Inline rather than a shared helper
// because the imports would create a circular module graph.
function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_AUTH_REQUIRED', 'Not authenticated'));
  }
  return id;
}

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

// ponytail: map snake_case DB rows → camelCase IPC contract.
// The audit_log table stores metadata as a JSON-encoded TEXT column
// (nullable). Parse defensively — a corrupt row should NOT crash the
// handler; fall back to the raw string with an `_parseError` flag so
// the UI can surface "this row has malformed metadata" instead of the
// whole audit page failing to load.
function toAuditEntry(row: AuditListRow): AuditEntry {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata !== null) {
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      metadata =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
    } catch {
      metadata = { _parseError: true, _raw: row.metadata };
    }
  }
  // ponytail: clamp outcome to the contract union — older rows may have
  // unconstrained strings.
  const outcome: AuditEntry['outcome'] =
    row.outcome === 'failed' || row.outcome === 'rate_limited' ? row.outcome : 'ok';
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata,
    outcome,
    createdAt: row.created_at,
  };
}

export function registerAuditIpc(): void {
  // Phase 8 / Plan 03 — audit channels are EXEMPT (per CONTEXT D-08: the
  // audit-on-every-read pattern continues regardless of license state).
  // The wrapper is applied anyway for grep-gate consistency.
  ipcMain.handle(IPC.AUDIT_LIST, licenseGated(IPC.AUDIT_LIST, (_e, raw) => {
    const filter = auditFilterInput.parse(raw ?? {});
    const { rows, total } = auditRepo.list(filter);
    return { rows: rows.map(toAuditEntry), total };
  }));

  // AUDIT-01 / D-08 — renderer-side "audit-on-every-read" channel.
  // Requires a session (writes the row's user_id from session.currentUserId
  // unless the caller explicitly passes a different one — but per Phase 2
  // BLOCKER 4, the schema does NOT expose a userId field; session is the
  // single source of truth for who is performing the action).
  ipcMain.handle(IPC.AUDIT_LOG, licenseGated(IPC.AUDIT_LOG, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(auditLogInput, raw);
      auditRepo.append({
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? null,
        userId,
      });
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  }));
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