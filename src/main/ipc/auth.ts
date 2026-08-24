// Auth IPC channels — 7 channels per Fix 7.
// Per AUTH-01/02/03/04 + D-01/04/05 + Fix 4/7.

import { ipcMain } from 'electron';
import { dialog } from 'electron';
import { IPC } from '@shared/ipc-contract';
import {
  acceptRecoveryFile,
  bootstrapStatus,
  listUsers,
  login,
  logout,
  recoveryRequest,
  status,
  wizardBootstrap,
} from '../auth';
import { wizardInput } from '@shared/validators';
import { IpcErrorException } from '@shared/errors';
import { licenseGated } from '../license';

export function registerAuthIpc(): void {
  // Phase 8 / Plan 03 — wrap every handler with `licenseGated(channel, ...)`.
  // AUTH_* channels are in EXEMPT_CHANNELS so the wrapper is a no-op
  // pass-through (the license state can never block login); the wrapper
  // is still applied for grep-gate consistency (Plan 06's grep gate
  // asserts every `ipcMain.handle` is wrapped).
  ipcMain.handle(IPC.AUTH_STATUS, licenseGated(IPC.AUTH_STATUS, () => status()));

  ipcMain.handle(IPC.AUTH_BOOTSTRAP, licenseGated(IPC.AUTH_BOOTSTRAP, () => bootstrapStatus()));

  ipcMain.handle(IPC.AUTH_LOGIN, licenseGated(IPC.AUTH_LOGIN, async (_e, raw) => {
    try {
      const result = await login({ userId: raw.userId, pin: raw.pin });
      return result;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.AUTH_LOGOUT, licenseGated(IPC.AUTH_LOGOUT, () => {
    try {
      return logout();
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.AUTH_USERS_LIST, licenseGated(IPC.AUTH_USERS_LIST, () => listUsers()));

  ipcMain.handle(IPC.AUTH_RECOVERY_REQUEST, licenseGated(IPC.AUTH_RECOVERY_REQUEST, () => {
    try {
      return recoveryRequest();
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.AUTH_ACCEPT_RECOVERY_FILE, licenseGated(IPC.AUTH_ACCEPT_RECOVERY_FILE, async () => {
    // per Fix 7 — main-side file picker, deferred verify in Phase 8.
    const { canceled } = await dialog.showOpenDialog({
      title: 'Select recovery file',
      properties: ['openFile'],
      filters: [{ name: 'Colonoscopist Recovery', extensions: ['recover'] }],
    });
    if (canceled) {
      // renderer treats cancellation as no-op; still return deferred shape.
      return { accepted: true, verificationDeferred: true };
    }
    try {
      return acceptRecoveryFile();
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // The USERS_CREATE / USERS_REMOVE / USERS_RESET_PIN handlers live in
  // src/main/ipc/users.ts (single registration — Electron's ipcMain.handle
  // rejects duplicates). Per D-03 + SET-04 admin gating is enforced in
  // src/main/auth/index.ts.

  // Wizard bootstrap lives here so the 4-step submit on first launch uses
  // the same IPC namespace as login. Per D-01.
  ipcMain.handle(IPC.AUTH_WIZARD, licenseGated(IPC.AUTH_WIZARD, async (_e, raw) => {
    const parsed = wizardInput.parse(raw);
    try {
      return await wizardBootstrap(parsed);
    } catch (err) {
      throw asIpcError(err);
    }
  }));
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