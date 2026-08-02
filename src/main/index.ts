import { app } from 'electron';
import { createMainWindow } from './window';
import { registerAuthIpc } from './ipc/auth';
import { registerUsersIpc } from './ipc/users';
import { registerAuditIpc } from './ipc/audit';
import { registerPatientsIpc } from './ipc/patients';
import { registerCaptureIpc } from './ipc/capture';
import { enumerateDshowDevices } from './capture/devices';
import { getDb, closeDb } from './db';
import { logStartup } from './startup-log';

const APP_NAME = 'Colonoscopist';
const APP_USER_MODEL_ID = 'com.colonoscopist.app';

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// per D-01 + AUDIT-01 — DB open + migrations BEFORE any IPC handler registration.
// patients IPC registers AFTER auth/users/audit so admin gating + audit helpers exist when its handlers run.
// capture IPC registers AFTER patients so the audit infrastructure is ready (per Phase 3 RESEARCH §Integration Points).
app.whenReady().then(() => {
  getDb();
  registerAuthIpc();
  registerUsersIpc();
  registerAuditIpc();
  registerPatientsIpc();
  registerCaptureIpc();
  logStartup('capture-ipc-registered');

  // Per CAPT-01 + D-10 — enumerate DirectShow devices once on launch. The
  // renderer still calls listDevices() on route entry; this keeps the boot
  // log honest and warms the ffmpeg-static load.
  void enumerateDshowDevices()
    .then((devices) => {
      logStartup(`capture-devices-enumerated:${JSON.stringify({ count: devices.length, first: devices[0]?.deviceId ?? null })}`);
    })
    .catch((err: unknown) => {
      logStartup(`capture-devices-enumeration-failed:${(err as Error).message ?? 'unknown'}`);
    });

  createMainWindow();
  logStartup('app-ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  closeDb();
});