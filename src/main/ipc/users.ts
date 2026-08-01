// users:* IPC handlers — admin-gated per D-03 + SET-04.
// The user-create / remove / resetPin handlers are also registered in ipc/auth.ts
// for historical reasons; this module exists so the per-handler admin gate is
// testable in isolation. Both registrations call the same auth funcs.

import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { createUser, removeUser, resetPin } from '../auth';
import { resetPinInput, userInput, userRemoveInput } from '@shared/validators';
import { IpcErrorException } from '@shared/errors';

export function registerUsersIpc(): void {
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