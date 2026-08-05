// Recording store — single hook for the renderer.
// Per Plan 04-01 + CAPT-07 + PITFALLS `Per-page React re-render on every status update`.
// Plan 04-03 fills paused/resumed arms + pausedAt anchor that freezes the timer;
// Plan 04 fills lost arm + lastLost slot for the DeviceLostBanner.

import { useSyncExternalStore } from 'react';
import type { RecordingStatus } from '@shared/ipc-contract';

export type RecordingStatusKind = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'lost';

export type LastLost = {
  lastKnownTimestampMs: number;
  deviceName: string;
  lostAt: number;
};

type RecordingState = {
  status: RecordingStatusKind | null;
  startedAt: number | null;
  // ponytail: pause anchor — when non-null, the visible HH:MM:SS freezes at
  // (pausedAt - startedAt) regardless of wall-clock advance (D-11).
  pausedAt: number | null;
  currentSegmentIndex: number;
  lastError: { code: string; message: string } | null;
  // Most recent `stopped` carries the procedureId; preserved for the
  // navigate-after-stop effect in ProcedureRoom.
  procedureId: string | null;
  // Plan 04 — DeviceLostBanner data. Populated on 'lost' event; cleared on
  // 'stopped' or reset(). Survives navigation within the same Procedure Room
  // session so the banner stays visible while the doctor decides to Stop.
  lastLost: LastLost | null;
};

let state: RecordingState = {
  status: null,
  startedAt: null,
  pausedAt: null,
  currentSegmentIndex: 0,
  lastError: null,
  procedureId: null,
  lastLost: null,
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
    state = {
      ...state,
      status: null,
      startedAt: null,
      pausedAt: null,
      currentSegmentIndex: 0,
      procedureId: null,
      lastLost: null,
    };
    emit();
    return;
  }
  switch (status.status) {
    case 'started':
      state = {
        ...state,
        status: 'recording',
        startedAt: status.startedAt,
        pausedAt: null,
        currentSegmentIndex: status.currentSegmentIndex,
        procedureId: null,
        lastLost: null,
      };
      break;
    case 'paused':
      // ponytail: `startedAt` from the paused status is the wall-clock time
      // at pause (the supervisor sets it to `endedAt` of the just-closed
      // segment). We anchor the freeze to this value so the renderer-side
      // display derivation `pausedAt - originalStartedAt` shows the elapsed
      // time at the pause moment.
      state = {
        ...state,
        status: 'paused',
        startedAt: state.startedAt, // preserve the ORIGINAL startedAt
        pausedAt: status.startedAt, // wall-clock at pause
        currentSegmentIndex: status.currentSegmentIndex,
        procedureId: null,
        lastLost: null,
      };
      break;
    case 'resumed':
      state = {
        ...state,
        status: 'recording',
        startedAt: status.startedAt,
        pausedAt: null,
        currentSegmentIndex: status.currentSegmentIndex,
        procedureId: null,
        lastLost: null,
      };
      break;
    case 'stopped':
      state = {
        ...state,
        status: 'stopped',
        startedAt: status.startedAt,
        procedureId: status.procedureId,
        lastLost: null,
      };
      break;
    case 'lost':
      // ponytail: persist deviceName + lastKnownTimestampMs so the banner
      // can render the formatted duration + device name. Reset on the
      // subsequent 'stopped' or reset() so a fresh ProcedureRoom entry
      // doesn't carry stale state.
      state = {
        ...state,
        status: 'lost',
        startedAt: status.startedAt,
        lastLost: {
          lastKnownTimestampMs: status.lastKnownTimestampMs,
          deviceName: status.deviceName,
          lostAt: Date.now(),
        },
      };
      break;
  }
  emit();
}

function reset(): void {
  state = {
    status: null,
    startedAt: null,
    pausedAt: null,
    currentSegmentIndex: 0,
    lastError: null,
    procedureId: null,
    lastLost: null,
  };
  emit();
}

