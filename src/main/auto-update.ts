// Auto-update wiring — quick task 20260913-64l.
//
// electron-updater hooks (no manual setFeedURL() — app-update.yml
// is auto-generated at build time by electron-builder's `publish`
// block). Lifecycle:
//   - app.whenReady() → call checkForUpdates() once
//   - setInterval 6h → re-check
//   - update-available / download-progress / update-downloaded /
//     error events → log via logEvent + mutate module-scoped state
//   - Renderer's Settings → About card polls APP_UPDATE_GET_STATE
//     every 30s (cheap, no IPC if unchanged) and shows "Download
//     now" / "Restart now" CTAs.
//
// We DELIBERATELY do not call autoDownload on update-available —
// the doctor runs on metered clinic Wi-Fi and a silent 80 MB
// download mid-recording would tank the procedure. The "Download
// now" button is the only path that pulls bytes.
//
// EXEMPT from the license gate (gate.ts) — same rationale as
// Diagnostics: a clinic with an expired license should still get
// notified about an update so they can apply it.

import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC, type AppUpdateState } from '@shared/ipc-contract';
import { logEvent } from './startup-log';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// Module-scoped state — the renderer polls this. Always safe to
// read (mutated only via auto-updater events; the renderer only
// reads via APP_UPDATE_GET_STATE which clones the shape).
const state: AppUpdateState = {
  available: false,
  downloaded: false,
  progress: null,
  latestVersion: null,
  currentVersion: app.getVersion(),
  error: null,
};

export function initAutoUpdater(): void {
  // Dev runs (electron-vite dev) would hit GitHub for a release
  // that almost certainly doesn't exist — skip silently.
  if (!app.isPackaged) {
    logEvent('info', 'auto_update.skipped_dev');
    return;
  }

  autoUpdater.autoDownload = false; // clinic Wi-Fi — explicit user opt-in
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    logEvent('info', 'auto_update.available', { version: info.version });
    state.available = true;
    state.downloaded = false;
    state.latestVersion = info.version;
    state.progress = null;
    state.error = null;
  });
  autoUpdater.on('download-progress', (p) => {
    state.progress = { percent: p.percent, transferred: p.transferred, total: p.total };
  });
  autoUpdater.on('update-downloaded', (info) => {
    logEvent('info', 'auto_update.downloaded', { version: info.version });
    state.downloaded = true;
    state.available = true;
    state.latestVersion = info.version;
    state.progress = null;
  });
  autoUpdater.on('error', (err) => {
    logEvent('warn', 'auto_update.error', { err: err instanceof Error ? err.message : String(err) });
    state.error = err instanceof Error ? err.message : String(err);
  });

  // Initial check + 6h re-check. setInterval is fine while the
  // main process lives; if the doctor restarts daily the boot-time
  // checkForUpdates() already catches new releases.
  void autoUpdater.checkForUpdates().catch((err: unknown) =>
    logEvent('warn', 'auto_update.initial_check_failed', {
      err: err instanceof Error ? err.message : String(err),
    }),
  );
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err: unknown) =>
      logEvent('warn', 'auto_update.interval_check_failed', {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }, SIX_HOURS_MS);

  // IPC handlers (EXEMPT — see gate.ts).
  ipcMain.handle(IPC.APP_UPDATE_CHECK, () =>
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      logEvent('warn', 'auto_update.manual_check_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }),
  );
  ipcMain.handle(IPC.APP_UPDATE_GET_STATE, () => ({ ...state }));
  ipcMain.handle(IPC.APP_UPDATE_DOWNLOAD, () =>
    autoUpdater.downloadUpdate().catch((err: unknown) => {
      logEvent('error', 'auto_update.download_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }),
  );
  ipcMain.handle(IPC.APP_UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall();
  });
}
