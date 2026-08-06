// Recorder registry — one active recorder per procedureId (per D-01 + Anti-Pattern 5).
// Throws RecorderBusyError when a second start() targets the same procedureId.
// Per CAPT-05: one child ffmpeg process per procedure.

import { RecorderBusyError } from '@shared/errors';
import type { Recorder } from './recorder';

export const recorderRegistry = {
  set(procedureId: string, recorder: Recorder): void {
    const existing = globalRegistry.get(procedureId);
    if (existing && existing !== recorder) {
      // Replace stale entries that cannot be making progress:
      // - 'idle': previous Stop completed cleanly; new Start takes over.
      // - 'starting': previous spawn died before reaching onExit (rare;
      //   e.g. ffmpeg process killed by Windows). Allow replacement so
      //   the doctor can retry instead of being locked out.
      // Active states ('recording' / 'paused' / 'stopping') still throw.
      const state = existing.getState();
      if (state === 'idle' || state === 'starting') {
        globalRegistry.delete(procedureId);
      } else {
        throw new RecorderBusyError(procedureId);
      }
    }
    globalRegistry.set(procedureId, recorder);
  },

  get(procedureId: string): Recorder | undefined {
    return globalRegistry.get(procedureId);
  },

  has(procedureId: string): boolean {
    return globalRegistry.has(procedureId);
  },

  delete(procedureId: string): void {
    globalRegistry.delete(procedureId);
  },

  clear(): void {
    globalRegistry.clear();
  },
};

// ponytail: module-private Map so tests can stub via set() without leaking
// the underlying structure to consumers.
const globalRegistry = new Map<string, Recorder>();

// Test hook: drop the registry between tests.
export function __resetRecorderRegistry(): void {
  globalRegistry.clear();
}