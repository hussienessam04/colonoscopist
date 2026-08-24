import { app } from 'electron';
import { createMainWindow } from './window';
import { registerAuthIpc } from './ipc/auth';
import { registerUsersIpc } from './ipc/users';
import { registerAuditIpc } from './ipc/audit';
import { registerPatientsIpc } from './ipc/patients';
import { registerCaptureIpc } from './ipc/capture';
import { registerProceduresIpc } from './ipc/procedures';
import { registerRecordingIpc } from './ipc/recording';
import { registerScreenshotsIpc } from './ipc/screenshots';
import { registerProfileIpc } from './ipc/profile';
import { registerUsedDevicesIpc } from './ipc/used-devices';
import { registerReportsIpc } from './ipc/reports';
// Quick task 20260812-redesign-report — global saved-text-templates
// library for each report box. Registered AFTER registerReportsIpc()
// so the same session store is initialized.
import { registerReportTemplatesIpc } from './ipc/report-templates';
import { registerBackupIpc } from './ipc/backup';
import { registerRestoreIpc } from './ipc/restore';
import { registerLicenseIpc } from './ipc/license';
import { enumerateDshowDevices } from './capture/devices';
import { getDb, closeDb } from './db';
import { proceduresRepo } from './db/procedures-repo';
import { logStartup } from './startup-log';
import {
  initMediaServer,
  initRecorder,
  scanForOrphans,
  shutdownMediaServer,
} from './recorder/init';
import { Recorder } from './recorder/recorder';
import { getLicenseStatus } from './license';

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
  // Phase 8 / Plan 01 — license IPC must register BEFORE every other
  // handler so LICENSE_STATUS + LICENSE_ACTIVATE are exempt from the
  // gate (Plan 03 ships the gate). Warming the cache here means the
  // renderer's first `license.status()` IPC call returns instantly
  // instead of paying the verify cost on the renderer hot path.
  registerLicenseIpc();
  void getLicenseStatus()
    .then(() => logStartup('license-status-cached'))
    .catch((err: unknown) =>
      logStartup(`license-status-cache-failed:${(err as Error).message ?? 'unknown'}`),
    );
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
  // Phase 5 / Plan 01 — screenshots handler set. Trim/restore are stubbed
  // inside registerProceduresIpc — see that file. Migration 0003 applies
  // on db open above.
  registerScreenshotsIpc();
  // Phase 6 / Plan 01 — Doctor profile + reports IPC. Profile must
  // register BEFORE reports (no functional dependency, but the wizard
  // flow creates a `users` row then the first admin's profile row —
  // profile handlers don't need anything reports handlers don't already
  // have, but the canonical ordering keeps the surface coherent).
  registerProfileIpc();
  // Quick task 260812-ns0 — used-devices CRUD IPC surface.
  registerUsedDevicesIpc();
  registerReportsIpc();
  // Quick task 20260812-redesign-report — saved-text-templates IPC.
  registerReportTemplatesIpc();
  // Phase 7 / Plan 07-01 — Backup/Restore IPC (SET-05, SET-06).
  // Must register AFTER registerAuthIpc() so `requireSession()` resolves.
  registerBackupIpc();
  registerRestoreIpc();
  // Phase 5 / Plan 03 — boot the long-lived MediaServer so the renderer's
  // <video> element can compose `/media/<patientId>/<procedureId>/<file>`
  // URLs against `recording.getMediaUrl()`. The server stays bound across
  // ProcedureReview sessions; shutdown is wired to `will-quit` below.
  void initMediaServer()
    .then(() => logStartup('media-server-started'))
    .catch((err: unknown) => {
      logStartup(
        `media-server-start-failed:${(err as Error).message ?? 'unknown'}`,
      );
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

  void scanForOrphans();

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
  // ponytail: best-effort shutdown. The MediaServer's stop() is idempotent
  // (no-op if the server never started), so a failed boot doesn't matter
  // here — the catch in app.whenReady() already logged the failure.
  void shutdownMediaServer();
});

// Used by tests in case they need to access the singleton.
export function __getRecorderSingleton(): { newRecorder: () => Recorder } | null {
  return recorderSingleton;
}