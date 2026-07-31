import { ipcMain } from 'electron';
import { IPC, type AuthStatus } from '@shared/ipc-contract';

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.AUTH_STATUS, (): AuthStatus => ({
    authenticated: false,
    reason: 'scaffold',
  }));
}
