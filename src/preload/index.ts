import { contextBridge, ipcRenderer, type IpcRenderer } from 'electron';
import { IPC, type IpcContract, type RecordingStatus } from '@shared/ipc-contract';

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
    // Phase 7 / Plan 07-01 — AUDIT-01: renderer-initiated audit row
    // for "audit-on-every-read" patterns (D-08). The handler routes
    // through the audit() helper in main; no other write surface
    // exists for audit_log.
    log: (input) => ipcRenderer.invoke(IPC.AUDIT_LOG, input),
  },
  capture: {
    listDevices: () => ipcRenderer.invoke(IPC.CAPTURE_LIST_DEVICES),
    getDefaultDevice: () => ipcRenderer.invoke(IPC.CAPTURE_GET_DEFAULT_DEVICE),
    setDefaultDevice: (input) => ipcRenderer.invoke(IPC.CAPTURE_SET_DEFAULT_DEVICE, input),
    getPreset: (input) => ipcRenderer.invoke(IPC.CAPTURE_GET_PRESET, input),
    setPreset: (input) => ipcRenderer.invoke(IPC.CAPTURE_SET_PRESET, input),
    noDeviceAudit: () => ipcRenderer.invoke(IPC.CAPTURE_NO_DEVICE_AUDIT),
  },
  procedures: {
    create: (input) => ipcRenderer.invoke(IPC.PROCEDURES_CREATE, input),
    get: (input) => ipcRenderer.invoke(IPC.PROCEDURES_GET, input),
    list: (input) => ipcRenderer.invoke(IPC.PROCEDURES_LIST, input),
    finalize: (input) => ipcRenderer.invoke(IPC.PROCEDURES_FINALIZE, input),
    // Plan 01 — trim/restore throw IPC_NOT_IMPLEMENTED; Plan 03 fills the
    // handlers. The preload bridge exposes the channel so the renderer
    // contract surface doesn't shift between plans.
    trim: (input) => ipcRenderer.invoke(IPC.PROCEDURES_TRIM, input),
    restore: (input) => ipcRenderer.invoke(IPC.PROCEDURES_RESTORE, input),
    // Plan 02 — pause-marker source for the review scrubber.
    listSegments: (input) => ipcRenderer.invoke(IPC.PROCEDURES_LIST_SEGMENTS, input),
  },
  // Plan 02-of-phase-04 fills the main handlers; preload bridge is final here
  // so the renderer contract never needs to change shape.
  procedureNotes: {
    create: (input) => ipcRenderer.invoke(IPC.PROCEDURE_NOTES_CREATE, input),
    list: (input) => ipcRenderer.invoke(IPC.PROCEDURE_NOTES_LIST, input),
  },
  recording: {
    start: (input) => ipcRenderer.invoke(IPC.RECORDING_START, input),
    stop: (input) => ipcRenderer.invoke(IPC.RECORDING_STOP, input),
    pause: (input) => ipcRenderer.invoke(IPC.RECORDING_PAUSE, input),
    resume: (input) => ipcRenderer.invoke(IPC.RECORDING_RESUME, input),
    forceCleanup: (input) => ipcRenderer.invoke(IPC.RECORDING_FORCE_CLEANUP, input),
    onStatus(cb: (status: RecordingStatus) => void): () => void {
      // The renderer is a single-window app; a single global listener is fine
      // for now. Returns an unsubscribe closure.
      const listener = (_event: unknown, status: RecordingStatus): void => cb(status);
      (ipcRenderer as IpcRenderer).on(IPC.RECORDING_STATUS, listener);
      return () => {
        (ipcRenderer as unknown as { removeListener: (ch: string, l: unknown) => void }).removeListener(
          IPC.RECORDING_STATUS,
          listener,
        );
      };
    },
    // Plan 03 — long-lived media server URL for the renderer's <video>.
    getMediaUrl: () => ipcRenderer.invoke(IPC.RECORDING_GET_MEDIA_URL),
  },
  // Phase 5 / Plan 01 — screenshot IPC. `add` carries the JPEG inline as
  // base64 to avoid an extra multipart upload via the preview server.
  screenshots: {
    add: (input) => ipcRenderer.invoke(IPC.SCREENSHOTS_ADD, input),
    list: (input) => ipcRenderer.invoke(IPC.SCREENSHOTS_LIST, input),
    delete: (input) => ipcRenderer.invoke(IPC.SCREENSHOTS_DELETE, input),
    updateAnnotation: (input) =>
      ipcRenderer.invoke(IPC.SCREENSHOTS_UPDATE_ANNOTATION, input),
  },
  // Phase 6 / Plan 01 — Doctor profile IPC. `get` reads the row keyed by
  // the active session; `update` writes the bilingual name/clinic/contact
  // fields. The renderer's ProfileEditor page (Plan 06-02) will consume this.
  profile: {
    get: () => ipcRenderer.invoke(IPC.PROFILE_GET),
    update: (input) => ipcRenderer.invoke(IPC.PROFILE_UPDATE, input),
    uploadSignature: (input) =>
      ipcRenderer.invoke(IPC.PROFILE_UPLOAD_SIGNATURE, input),
    uploadLogo: (input) => ipcRenderer.invoke(IPC.PROFILE_UPLOAD_LOGO, input),
    // Quick task 260812-ns0 — header / footer image uploads render as
    // the top / bottom band on every PDF page.
    uploadHeader: (input) =>
      ipcRenderer.invoke(IPC.PROFILE_UPLOAD_HEADER, input),
    uploadFooter: (input) =>
      ipcRenderer.invoke(IPC.PROFILE_UPLOAD_FOOTER, input),
    getAssetDataUrl: (input) =>
      ipcRenderer.invoke(IPC.PROFILE_GET_ASSET_DATA_URL, input),
  },
  // Quick task 260812-ns0 — used-devices CRUD (1:N with doctor_profile).
  usedDevices: {
    list: () => ipcRenderer.invoke(IPC.USED_DEVICES_LIST),
    add: (input) => ipcRenderer.invoke(IPC.USED_DEVICES_ADD, input),
    remove: (input) => ipcRenderer.invoke(IPC.USED_DEVICES_REMOVE, input),
  },
  // Phase 6 / Plan 01 — Reports IPC. `getOrCreate` is the renderer's
  // entry point for the report editor (1:1 reports-per-procedure per
  // CONTEXT.md D-05). Plan 06-02 wires the renderer pages that consume this.
  reports: {
    getOrCreate: (input) => ipcRenderer.invoke(IPC.REPORTS_GET_OR_CREATE, input),
    get: (input) => ipcRenderer.invoke(IPC.REPORTS_GET, input),
    // Phase 7 / Plan 07-02 — read-only lookup by procedureId (no draft creation).
    // Returns null when no report exists for the procedure; consumed by the
    // Patient List accordion expansion (SRCH-03).
    getByProcedure: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_GET_BY_PROCEDURE, input),
    updateDraft: (input) => ipcRenderer.invoke(IPC.REPORTS_UPDATE_DRAFT, input),
    updateFinalized: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_UPDATE_FINALIZED, input),
    finalize: (input) => ipcRenderer.invoke(IPC.REPORTS_FINALIZE, input),
    regenPdf: (input) => ipcRenderer.invoke(IPC.REPORTS_REGEN_PDF, input),
    openPdf: (input) => ipcRenderer.invoke(IPC.REPORTS_OPEN_PDF, input),
    getPdfBlob: (input) => ipcRenderer.invoke(IPC.REPORTS_GET_PDF_BLOB, input),
    attachScreenshot: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_ATTACH_SCREENSHOT, input),
    detachScreenshot: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_DETACH_SCREENSHOT, input),
    reorderScreenshots: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_REORDER_SCREENSHOTS, input),
    listScreenshots: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_LIST_SCREENSHOTS, input),
  },
  // Phase 7 / Plan 07-01 — Backup/Restore bridge (SET-05, SET-06).
  // The handlers in src/main/ipc/backup.ts + restore.ts own all
  // filesystem writes; the renderer is sandboxed (Phase 1 security
  // baseline) so it cannot pass arbitrary native paths beyond what the
  // user picks via Electron's dialog.showSaveDialog in Plan 07-05.
  //
  // Phase 7 / Plan 07-05 — D-11 / D-13 verbatim: pickDestination +
  // pickZip + revealStaging are the only legitimate way for the
  // renderer to obtain absolute paths that reach the create/preview/
  // unpack handlers. The renderer never composes paths itself.
  backup: {
    create: (input) => ipcRenderer.invoke(IPC.BACKUP_CREATE, input),
    reveal: (input) => ipcRenderer.invoke(IPC.BACKUP_REVEAL, input),
    pickDestination: () => ipcRenderer.invoke(IPC.BACKUP_PICK_DESTINATION),
  },
  restore: {
    preview: (input) => ipcRenderer.invoke(IPC.RESTORE_PREVIEW, input),
    unpack: (input) => ipcRenderer.invoke(IPC.RESTORE_UNPACK, input),
    pickZip: () => ipcRenderer.invoke(IPC.RESTORE_PICK_ZIP),
    revealStaging: (input) => ipcRenderer.invoke(IPC.RESTORE_REVEAL_STAGING, input),
  },
};

try {
  contextBridge.exposeInMainWorld('api', api);
} catch (error) {
  // Phase 1 ships a hardened renderer (contextIsolation: true). The expose call
  // must succeed; failure here means the BrowserWindow webPreferences drifted.
  console.error('Failed to expose API to renderer:', error);
}