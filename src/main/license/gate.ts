// Phase 8 / Plan 03 — IPC gate (LIC-04 + D-07 verbatim).
//
// Every `ipcMain.handle()` registration is wrapped with
// `licenseGated(channel, handler)`. The wrapper short-circuits when the
// cached license state is `unactivated` or `expired`, returning the
// matching IPC_LICENSE_* error code. The renderer mirrors this surface
// in its `useLicenseStatus()` SWR hook (Plan 05) and the boot-time
// <LicenseGate> modal.
//
// EXEMPT_CHANNELS is the minimum surface the app needs to:
//   - boot (AUTH_STATUS, AUTH_BOOTSTRAP)
//   - log in (AUTH_LOGIN, AUTH_LOGOUT, AUTH_USERS_LIST,
//             AUTH_RECOVERY_REQUEST, AUTH_ACCEPT_RECOVERY_FILE)
//   - show + resolve the activation modal (LICENSE_STATUS, LICENSE_ACTIVATE)
//   - render the Wizard first-launch flow (AUTH_WIZARD)
//   - keep the audit-on-every-read pattern intact (AUDIT_LIST, AUDIT_LOG)
//     — per CONTEXT D-08: "audit-on-every-read (Phase 2 D-05) writes
//       continue regardless of license state".
//
// The set is OPT-IN (channels default to gated; adding a new channel
// without updating the set triggers the gate). The Plan 06 grep gate
// (`scripts/check-license-gate.cjs`) catches drift.
//
// `licenseGated` is a thin wrapper; the cached status reader is async
// because `getLicenseStatus()` awaits the Ed25519 verify / fingerprint
// spawn the first time. After the boot-time warm-up path in
// `app.whenReady()`, the cached promise resolves synchronously per call
// and the per-invocation cost is a Map lookup. The audit row on rejection
// is the workstation-level "attempted access while unlicensed" trail
// per D-11 — `userId: null` because license events are not per-doctor.

import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { getLicenseStatus } from './status';
import { audit } from '../db/audit';

export const EXEMPT_CHANNELS: ReadonlySet<string> = new Set<string>([
  // Auth (the whole flow runs before any license check).
  IPC.AUTH_STATUS,
  IPC.AUTH_BOOTSTRAP,
  IPC.AUTH_WIZARD,
  IPC.AUTH_LOGIN,
  IPC.AUTH_LOGOUT,
  IPC.AUTH_USERS_LIST,
  IPC.AUTH_RECOVERY_REQUEST,
  IPC.AUTH_ACCEPT_RECOVERY_FILE,
  // License self-service (renderer needs to render + resolve the modal).
  IPC.LICENSE_STATUS,
  IPC.LICENSE_ACTIVATE,
  // Phase 8 / Plan 04 — picker + activate one-shot (D-06 verbatim).
  // The user is actively activating when they invoke this channel; the
  // gate MUST pass through even when state is 'unactivated' / 'expired'.
  // Plan 04 owns this entry (Plan 03 ships the initial EXEMPT_CHANNELS
  // set with LICENSE_ACTIVATE only).
  IPC.LICENSE_PICK_AND_ACTIVATE,
  // Audit (workstation-level event log continues regardless of license state).
  IPC.AUDIT_LIST,
  IPC.AUDIT_LOG,
  // Phase 8 / Plan 14 — cropping an already-captured screenshot is a
  // routine clinical action on existing data, not new capture. The
  // gated SCREENSHOTS_ADD still blocks new captures when unlicensed.
  IPC.SCREENSHOTS_CROP,
]);

export type LicenseGateError =
  | { ok: false; code: 'IPC_LICENSE_INVALID' }
  | { ok: false; code: 'IPC_LICENSE_EXPIRED' };

type Handler<P extends unknown[], R> = (
  event: IpcMainInvokeEvent,
  ...args: P
) => Promise<R> | R;

/**
 * Wrap an `ipcMain.handle` handler so:
 *   - Exempt channels bypass the gate (returns the handler unchanged).
 *   - Non-exempt channels short-circuit with `{ ok: false, code }` when
 *     the cached `LicenseStatus.state` is `unactivated` or `expired`.
 *
 * The audit row on every rejection uses `userId: null` — license events
 * are workstation-level, not per-doctor (D-11). The `metadata.fingerprintHash`
 * echoes the runtime machine id so the clinic can forward it to the
 * vendor if they suspect tampering.
 */
export function licenseGated<P extends unknown[], R>(
  channel: string,
  handler: Handler<P, R>,
): Handler<P, R | LicenseGateError> {
  if (EXEMPT_CHANNELS.has(channel)) {
    return handler as Handler<P, R | LicenseGateError>;
  }

  return async (event: IpcMainInvokeEvent, ...args: P): Promise<R | LicenseGateError> => {
    const status = await getLicenseStatus();
    if (status.state === 'unactivated') {
      audit({
        action: 'license.gate_rejected',
        entityType: 'license',
        entityId: channel,
        outcome: 'failed',
        userId: null,
        metadata: {
          channel,
          fingerprintHash: status.machineId,
          code: 'IPC_LICENSE_INVALID',
        },
      });
      return { ok: false, code: 'IPC_LICENSE_INVALID' };
    }
    if (status.state === 'expired') {
      audit({
        action: 'license.gate_rejected',
        entityType: 'license',
        entityId: channel,
        outcome: 'failed',
        userId: null,
        metadata: {
          channel,
          fingerprintHash: status.machineId,
          code: 'IPC_LICENSE_EXPIRED',
        },
      });
      return { ok: false, code: 'IPC_LICENSE_EXPIRED' };
    }
    return handler(event, ...args);
  };
}
