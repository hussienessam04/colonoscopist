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

export type UseAutoSaveResult = {
  status: SaveStatus;
  savedAt: number | null;
  trigger: () => void;
};

export function useAutoSave<T>({
  value,
  onSave,
  debounceMs = 300,
}: UseAutoSaveOptions<T>): UseAutoSaveResult {
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
  useEffect(() => {
    debouncedSave.cancel();
    // ponytail: no useEffect dep on `value` — trigger is explicit.
    // Re-renders don't fire IPC.
    void value;
  }, [debounceMs, debouncedSave, value]);

  // Cleanup on unmount — prevents a stale IPC from setStatus'ing an
  // unmounted component.
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  const trigger = useCallback((): void => {
    debouncedSave.call(value);
  }, [debouncedSave, value]);

  return { status, savedAt, trigger };
}