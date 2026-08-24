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

  return { status, loading, refresh };
}
