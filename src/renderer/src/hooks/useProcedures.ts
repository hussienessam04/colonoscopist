// useProcedures — SWR-style hook for the Procedure Review screen.
// Plan 02 unifies the fetch + capture + annotation lifecycle into one hook
// so the screen state doesn't duplicate across `useScreenshotIntake` +
// ad-hoc `useEffect` fetches.
//
// Surface:
//   procedure   — row from `procedures.get({ id })`
//   segments    — rows from `proceduresRepo.listSegments(procedureId)` via
//                 `procedures.listSegments({ procedureId })`
//   notes       — rows from `procedureNotes.list({ procedureId })` ASC
//   screenshots — rows from `screenshots.list({ procedureId })` ASC
//   loading     — true until the parallel fetch settles (or errors)
//   error       — first rejection (string for `useState` ergonomics)
//   refresh     — re-fetches all four slices in parallel
//   updateAnnotation — optimistic local mutation + IPC round-trip;
//                       on failure, restores the prior value + toasts
//
// ponytail: no `useReducer`, no Zustand — `useState` + `useEffect` is
// enough for one screen. The hook is single-purpose.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  Procedure,
  ProcedureNote,
  ProcedureSegment,
  Screenshot,
} from '@shared/ipc-contract';
import { safeInvoke } from '@/lib/ipc-result';
import { useLicenseChangeRefresh } from '@/hooks/useLicenseStatus';
import { screenshotToastStore } from '@/store/screenshot-toast';

export type UseProceduresResult = {
  procedure: Procedure | null;
  segments: ProcedureSegment[];
  notes: ProcedureNote[];
  screenshots: Screenshot[];
  loading: boolean;
  error: string | null;
  // Plan 08-10 / G-08-4 — gate-rejected flag. When ANY of the four
  // gated IPC calls returns {ok:false}, the consumer renders
  // <EmptyStateCard> instead of a stale empty table.
  gated: boolean;
  refresh: () => Promise<void>;
  removeScreenshot: (screenshotId: number) => void;
  updateAnnotation: (id: number, annotation: string | null) => Promise<void>;
};

export function useProcedures(procedureId: string | null): UseProceduresResult {
  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [segments, setSegments] = useState<ProcedureSegment[]>([]);
  const [notes, setNotes] = useState<ProcedureNote[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Plan 08-10 / G-08-4 — gate-rejected flag (separate from `error` so
  // the consumer can branch on license-gate state without parsing
  // `error`).
  const [gated, setGated] = useState(false);
  // ponytail: refreshInFlightRef guards against concurrent refresh calls
  // (e.g. fast double-click on a Capture button). The second call awaits
  // the first so the local state stays consistent.
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!procedureId) {
      setProcedure(null);
      setSegments([]);
      setNotes([]);
      setScreenshots([]);
      setError(null);
      setGated(false);
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        // Plan 08-10 / G-08-4 — branch on the discriminated union via
        // safeInvoke. Any gate-rejected arm flips `gated=true` so the
        // consumer renders <EmptyStateCard>. The success arm proceeds
        // unchanged.
        const [proc, segs, noteRows, shotRows] = await Promise.all([
          safeInvoke(window.api.procedures.get({ id: procedureId })),
          safeInvoke(window.api.procedures.listSegments({ procedureId })),
          safeInvoke(window.api.procedureNotes.list({ procedureId })),
          safeInvoke(window.api.screenshots.list({ procedureId })),
        ]);
        if (proc === null || segs === null || noteRows === null || shotRows === null) {
          setGated(true);
          setProcedure(null);
          setSegments([]);
          setNotes([]);
          setScreenshots([]);
          return;
        }
        setProcedure(proc);
        setSegments(segs);
        setNotes(noteRows);
        setScreenshots(shotRows);
        setGated(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load procedure');
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [procedureId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Quick task 260913-rp5 — when the user activates the license,
  // re-fetch so the `gated` flag clears and the procedure data loads.
  useLicenseChangeRefresh(refresh);

  const updateAnnotation = useCallback(
    async (id: number, annotation: string | null): Promise<void> => {
      // Optimistic local update + rollback on failure.
      let prev: Screenshot | null = null;
      setScreenshots((rows) =>
        rows.map((row) => {
          if (row.id !== id) return row;
          prev = row;
          return { ...row, annotation };
        }),
      );
      try {
        const updated = await window.api.screenshots.updateAnnotation({ id, annotation });
        setScreenshots((rows) => rows.map((row) => (row.id === id ? updated : row)));
      } catch (err: unknown) {
        // Roll back to the previous value if the IPC failed.
        if (prev !== null) {
          setScreenshots((rows) =>
            rows.map((row) => (row.id === id ? (prev as Screenshot) : row)),
          );
        }
        const msg = err instanceof Error ? err.message : 'Failed to save annotation';
        toast.error(msg);
        throw err;
      }
    },
    [],
  );

  const removeScreenshot = useCallback((screenshotId: number): void => {
    // G-05-13 — synchronous local-state removal for the optimistic
    // delete UX. The actual IPC delete is the toast-store's job.
    setScreenshots((rows) => rows.filter((row) => row.id !== screenshotId));
  }, []);

  useEffect(() => {
    // G-05-13 — re-sync after the toast store fires the IPC. A failed
    // delete leaves the DB row present, so refresh restores it locally.
    const unsubscribe = screenshotToastStore.subscribeCommitted((event) => {
      if (event.procedureId === procedureId) {
        void refresh();
      }
    });
    return unsubscribe;
  }, [procedureId, refresh]);

  return {
    procedure,
    segments,
    notes,
    screenshots,
    loading,
    error,
    gated,
    refresh,
    removeScreenshot,
    updateAnnotation,
  };
}
