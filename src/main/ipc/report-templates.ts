// Report templates IPC — global saved-text library per box scope.
// Quick task 20260812-redesign-report — each box in the report editor
// can save its current text as a named template and later paste any
// saved template into the same scope. Workstation-wide (no per-doctor
// profile_id).
//
// Audit surface:
//   report.template_added
//   report.template_removed
//
// Validation gate: every payload is parsed through zod (per Phase 2
// Fix 5 + V5 Input Validation). requireSession() guards every
// handler — no public read or write without an authenticated session.

import { ipcMain } from 'electron';

import { IPC } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';

import {
  reportTemplateAddInput,
  reportTemplateScopeInput,
  reportTemplateIdInput,
} from '@shared/validators';
import { reportTemplatesRepo } from '../db/report-templates-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { licenseGated } from '../license';

function fromZodError(err: unknown, fallbackField?: string): IpcErrorException {
  const zErr = err as { issues?: { path: (string | number)[]; message: string }[] };
  const issue = zErr.issues?.[0];
  const field = (issue?.path[0] as string | undefined) ?? fallbackField;
  return new IpcErrorException(
    ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
  );
}

function safeParse<T>(schema: { parse: (v: unknown) => T }, raw: unknown, fallbackField?: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    throw fromZodError(err, fallbackField);
  }
}

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_AUTH_REQUIRED', 'Not authenticated'));
  }
  return id;
}

function asIpcError(err: unknown): Error {
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export function registerReportTemplatesIpc(): void {
  // Phase 8 / Plan 03 — wrap every handler with `licenseGated`.
  // REPORT_TEMPLATES_* are GATED; the saved-text-template library is
  // workstation-scoped state that's not worth carrying into an
  // unlicensed state.
  ipcMain.handle(IPC.REPORT_TEMPLATES_LIST_BY_SCOPE, licenseGated(IPC.REPORT_TEMPLATES_LIST_BY_SCOPE, (_e, raw) => {
    try {
      requireSession();
      const { scope } = safeParse(reportTemplateScopeInput, raw);
      return reportTemplatesRepo.listByScope(scope);
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORT_TEMPLATES_LIST_ALL, licenseGated(IPC.REPORT_TEMPLATES_LIST_ALL, (_e) => {
    try {
      requireSession();
      return reportTemplatesRepo.listAll();
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORT_TEMPLATES_ADD, licenseGated(IPC.REPORT_TEMPLATES_ADD, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(reportTemplateAddInput, raw);
      const created = reportTemplatesRepo.add(input);
      audit({
        action: 'report.template_added',
        entityType: 'report_template',
        entityId: created.id,
        userId,
        metadata: { scope: created.scope, label: created.label },
      });
      return created;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORT_TEMPLATES_REMOVE, licenseGated(IPC.REPORT_TEMPLATES_REMOVE, (_e, raw) => {
    try {
      const userId = requireSession();
      const { id } = safeParse(reportTemplateIdInput, raw);
      const result = reportTemplatesRepo.remove(id);
      audit({
        action: 'report.template_removed',
        entityType: 'report_template',
        entityId: id,
        userId,
      });
      return result;
    } catch (err) {
      throw asIpcError(err);
    }
  }));
}