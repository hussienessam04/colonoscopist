// useLicenseStatus — SWR-style hook for the License sub-page + LicenseGate.
//
// Plan 08-05: single source of truth for license state in the renderer.
// The hook mirrors `useProcedures` / `useDoctorProfile` (small, single
// purpose; useState + useEffect, no useReducer / no Zustand).
//
// Surface:
//   status   — current LicenseStatus or null while loading
//   loading  — true until the first IPC settles
//   refresh  — re-fetches via window.api.license.status() — used after
//              a successful license.pickAndActivate() so LicenseGate
//              dismisses and the sub-page card re-renders
//
// ponytail: no stale-fetch guard (refreshInFlightRef). The IPC is cheap
// + idempotent; the activate button is the only caller and waits on its
// own promise. A stale-fetch guard would add a useRef + an early return
// for a non-problem.

import { useCallback, useEffect, useState } from 'react';
import type { LicenseStatus } from '@shared/ipc-contract';

// ponytail: cross-component refresh. Each `useLicenseStatus` call is its
// own React state instance — when License.tsx calls refresh() after
// pickAndActivate, the LicenseGate's separate hook instance does NOT
// see the update (it's in a different component tree). Dispatching
// `colonoscopist:license-changed` on window lets every mounted instance
// re-fetch simultaneously. Subscribers clean up their listener on unmount.
export const LICENSE_CHANGED_EVENT = 'colonoscopist:license-changed';

export type UseLicenseStatusResult = {
  status: LicenseStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useLicenseStatus(): UseLicenseStatusResult {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // ponytail: optional-chain on window.api — defensive zero-cost
      // guard for renderer tests + HMR edge cases where `window.api`
      // hasn't been seeded yet. Production callers always seed it
      // before mount (preload bridge runs at app boot).
      const next = await window.api.license?.status?.();
      setStatus(next ?? null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onChanged(): void {
      void refresh();
    }
    window.addEventListener(LICENSE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(LICENSE_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  return { status, loading, refresh };
}

// useLicenseChangeRefresh — quick task 260913-rp5.
//
// When the user activates the license, the License sub-page dispatches
// LICENSE_CHANGED_EVENT. Every useLicenseStatus instance re-fetches.
//
// Other renderer hooks / inline useEffects that gate their IPC reads on
// license state (useCaptureDeviceMap, useProcedures, ProcedureRoom's
// getDefaultDevice / getPreset, ProcedurePreview's setGated,
// SettingsCapture's setGated, ProcedureReview's patient fetch) set a
// `gated` flag when the gate rejects. The flag stays stuck at true
// unless something triggers a re-fetch.
//
// This helper wires the missing link: any caller can register a refresh
// callback that fires when LICENSE_CHANGED_EVENT arrives. The callback
// re-runs the IPC read; if the new license state is 'licensed' the
// gated flag clears naturally.
export function useLicenseChangeRefresh(
  refresh: () => void | Promise<void>,
): void {
  useEffect(() => {
    function onChanged(): void {
      void refresh();
    }
    window.addEventListener(LICENSE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(LICENSE_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);
}

