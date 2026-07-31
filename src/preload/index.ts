import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcContract } from '@shared/ipc-contract';

const api: IpcContract = {
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
  },
};

try {
  contextBridge.exposeInMainWorld('api', api);
} catch (error) {
  // Phase 1 ships a hardened renderer (contextIsolation: true). The expose call
  // must succeed; failure here means the BrowserWindow webPreferences drifted.
  console.error('Failed to expose API to renderer:', error);
}
