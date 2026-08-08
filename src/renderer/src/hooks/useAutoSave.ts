// useAutoSave — debounced save state machine consumed by ProfileEditor
// and ReportEditor. The hook does NOT auto-fire on value change;
// the parent calls `trigger()` explicitly on blur (or on Finalize for
// a non-blur trigger). This matches the auto-save-on-blur pattern
// from CONTEXT.md §Report fields (not keystroke-driven).
//
// State transitions:
//   idle → trigger() → saving → onSave resolves → saved (+savedAt)
//   idle → trigger() → saving → onSave rejects → error
//
// The debounceMs defaults to 300 — short enough that the inline
// "Saving…" indicator doesn't flash, long enough that a fast blur
// across three textareas in sequence coalesces into one IPC round-trip
// per field.

import { useCallback, useEffect, useRef, useState } from 'react';
import { debounce } from '@/lib/debounce';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type UseAutoSaveOptions<T> = {
  value: T;
  onSave: (value: T) => Promise<void>;
  debounceMs?: number;
};

export type UseAutoSaveResult<T> = {
  status: SaveStatus;
  savedAt: number | null;
  trigger: (overrideValue?: T) => void;
};

export function useAutoSave<T>({
  value,
  onSave,
  debounceMs = 300,
}: UseAutoSaveOptions<T>): UseAutoSaveResult<T> {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // ponytail: the debounced fn is rebuilt each render so `value` is
  // captured fresh — but the timeout itself is owned by the debounce
  // primitive, not React. The cleanup effect cancels the pending
  // timeout on unmount.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const debouncedSave = useRef(
    debounce(async (v: T) => {
      setStatus('saving');
      try {
        await onSaveRef.current(v);
        setSavedAt(Date.now());
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, debounceMs),
  ).current;

  // Re-arm the debounce delay whenever the parent passes a new
  // debounceMs. We rebuild the primitive's timeout by calling cancel()
  // then letting the next trigger() reseed it.
  // ponytail: NO `value` dep — every setLocal causes a re-render
  // and would cancel the pending save the trigger just scheduled.
  // The trigger is the only path to schedule a save; the cleanup
  // is reserved for debounceMs changes + unmount.
  useEffect(() => {
    debouncedSave.cancel();
  }, [debounceMs, debouncedSave]);

  // Cleanup on unmount — prevents a stale IPC from setStatus'ing an
  // unmounted component.
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  // ponytail: trigger accepts an OPTIONAL override value so the
  // parent can pass the freshly patched state without waiting for
  // React to flush the setState. The closure-captured `value` would
  // otherwise race — by the time the debounce fires, the queued
  // setLocal update hasn't landed and the wrapped fn sees stale data.
  const trigger = useCallback(
    (overrideValue?: T): void => {
      debouncedSave.call(overrideValue ?? value);
    },
    [debouncedSave, value],
  );

  return { status, savedAt, trigger };
}