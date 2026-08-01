// audit:* IPC handlers — read-only surface for Phase 7.
// Per AUDIT-01 + Fix 5.

import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { auditRepo } from '../db/audit';
import { auditFilterInput } from '@shared/validators';

export function registerAuditIpc(): void {
  ipcMain.handle(IPC.AUDIT_LIST, (_e, raw) => {
    const filter = auditFilterInput.parse(raw ?? {});
    return auditRepo.list(filter);
  });
}