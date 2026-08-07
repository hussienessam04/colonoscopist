// Toast-undo delete store for screenshots. Per D-12 — clicking the × on a
// thumbnail optimistically removes the screenshot from the UI, schedules
// the actual IPC delete after a 5s window, and cancels the scheduled
// delete if the doctor clicks Undo before the window expires.
//
// ponytail: Zustand would let this stay a hook, but the only consumer in
// Plan 01 is the ProcedureReview onDelete handler. A 30-line store with
// `getState()` + `setState()` mirrors the audit/recording store style in
// this codebase without pulling a new dependency.

import { useSyncExternalStore } from 'react';

export type PendingDelete = {
  screenshotId: number;
  procedureId: string;
  expiresAt: number;
};

export type CommittedDelete = {
  screenshotId: number;
  procedureId: string;
  success: boolean;
  errorMessage: string | null;
};

type ToastState = {
  pending: PendingDelete[];
};

const UNDO_WINDOW_MS = 5_000;

let state: ToastState = { pending: [] };
const listeners = new Set<() => void>();
const committedListeners = new Set<(event: CommittedDelete) => void>();

function emitCommitted(event: CommittedDelete): void {
  for (const listener of committedListeners) listener(event);
}

function subscribeCommitted(listener: (event: CommittedDelete) => void): () => void {
  committedListeners.add(listener);
  return () => committedListeners.delete(listener);
}

// ponytail: tracked timeouts so undoDelete can cancel them deterministically
// without relying on a slow setTimeout callback to read state.
const scheduledTimers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ToastState {
  return state;
}

function enqueueDelete(screenshotId: number, procedureId: string): void {
  // De-dup: if the same screenshot is already pending, do nothing. Protects
  // against rapid double-tap on the × button firing two IPC deletes.
  if (state.pending.some((p) => p.screenshotId === screenshotId)) return;
  const expiresAt = Date.now() + UNDO_WINDOW_MS;
  state = {
    pending: [...state.pending, { screenshotId, procedureId, expiresAt }],
  };
  emit();
  const timer = setTimeout(() => {
    scheduledTimers.delete(screenshotId);
    commitDelete(screenshotId);
  }, UNDO_WINDOW_MS);
  scheduledTimers.set(screenshotId, timer);
}

function undoDelete(screenshotId: number): void {
  const timer = scheduledTimers.get(screenshotId);
  if (timer !== undefined) {
    clearTimeout(timer);
    scheduledTimers.delete(screenshotId);
  }
  if (!state.pending.some((p) => p.screenshotId === screenshotId)) return;
  state = {
    pending: state.pending.filter((p) => p.screenshotId !== screenshotId),
  };
  emit();
}

// Internal: actually fire the IPC delete after the undo window.
function commitDelete(screenshotId: number): void {
  const entry = state.pending.find((p) => p.screenshotId === screenshotId);
  if (!entry) return;
  state = { pending: state.pending.filter((p) => p.screenshotId !== screenshotId) };
  emit();
  void window.api.screenshots
    .delete({ id: screenshotId })
    .then(() => {
      emitCommitted({
        screenshotId,
        procedureId: entry.procedureId,
        success: true,
        errorMessage: null,
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      void import('sonner')
        .then(({ toast }) => {
          toast.error(`Failed to delete screenshot: ${message}`);
        })
        .catch(() => undefined);
      emitCommitted({
        screenshotId,
        procedureId: entry.procedureId,
        success: false,
        errorMessage: message,
      });
    });
}

function reset(): void {
  for (const t of scheduledTimers.values()) clearTimeout(t);
  scheduledTimers.clear();
  state = { pending: [] };
  emit();
}

export const screenshotToastStore = {
  enqueueDelete,
  undoDelete,
  reset,
  subscribeCommitted,
  __getState: snapshot,
};

export function useScreenshotToasts(): { pending: PendingDelete[] } {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { pending: snap.pending };
}