// ponytail: explicit clear for the banner dismiss action (D-03 + Plan 04).
// Dismissing the banner does NOT cancel the partial mp4 — the renderer still
// lets the doctor Stop and finalize; the banner is just visual confirmation
// that the device is gone.
function clearLastLost(): void {
  if (state.lastLost === null) return;
  state = { ...state, lastLost: null };
  emit();
}

export const recordingStore = {
  setStatus,
  reset,
  clearLastLost,
  // test hook
  __getState(): RecordingState {
    return state;
  },
};

export function useRecordingState(): RecordingState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ponytail: per-slice selector via useSyncExternalStore so only the banner
// re-renders when lastLost changes (PITFALLS `Per-page React re-render on
// every status update`). Returns a stable reference until lastLost flips.
let cachedLastLostRef: LastLost | null | undefined = undefined;
function getLastLostSnapshot(): LastLost | null {
  if (cachedLastLostRef === state.lastLost) {
    return cachedLastLostRef === undefined ? null : (cachedLastLostRef as LastLost | null);
  }
  cachedLastLostRef = state.lastLost;
  return state.lastLost;
}
export function useLastLost(): LastLost | null {
  return useSyncExternalStore(subscribe, getLastLostSnapshot, getLastLostSnapshot);
}

export type TimerSnapshot = {
  // Visible HH:MM:SS derived value. Frozen when pausedAt !== null.
  displayMs: number;
  isFrozen: boolean;
};

// ponytail: keep the snapshot stable per state change so useSyncExternalStore
// doesn't see a new reference every render. The component ticks wall-clock
// separately via setInterval — useTimerSnapshot only re-renders when
// pausedAt/startedAt/status actually changes.
let cachedSnapshot: TimerSnapshot = computeSnapshot();
let cachedSnapshotKey: string = snapshotKey(cachedSnapshot);

function snapshotKey(s: TimerSnapshot): string {
  return `${s.displayMs}|${s.isFrozen ? 1 : 0}`;
}

function computeSnapshot(): TimerSnapshot {
  if (state.pausedAt !== null && state.startedAt !== null) {
    return { displayMs: Math.max(0, state.pausedAt - state.startedAt), isFrozen: true };
  }
  if (state.startedAt !== null) {
    return { displayMs: Math.max(0, Date.now() - state.startedAt), isFrozen: state.status !== 'recording' };
  }
  return { displayMs: 0, isFrozen: state.status !== 'recording' };
}

export function useTimerSnapshot(): TimerSnapshot {
  return useSyncExternalStore(
    subscribe,
    getTimerSnapshotStable,
    getTimerSnapshotStable,
  );
}

// ponytail: return the same reference unless pausedAt/startedAt/status
// actually changed. Wall-clock advance is handled by the component's
// setInterval — useTimerSnapshot does NOT depend on Date.now().
function getTimerSnapshotStable(): TimerSnapshot {
  // Re-derive only on state changes; key uses pausedAt/startedAt/status
  // (no Date.now) so the reference stays stable until the next state push.
  const pausedAt = state.pausedAt;
  const startedAt = state.startedAt;
  const status = state.status;
  const newKey = `${pausedAt}|${startedAt}|${status}`;
  if (newKey === cachedSnapshotKey) {
    return cachedSnapshot;
  }
  cachedSnapshotKey = newKey;
  // ponytail: isFrozen is the pause-anchor flag; displayMs is computed
  // from the paused anchor when frozen, or current wall-clock otherwise.
  // The component drives wall-clock ticks itself.
  cachedSnapshot =
    pausedAt !== null && startedAt !== null
      ? { displayMs: Math.max(0, pausedAt - startedAt), isFrozen: true }
      : startedAt !== null
        ? { displayMs: Math.max(0, Date.now() - startedAt), isFrozen: status !== 'recording' }
        : { displayMs: 0, isFrozen: status !== 'recording' };
  return cachedSnapshot;
}