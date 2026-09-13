import { app, dialog } from 'electron';
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
// Quick task 20260912-shared-database-optional — opt-in shared
// DB across devices (Settings → Storage).
import { registerStorageIpc } from './ipc/storage';
// Quick task 20260913-5b0 — workstation-level diagnostic bundle for
// vendor support (Settings → Diagnostics). Registered FIRST so an
// expired / unactivated clinic can still export the bundle.
import { registerDiagnosticsIpc } from './ipc/diagnostics';
import { enumerateDshowDevices } from './capture/devices';
import { getDb, closeDb } from './db';
import { proceduresRepo } from './db/procedures-repo';
import { logEvent, logStartup } from './startup-log';
import {
  initMediaServer,
  initRecorder,
  scanForOrphans,
  shutdownMediaServer,
} from './recorder/init';
import { Recorder } from './recorder/recorder';
import { recorderRegistry } from './recorder/registry';
import { getLicenseStatus } from './license';

const APP_NAME = 'Colonoscopist';
const APP_USER_MODEL_ID = 'com.colonoscopist.app';

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// Quick task 20260913-5b0 — process-level crash capture. Wired at
// module top (BEFORE `app.whenReady`) so any failure during the
// boot path itself lands in startup.log. We deliberately DO NOT
// exit — Electron handles process lifecycle; the renderer is
// sandboxed so a crash here usually means a bad spawn/IO, and
// exiting would leave the doctor staring at a dead window with
// no diagnostic trail.
process.on('uncaughtException', (err) => {
  logEvent('error', 'uncaught_exception', { err: err.stack ?? err.message });
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logEvent('error', 'unhandled_rejection', { err: err.stack ?? err.message });
});

let recorderSingleton: { newRecorder: () => Recorder } | null = null;

// per D-01 + AUDIT-01 — DB open + migrations BEFORE any IPC handler registration.
// Patients IPC registers AFTER auth/users/audit so admin gating + audit helpers exist when its handlers run.
// Capture IPC registers AFTER patients so the audit infrastructure is ready (per Phase 3 RESEARCH §Integration Points).
// Recorder init BEFORE the IPC registrations so the registry exists when handlers run.
app.whenReady().then(() => {
  getDb();
  // Quick task 20260913-5b0 — register diagnostics FIRST so an
  // expired / unactivated clinic can still read the diagnostic
  // bundle from Settings → Diagnostics. The channel is EXEMPT
  // from the license gate (gate.ts), but registering it first
  // means there's no temporal window where it could be missed.
  registerDiagnosticsIpc();
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
  // Quick task 20260912-shared-database-optional — register
  // BEFORE auth/wizard handlers so the doctor can configure
  // storage during the first-launch flow without an active
  // session (channel is in EXEMPT_CHANNELS below).
  registerStorageIpc();
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

  // Quick task 20260912-procedure-room-exit-warning — capture the
  // BrowserWindow reference returned by createMainWindow() so we
  // can attach the close-guard below.
  mainWindowRef = createMainWindow();
  logStartup('app-ready');
});

// Quick task 20260912-procedure-room-exit-warning — module-level
// reference to the main BrowserWindow. Set inside
// `app.whenReady().then(...)` above; the close-guard attaches
// here at module load time (Electron's `close` event fires
// after `whenReady`, so the assignment is guaranteed before
// the guard ever runs).
let mainWindowRef: import('electron').BrowserWindow | null = null;

// Quick task 20260912-procedure-room-exit-warning — intercept
// the main window's `close` event so the doctor gets the same
// "Continue recording / Stop recording & finalize" prompt when
// they close the app mid-recording. Without this guard the
// recorder would silently finalize as `partial` (per D-03) and
// leave the doctor's in-flight recording looking abandoned. The
// matching in-app dialog for the "Back to Preview" button lives
// in renderer/src/pages/ProcedureRoom.tsx; both prompts share the
// same wording so the experience is consistent whichever exit
// route the doctor takes.
//
// Re-entrancy guard: once the doctor picks "Stop recording &
// finalize" we set `forceClose = true` and call
// `mainWindow.close()` again. Electron re-fires `close`, but the
// guard sees `forceClose` and skips the dialog.
let forceClose = false;
function attachRecordingCloseGuard(): void {
  if (!mainWindowRef) return;
  const win = mainWindowRef;
  win.on('close', (event) => {
    if (forceClose) return;
    const midRecording = recorderRegistry
      .values()
      .filter((r) => {
        const state = r.getState();
        return (
          state === 'starting' ||
          state === 'recording' ||
          state === 'paused' ||
          state === 'stopping'
        );
      });
    if (midRecording.length === 0) return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Continue recording', 'Stop recording & finalize'],
      defaultId: 0,
      cancelId: 0,
      title: 'Recording in progress',
      message: 'A procedure recording is currently running.',
      detail:
        'Closing the app now will finalize the recording as completed. ' +
        'Choose "Continue recording" to keep capturing, or "Stop recording & finalize" to end the procedure here.',
      noLink: true,
    });
    if (choice === 1) {
      // Stop every in-flight recorder. We use the recorder's
      // own stop() (not the IPC handler) because we're inside
      // the close event and the renderer is about to disappear.
      // recorder.stop() is idempotent and any leftover
      // .partial.mp4 files are reclaimed on the next boot by
      // scanForOrphans().
      void Promise.all(
        midRecording.map((recorder) => recorder.stop().catch(() => undefined)),
      ).finally(() => {
        forceClose = true;
        win.close();
      });
    }
    // choice === 0 → do nothing, the window stays open.
  });
}
// Defer attaching the close guard until the window exists. We
// hook `app.on('browser-window-created')` so the guard runs as
// soon as createMainWindow() lands, regardless of the order
// inside whenReady().
app.on('browser-window-created', () => {
  attachRecordingCloseGuard();
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