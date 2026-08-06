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
  // ponytail: virtual base for the visible timer. Shifted on every 'resumed'
  // by the just-ended pause duration so the unchanged derivation
  // `Date.now() - timerStartedAt` excludes paused intervals. equals
  // `startedAt` at procedure start and after each resume's shift.
  timerStartedAt: number | null;
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
  timerStartedAt: null,
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
      timerStartedAt: null,
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
        timerStartedAt: status.startedAt,
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
      // time at the pause moment. timerStartedAt is preserved so the
      // upcoming 'resumed' arm can compute the pause duration.
      state = {
        ...state,
        status: 'paused',
        startedAt: state.startedAt, // preserve the ORIGINAL startedAt
        timerStartedAt: state.timerStartedAt, // preserve the virtual timer base
        pausedAt: status.startedAt, // wall-clock at pause
        currentSegmentIndex: status.currentSegmentIndex,
        procedureId: null,
        lastLost: null,
      };
      break;
    case 'resumed': {
      // ponytail: preserve the ORIGINAL startedAt (set on 'started', never
      // overwritten on pause/resume). The supervisor emits the original
      // value in the resumed status, but defending here means a future
      // emit-shape drift can't break the timer continuity — the resumed
      // arm mirrors the 'paused' arm's startedAt handling.
      //
      // Shift timerStartedAt back by the just-ended pause duration so the
      // unchanged derivation `Date.now() - timerStartedAt` returns
      // "elapsed recording time, paused intervals excluded". Without this
      // shift, the timer would jump forward by the pause duration on
      // resume — the user's reported symptom (e.g. 00:00:30 → pause 5s →
      // resume → 00:00:35 instead of 00:00:31).
      const prevTimerBase = state.timerStartedAt ?? state.startedAt ?? 0;
      const pauseDuration =
        state.pausedAt !== null ? state.pausedAt - prevTimerBase : 0;
      state = {
        ...state,
        status: 'recording',
        startedAt: state.startedAt ?? status.startedAt,
        timerStartedAt: Date.now() - pauseDuration,
        pausedAt: null,
        currentSegmentIndex: status.currentSegmentIndex,
        procedureId: null,
        lastLost: null,
      };
      break;
    }
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
    timerStartedAt: null,
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
  // ponytail: use timerStartedAt (virtual base that already excludes
  // paused intervals) instead of startedAt (the ORIGINAL procedure start).
  // Falls back to startedAt if timerStartedAt is null (transient state
  // during a status push) — never null in practice at steady state.
  const base = state.timerStartedAt ?? state.startedAt;
  if (base !== null) {
    return { displayMs: Math.max(0, Date.now() - base), isFrozen: state.status !== 'recording' };
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

// ponytail: return the same reference unless pausedAt/timerStartedAt/
// status actually changed. Wall-clock advance is handled by the
// component's setInterval — useTimerSnapshot does NOT depend on Date.now().
function getTimerSnapshotStable(): TimerSnapshot {
  // Re-derive only on state changes; key uses pausedAt/timerStartedAt/
  // status (no Date.now) so the reference stays stable until the next
  // state push. timerStartedAt shifts on every 'resumed' so the key
  // captures the pause-exclusion correctly.
  const pausedAt = state.pausedAt;
  const timerStartedAt = state.timerStartedAt;
  const startedAt = state.startedAt;
  const status = state.status;
  const newKey = `${pausedAt}|${timerStartedAt}|${startedAt}|${status}`;
  if (newKey === cachedSnapshotKey) {
    return cachedSnapshot;
  }
  cachedSnapshotKey = newKey;
  // ponytail: isFrozen is the pause-anchor flag; displayMs is computed
  // from the paused anchor when frozen, or current wall-clock minus the
  // virtual timerStartedAt otherwise. The component drives wall-clock
  // ticks itself.
  cachedSnapshot =
    pausedAt !== null && startedAt !== null
      ? { displayMs: Math.max(0, pausedAt - startedAt), isFrozen: true }
      : (timerStartedAt ?? startedAt) !== null
        ? {
            displayMs: Math.max(0, Date.now() - (timerStartedAt ?? startedAt ?? 0)),
            isFrozen: status !== 'recording',
          }
        : { displayMs: 0, isFrozen: status !== 'recording' };
  return cachedSnapshot;
}