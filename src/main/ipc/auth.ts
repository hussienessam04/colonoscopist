// Auth IPC channels — 7 channels per Fix 7.
// Per AUTH-01/02/03/04 + D-01/04/05 + Fix 4/7.

import { ipcMain } from 'electron';
import { dialog } from 'electron';
import { IPC } from '@shared/ipc-contract';
import {
  acceptRecoveryFile,
  bootstrapStatus,
  createUser,
  listUsers,
  login,
  logout,
  recoveryRequest,
  removeUser,
  resetPin,
  status,
  wizardBootstrap,
} from '../auth';
import { resetPinInput, userInput, userRemoveInput, wizardInput } from '@shared/validators';
import { IpcErrorException } from '@shared/errors';

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.AUTH_STATUS, () => status());

  ipcMain.handle(IPC.AUTH_BOOTSTRAP, () => bootstrapStatus());

  ipcMain.handle(IPC.AUTH_LOGIN, async (_e, raw) => {
    try {
      const result = await login({ userId: raw.userId, pin: raw.pin });
      return result;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.AUTH_LOGOUT, () => {
    try {
      return logout();
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.AUTH_USERS_LIST, () => listUsers());

  ipcMain.handle(IPC.AUTH_RECOVERY_REQUEST, () => {
    try {
      return recoveryRequest();
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.AUTH_ACCEPT_RECOVERY_FILE, async () => {
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
  });

  // The 8 user-management channels live in src/main/ipc/users.ts.
  // We also wire createUser/removeUser/resetPin through auth.ts as a convenience
  // because both modules share IPC namespace; concrete handlers below use the
  // matching auth.* funcs so admin gating stays in one place.
  ipcMain.handle(IPC.USERS_CREATE, async (_e, raw) => {
    const parsed = userInput.parse(raw);
    try {
      return await createUser(parsed);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.USERS_REMOVE, (_e, raw) => {
    const parsed = userRemoveInput.parse(raw);
    try {
      return removeUser(parsed);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.USERS_RESET_PIN, async (_e, raw) => {
    const parsed = resetPinInput.parse(raw);
    try {
      return await resetPin(parsed);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  // Wizard bootstrap lives here so the 4-step submit on first launch uses
  // the same IPC namespace as login. Per D-01.
  ipcMain.handle('auth:wizard-bootstrap', async (_e, raw) => {
    const parsed = wizardInput.parse(raw);
    try {
      return await wizardBootstrap(parsed);
    } catch (err) {
      throw asIpcError(err);
    }
  });
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