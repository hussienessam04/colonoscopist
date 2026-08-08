// useDoctorProfile — SWR-style hook for the ProfileEditor page.
// Mirrors the shape of useProcedures (Task 3 reference): a single row
// from `window.api.profile.get()` + an optimistic `setLocal` patch.
//
// The parent composes `useAutoSave` to actually persist the patch.
// `setLocal` is local-only (no IPC) so a keystroke does not round-trip;
// the IPC fires when the field blurs and the parent calls trigger().
//
// ponytail: no useReducer, no Zustand — useState + useEffect for one row.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DoctorProfile } from '@shared/ipc-contract';

export type UseDoctorProfileResult = {
  profile: DoctorProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setLocal: (patch: Partial<DoctorProfile>) => void;
};

export function useDoctorProfile(): UseDoctorProfileResult {
  const [profile, setProfile] = useState<DoctorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // ponytail: refreshInFlightRef guards concurrent refresh() calls
  // (e.g. fast double-click on Save). The second awaits the first.
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      try {
        // ponytail: optional-chain so a mid-render mutation of
        // `window.api` (cascade pollution from a prior test's stashed
        // microtask) cannot crash the render with "Cannot read
        // properties of undefined (reading 'get')". Production callers
        // always seed `window.api.profile` before mount; the optional
        // chain is a defensive zero-cost guard for renderer tests +
        // HMR edge cases.
        const row = await window.api.profile?.get?.();
        setProfile(row ?? null);
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setLocal = useCallback((patch: Partial<DoctorProfile>): void => {
    setProfile((prev) => (prev === null ? prev : { ...prev, ...patch }));
  }, []);

  return { profile, loading, refresh, setLocal };
}