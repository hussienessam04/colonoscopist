import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcContract } from '@shared/ipc-contract';

// IpcContract bridge exposed via contextBridge.exposeInMainWorld('api', api).
// Renderer is sandboxed; every method is ipcRenderer.invoke(IPC.X, ...args) against the
// matching IPC constant. No extra surface (per Fix 4 — auth.status + auth.login channels
// pinned consistently with Plan 02-01).
const api: IpcContract = {
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
    bootstrap: () => ipcRenderer.invoke(IPC.AUTH_BOOTSTRAP),
    wizard: (input) => ipcRenderer.invoke(IPC.AUTH_WIZARD, input),
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
    // Main handler reads { id, patch } as one arg; wrap so the IpcContract signature stays
    // ergonomic (id, patch).
    update: (id, patch) => ipcRenderer.invoke(IPC.PATIENTS_UPDATE, { id, patch }),
    softDelete: (id) => ipcRenderer.invoke(IPC.PATIENTS_SOFT_DELETE, id),
    restore: (id) => ipcRenderer.invoke(IPC.PATIENTS_RESTORE, id),
  },
  audit: {
    list: (query) => ipcRenderer.invoke(IPC.AUDIT_LIST, query),
  },
  capture: {
    listDevices: () => ipcRenderer.invoke(IPC.CAPTURE_LIST_DEVICES),
    getDefaultDevice: () => ipcRenderer.invoke(IPC.CAPTURE_GET_DEFAULT_DEVICE),
    setDefaultDevice: (input) => ipcRenderer.invoke(IPC.CAPTURE_SET_DEFAULT_DEVICE, input),
    getPreset: (input) => ipcRenderer.invoke(IPC.CAPTURE_GET_PRESET, input),
    setPreset: (input) => ipcRenderer.invoke(IPC.CAPTURE_SET_PRESET, input),
    noDeviceAudit: () => ipcRenderer.invoke(IPC.CAPTURE_NO_DEVICE_AUDIT),
  },
};

try {
  contextBridge.exposeInMainWorld('api', api);
} catch (error) {
  // Phase 1 ships a hardened renderer (contextIsolation: true). The expose call
  // must succeed; failure here means the BrowserWindow webPreferences drifted.
  console.error('Failed to expose API to renderer:', error);
}
