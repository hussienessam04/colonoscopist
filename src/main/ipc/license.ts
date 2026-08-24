// Phase 8 / Plan 01 — License IPC handler stub (LIC-02/03).
//
// Per the tracer pattern: this plan proves the verify path end-to-end
// via the roundtrip integration test BEFORE wiring the file picker.
// Both channels are EXEMPT from the IPC gate (Plan 03 ships the gate):
//   - LICENSE_STATUS: needed to render the activation modal on first launch.
//   - LICENSE_ACTIVATE: needed to resolve the modal.
//
// Plan 04 replaces the LICENSE_ACTIVATE stub with the real
// `loadAndVerifyLicense` (file picker → sidecar parse → verify → audit
// row + cache invalidation).

import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { licenseActivateInput } from '@shared/validators';
import { IpcErrorException, ipcError } from '@shared/errors';
import { getLicenseStatus, licenseGated } from '../license';

export function registerLicenseIpc(): void {
  // LIC-02 — returns the cached LicenseStatus. The boot path warms the
  // cache via `getLicenseStatus()` inside `app.whenReady()` so the first
  // IPC call doesn't pay the verify cost.
  //
  // Plan 03 — LICENSE_STATUS is EXEMPT from the gate per CONTEXT D-08
  // (so the renderer can render the activation modal). The
  // `licenseGated` wrapper is still applied for grep-gate consistency
  // (the EXEMPT branch returns the handler unchanged — see gate.ts).
  ipcMain.handle(IPC.LICENSE_STATUS, licenseGated(IPC.LICENSE_STATUS, async () => {
    try {
      return await getLicenseStatus();
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // LIC-03 — Plan 01 ships a stub that throws IPC_NOT_IMPLEMENTED so the
  // IPC surface compiles; Plan 04 ships the real `loadAndVerifyLicense`.
  // The stub is intentional per the tracer pattern — we prove verify
  // works end-to-end via the test BEFORE wiring the file picker.
  //
  // Plan 03 — LICENSE_ACTIVATE is EXEMPT (same D-08 reasoning as
  // LICENSE_STATUS: needed to resolve the activation modal).
  ipcMain.handle(IPC.LICENSE_ACTIVATE, licenseGated(IPC.LICENSE_ACTIVATE, async (_e, raw) => {
    const parsed = licenseActivateInput.parse(raw);
    try {
      // Plan 04 replaces this with `loadAndVerifyLicense(parsed.licPath)`
      // + cache invalidation + audit row emission.
      void parsed;
      throw new IpcErrorException(
        ipcError('IPC_NOT_IMPLEMENTED', 'LICENSE_ACTIVATE ships in Plan 04'),
      );
    } catch (err) {
      throw asIpcError(err);
    }
  }));
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