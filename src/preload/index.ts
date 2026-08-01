import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcContract } from '@shared/ipc-contract';

const api: IpcContract = {
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
    bootstrap: () => ipcRenderer.invoke(IPC.AUTH_BOOTSTRAP),
    login: (input) => ipcRenderer.invoke(IPC.AUTH_LOGIN, input),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    usersList: () => ipcRenderer.invoke(IPC.AUTH_USERS_LIST),
    recoveryRequest: () => ipcRenderer.invoke(IPC.AUTH_RECOVERY_REQUEST),
    acceptRecoveryFile: () => ipcRenderer.invoke(IPC.AUTH_ACCEPT_RECOVERY_FILE),
  },
  users: {
    create: (input) => ipcRenderer.invoke(IPC.USERS_CREATE, input),
    remove: (input) => ipcRenderer.invoke(IPC.USERS_REMOVE, input),
    resetPin: (input) => ipcRenderer.invoke(IPC.USERS_RESET_PIN, input),
  },
  patients: {
    list: (query) => ipcRenderer.invoke(IPC.PATIENTS_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC.PATIENTS_GET, id),
    create: (input) => ipcRenderer.invoke(IPC.PATIENTS_CREATE, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.PATIENTS_UPDATE, id, patch),
    softDelete: (id) => ipcRenderer.invoke(IPC.PATIENTS_SOFT_DELETE, id),
    restore: (id) => ipcRenderer.invoke(IPC.PATIENTS_RESTORE, id),
  },
  audit: {
    list: (query) => ipcRenderer.invoke(IPC.AUDIT_LIST, query),
  },
};

try {
  contextBridge.exposeInMainWorld('api', api);
} catch (error) {
  // Phase 1 ships a hardened renderer (contextIsolation: true). The expose call
  // must succeed; failure here means the BrowserWindow webPreferences drifted.
  console.error('Failed to expose API to renderer:', error);
}