// Phase 8 / Plan 01 + Plan 04 — License IPC handler (LIC-02/03).
//
// Plan 01 shipped a stub for `LICENSE_ACTIVATE` that threw
// `IPC_NOT_IMPLEMENTED` so the IPC surface compiled; Plan 04 wires the
// real `loadAndVerifyLicense` (file read → sidecar parse → Ed25519
// verify → audit row emission → cache invalidation) + a new
// `LICENSE_PICK_AND_ACTIVATE` one-shot that wraps `dialog.showOpenDialog`
// + `loadAndVerifyLicense` so the renderer never composes paths.
//
// Both license channels are EXEMPT from the IPC gate per CONTEXT D-08
// (renderer needs to render + resolve the activation modal). The
// `licenseGated` wrapper is still applied for grep-gate consistency —
// the EXEMPT branch returns the handler unchanged (see gate.ts).

import { dialog, ipcMain } from 'electron';
import { ZodError } from 'zod';
import { IPC } from '@shared/ipc-contract';
import { licenseActivateInput } from '@shared/validators';
import { IpcErrorException, ipcError } from '@shared/errors';
import {
  getLicenseStatus,
  licenseGated,
  loadAndVerifyLicense,
} from '../license';

export function registerLicenseIpc(): void {
  // LIC-02 — returns the cached LicenseStatus. The boot path warms the
  // cache via `getLicenseStatus()` inside `app.whenReady()` so the first
  // IPC call doesn't pay the verify cost.
  //
  // LICENSE_STATUS is EXEMPT from the gate per CONTEXT D-08 (so the
  // renderer can render the activation modal). The `licenseGated`
  // wrapper is still applied for grep-gate consistency (the EXEMPT
  // branch returns the handler unchanged — see gate.ts).
  ipcMain.handle(IPC.LICENSE_STATUS, licenseGated(IPC.LICENSE_STATUS, async () => {
    try {
      return await getLicenseStatus();
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // LIC-03 — Plan 01 shipped the IPC_NOT_IMPLEMENTED stub so the IPC
  // surface compiled; Plan 04 wires the real `loadAndVerifyLicense`. The
  // zod input validator (licenseActivateInput) caps `licPath` at 2000
  // chars per RESEARCH T-08-L08 defense-in-depth.
  //
  // LICENSE_ACTIVATE is EXEMPT (same D-08 reasoning as LICENSE_STATUS:
  // needed to resolve the activation modal).
  ipcMain.handle(IPC.LICENSE_ACTIVATE, licenseGated(IPC.LICENSE_ACTIVATE, async (_e, raw) => {
    const parsed = licenseActivateInput.parse(raw);
    try {
      const result = await loadAndVerifyLicense(parsed.licPath);
      return result;
    } catch (err) {
      if (err instanceof ZodError) {
        throw new IpcErrorException(ipcError('IPC_VALIDATION', err.message));
      }
      throw asIpcError(err);
    }
  }));

  // LIC-03 (one-shot picker) — Plan 04 ships `LICENSE_PICK_AND_ACTIVATE`
  // so the renderer can hit a single button and have main own the file
  // dialog + verify flow. The renderer NEVER composes paths (Phase 7
  // D-13 verbatim pattern — same as BACKUP_PICK_DESTINATION +
  // RESTORE_PICK_ZIP); `dialog.showOpenDialog` is the only legitimate
  // source of `.lic` paths.
  //
  // Cancel path returns `{ ok: false, code: 'IPC_LICENSE_CANCELLED' }`
  // — a distinct code from `IPC_LICENSE_INVALID` so the renderer can
  // differentiate "no file picked" from "tampered file". NO audit row
  // on cancel — distinct from `license.invalid` (D-10) which is logged
  // on a real tampered/fingerprint-mismatch attempt.
  //
  // Channel is EXEMPT from the gate (added by Plan 04 to the same
  // EXEMPT_CHANNELS set in src/main/license/gate.ts). The user is
  // ACTIVELY activating when they hit this channel; gating it would
  // lock the user out of the activation flow.
  ipcMain.handle(
    IPC.LICENSE_PICK_AND_ACTIVATE,
    licenseGated(IPC.LICENSE_PICK_AND_ACTIVATE, async () => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Select Colonoscopist license file',
          filters: [
            { name: 'Colonoscopist License', extensions: ['lic'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, code: 'IPC_LICENSE_CANCELLED' as const };
        }
        const verified = await loadAndVerifyLicense(result.filePaths[0]);
        return verified;
      } catch (err) {
        throw asIpcError(err);
      }
    }),
  );
}

function asIpcError(err: unknown): Error {
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
