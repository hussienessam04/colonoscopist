import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcContract } from '@shared/ipc-contract';

const api: IpcContract = {
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('Failed to expose API to renderer:', error);
  }
} else {
  // @ts-expect-error - contextIsolation should be enabled; fallback for dev only
  window.api = api;
}
