// useTrim — orchestrates the trim UI state + IPC round-trip.
// Per D-06 / D-09 / D-13 — the doctor drags the handles on the scrubber
// (local state, never persisted), clicks Apply, the hook awaits
// `window.api.procedures.trim()` and refreshes the procedure row.
//
// On mount, inMs = 0 and outMs = currentDurationMs. The 1000ms minimum
// gap between handles is enforced by clampHandle() in lib/trim-clamp.ts;
// the IPC zod refine is the hard floor at the main boundary.
//
// `applying` / `restoring` are local boolean flags the buttons disable on
// during the IPC round-trip. The toast surfaces success/failure per UX-
// Pitfalls (inline status, no modal).

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Procedure } from '@shared/ipc-contract';
import { trimStore, useTrimMode } from '@/store/trim';

export type UseTrimResult = {
  trimMode: boolean;
  setTrimMode: (on: boolean) => void;
  inMs: number;
  outMs: number;
  setInMs: (n: number) => void;
  setOutMs: (n: number) => void;
  apply: () => Promise<void>;
  restore: () => Promise<void>;
  applying: boolean;
  restoring: boolean;
};

export function useTrim(
  procedureId: string,
  currentDurationMs: number,
  onApplied: (updated: Procedure) => void,
): UseTrimResult {
  const { trimMode, setTrimMode } = useTrimMode();
  const [inMs, setInMs] = useState(0);
  const [outMs, setOutMs] = useState(currentDurationMs);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Re-init the range when the procedure changes (e.g. after a successful
  // Apply, the parent re-fetches and the duration may shift).
  useEffect(() => {
    setInMs(0);
    setOutMs(currentDurationMs);
  }, [procedureId, currentDurationMs]);

  const apply = useCallback(async (): Promise<void> => {
    if (applying) return;
    setApplying(true);
    try {
      const updated = await window.api.procedures.trim({
        id: procedureId,
        inMs,
        outMs,
      });
      toast.success('Trim applied');
      trimStore.setTrimMode(false);
      onApplied(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Trim failed';
      toast.error(`Trim failed: ${msg}`);
    } finally {
      setApplying(false);
    }
  }, [applying, procedureId, inMs, outMs, onApplied]);

  const restore = useCallback(async (): Promise<void> => {
    if (restoring) return;
    setRestoring(true);
    try {
      const updated = await window.api.procedures.restore({ id: procedureId });
      toast.success('Original restored');
      trimStore.setTrimMode(false);
      onApplied(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restore failed';
      toast.error(`Restore failed: ${msg}`);
    } finally {
      setRestoring(false);
    }
  }, [restoring, procedureId, onApplied]);

  return {
    trimMode,
    setTrimMode,
    inMs,
    outMs,
    setInMs,
    setOutMs,
    apply,
    restore,
    applying,
    restoring,
  };
}
