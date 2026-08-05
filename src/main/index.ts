import { app } from 'electron';
import { createMainWindow } from './window';
import { registerAuthIpc } from './ipc/auth';
import { registerUsersIpc } from './ipc/users';
import { registerAuditIpc } from './ipc/audit';
import { registerPatientsIpc } from './ipc/patients';
import { registerCaptureIpc } from './ipc/capture';
import { registerProceduresIpc } from './ipc/procedures';
import { registerRecordingIpc } from './ipc/recording';
import { enumerateDshowDevices } from './capture/devices';
import { getDb, closeDb } from './db';
import { proceduresRepo } from './db/procedures-repo';
import { logStartup } from './startup-log';
import { initRecorder, scanForOrphans } from './recorder/init';
import { Recorder } from './recorder/recorder';

const APP_NAME = 'Colonoscopist';
const APP_USER_MODEL_ID = 'com.colonoscopist.app';

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let recorderSingleton: { newRecorder: () => Recorder } | null = null;

// per D-01 + AUDIT-01 — DB open + migrations BEFORE any IPC handler registration.
// Patients IPC registers AFTER auth/users/audit so admin gating + audit helpers exist when its handlers run.
// Capture IPC registers AFTER patients so the audit infrastructure is ready (per Phase 3 RESEARCH §Integration Points).
// Recorder init BEFORE the IPC registrations so the registry exists when handlers run.
app.whenReady().then(() => {
  getDb();
  const recorderModule = initRecorder();
  recorderSingleton = {
    newRecorder: () => recorderModule.newRecorder(),
  };
  registerAuthIpc();
  registerUsersIpc();
  registerAuditIpc();
  registerPatientsIpc();
  registerCaptureIpc();
  // Procedures IPC needs a way to insert a row on `procedures.create`; for
  // Phase 4 the canonical flow is `recording.start` which writes the row.
  // We expose a thin wrapper that round-trips through recording.start IPC
  // surface so the renderer can prepare an empty procedure if needed.
  registerProceduresIpc({
    createProcedure: ({ patientId, doctorId, presetSummary }) =>
      proceduresRepo.insert({
        patientId,
        doctorId,
        videoPath: '',
        presetSummary,
        audioDeviceName: null,
      }),
  });
  registerRecordingIpc({
    buildRecorder: () => recorderModule.newRecorder(),
  });
  logStartup('recording-ipc-registered');

  // Per CAPT-01 + D-10 — enumerate DirectShow devices once on launch. The
  // renderer still calls listDevices() on route entry; this keeps the boot
  // log honest and warms the ffmpeg-static load.
  void enumerateDshowDevices()
    .then((devices) => {
      logStartup(
        `capture-devices-enumerated:${JSON.stringify({ count: devices.length, first: devices[0]?.deviceId ?? null })}`,
      );
    })
    .catch((err: unknown) => {
      logStartup(`capture-devices-enumeration-failed:${(err as Error).message ?? 'unknown'}`);
    });

  void scanForOrphans()
    .then(() => logStartup('recorder-scan-orphans-ok'))
    .catch((err: unknown) =>
      logStartup(`recorder-scan-orphans-failed:${(err as Error).message ?? 'unknown'}`),
    );

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

// Used by tests in case they need to access the singleton.
export function __getRecorderSingleton(): { newRecorder: () => Recorder } | null {
  return recorderSingleton;
}