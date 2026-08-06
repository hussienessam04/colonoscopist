// trim store — boolean toggle for Trim mode on the Procedure Review screen.
// Per D-06 — the doctor enters Trim mode to expose the two drag handles on
// the scrubber + the Apply/Restore buttons in the right rail. The toggle
// is the only piece of trim state that survives ProcedureReview unmount
// (so navigating back-and-forth doesn't reset the doctor's choice mid-session).
//
// ponytail: tiny `useSyncExternalStore`-style store mirrors the
// screenshot-toast pattern from Plan 01 — no Zustand for a single boolean.

import { useSyncExternalStore } from 'react';

type TrimState = {
  trimMode: boolean;
};

let state: TrimState = { trimMode: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): TrimState {
  return state;
}

function setTrimMode(on: boolean): void {
  if (state.trimMode === on) return;
  state = { trimMode: on };
  emit();
}

function reset(): void {
  state = { trimMode: false };
  emit();
}

export const trimStore = {
  setTrimMode,
  reset,
  __getState: snapshot,
};

export function useTrimMode(): { trimMode: boolean; setTrimMode: (on: boolean) => void } {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { trimMode: snap.trimMode, setTrimMode };
}
