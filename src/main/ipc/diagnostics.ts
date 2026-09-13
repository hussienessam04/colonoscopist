// Diagnostics IPC — quick task 20260913-5b0.
//
// One channel that surfaces a workstation-level diagnostic bundle for
// vendor support (Settings → Diagnostics page reads it via
// `window.api.app.getDiagnostic()`). Mirrors `storage.ts` — the
// channel is EXEMPT from the license gate (a clinic with an expired
// license should still be able to ship us the diagnostic bundle).
//
// The bundle covers:
//   - runtime versions (app / electron / node / chromium)
//   - the resolved userData + logs paths so support can ask the user
//     to find their log file
//   - the last 200 lines of startup.log (rendered in the page)
//   - license state + trial days remaining + machine id
//   - the effective data root (local vs shared DB)
//
// Each field is computed best-effort with a try/catch fallback so a
// broken license cache or a missing config never blocks the
// diagnostic read.

import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  IPC,
  type DiagnosticInfo,
  type LicenseState,
} from '@shared/ipc-contract';
import { logEvent, readRecentLogLines } from '../startup-log';
import { getLicenseStatus } from '../license';
import { getDataLocationConfig } from '../storage/data-location-config';
import { dataRoot } from '../paths';

export function registerDiagnosticsIpc(): void {
  ipcMain.handle(IPC.APP_GET_DIAGNOSTIC, async (): Promise<DiagnosticInfo> => {
    // Read package.json version (no app.getVersion() in dev — be explicit).
    let appVersion = 'unknown';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
        version?: string;
      };
      appVersion = pkg.version ?? 'unknown';
    } catch {
      /* fall through with 'unknown' */
    }

    const userDataDir = app.getPath('userData');
    const logsDir = path.join(userDataDir, 'logs');
    const currentLogPath = path.join(logsDir, 'startup.log');
    const logLines = readRecentLogLines(200);

    let licenseState: LicenseState | null = null;
    let trialDaysRemaining: number | null = null;
    let machineId = '';
    try {
      const status = await getLicenseStatus();
      licenseState = status.state;
      trialDaysRemaining = status.trialDaysRemaining;
      machineId = status.machineId;
    } catch (err) {
      // License cache is best-effort — a broken verify shouldn't
      // block the doctor from exporting diagnostics.
      logEvent('warn', 'diagnostics.license_status_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    let storageLocation: DiagnosticInfo['storageLocation'] = null;
    try {
      const cfg = getDataLocationConfig();
      storageLocation = {
        enabled: cfg.enabled,
        effectivePath: dataRoot(),
        localPath: userDataDir,
      };
    } catch {
      /* leave null */
    }

    const info: DiagnosticInfo = {
      appVersion,
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      userDataDir,
      logsDir,
      currentLogPath,
      logLines,
      storageLocation,
      machineId,
      licenseState,
      trialDaysRemaining,
    };
    return info;
  });
}
