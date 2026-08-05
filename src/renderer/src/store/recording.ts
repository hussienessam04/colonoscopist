// Recording store — single hook for the renderer.
// Per Plan 04-01 + CAPT-07 + PITFALLS `Per-page React re-render on every status update`.
// Plan 03 fills paused/resumed arms; Plan 04 fills lost arm.

import { useSyncExternalStore } from 'react';
import type { RecordingStatus } from '@shared/ipc-contract';

export type RecordingStatusKind = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'lost';

type RecordingState = {
  status: RecordingStatusKind | null;
  startedAt: number | null;
  currentSegmentIndex: number;
  lastError: { code: string; message: string } | null;
  // Most recent `stopped` carries the procedureId; preserved for the
  // navigate-after-stop effect in ProcedureRoom.
  procedureId: string | null;
};

let state: RecordingState = {
  status: null,
  startedAt: null,
  currentSegmentIndex: 0,
  lastError: null,
  procedureId: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): RecordingState {
  return state;
}

function setStatus(status: RecordingStatus | null): void {
  if (status === null) {
    state = { ...state, status: null, startedAt: null, currentSegmentIndex: 0, procedureId: null };
    emit();
    return;
  }
  switch (status.status) {
    case 'started':
      state = {
        ...state,
        status: 'recording',
        startedAt: status.startedAt,
        currentSegmentIndex: status.currentSegmentIndex,
        procedureId: null,
      };
      break;
    case 'paused':
      state = { ...state, status: 'paused', startedAt: status.startedAt, currentSegmentIndex: status.currentSegmentIndex };
      break;
    case 'resumed':
      state = { ...state, status: 'recording', startedAt: status.startedAt, currentSegmentIndex: status.currentSegmentIndex };
      break;
    case 'stopped':
      state = { ...state, status: 'stopped', startedAt: status.startedAt, procedureId: status.procedureId };
      break;
    case 'lost':
      state = { ...state, status: 'lost', startedAt: status.startedAt };
      break;
  }
  emit();
}

function reset(): void {
  state = {
    status: null,
    startedAt: null,
    currentSegmentIndex: 0,
    lastError: null,
    procedureId: null,
  };
  emit();
}

export const recordingStore = {
  setStatus,
  reset,
  // test hook
  __getState(): RecordingState {
    return state;
  },
};

export function useRecordingState(): RecordingState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}