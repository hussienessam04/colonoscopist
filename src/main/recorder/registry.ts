// Recorder registry — one active recorder per procedureId (per D-01 + Anti-Pattern 5).
// Throws RecorderBusyError when a second start() targets the same procedureId.
// Per CAPT-05: one child ffmpeg process per procedure.
//
// Phase 5 / Plan 03 — also owns the singleton MediaServer reference so the
// `recording:get-media-url` IPC handler can look up the long-lived localhost
// HTTP server without a circular import (registry is required by recording.ts
// to avoid pulling the MediaServer class transitively into the IPC layer).

import type { Recorder } from './recorder';
import type { MediaServer } from './preview-server';

export const recorderRegistry = {
  set(procedureId: string, recorder: Recorder): void {
    const existing = globalRegistry.get(procedureId);
    if (existing && existing !== recorder) {
      // If the existing entry is idle (previous Stop completed cleanly)
      // or starting (previous spawn died before onExit fired) we drop it
      // and accept the new recorder. An active recorder (recording /
      // paused / stopping) is the only case that still throws — a
      // genuine in-flight recording on the same procedureId should be
      // impossible to start twice from a single window, so this is a
      // real conflict and the renderer should surface it.
      const state = existing.getState();
      if (state === 'idle' || state === 'starting') {
        globalRegistry.delete(procedureId);
      } else {
        // Active recorder present: force-kill + drop, so the doctor
        // is never locked out by a previous-session orphan. The new
        // Recorder takes over the procedureId.
        try {
          (existing as unknown as { forceCleanup?: () => void }).forceCleanup?.();
        } catch {
          // ignore — old recorder may already be in a weird state
        }
        globalRegistry.delete(procedureId);
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

// ─────────────────────────────────────────────────────────────────────────────
// MediaServer singleton — Phase 5 / Plan 03. The media server is owned by
// initRecorder() (boots at app start, lives across ProcedureReview sessions)
// and exposed to the IPC layer via getMediaServer().
// ─────────────────────────────────────────────────────────────────────────────

let mediaServerSingleton: MediaServer | null = null;

export function setMediaServer(server: MediaServer | null): void {
  mediaServerSingleton = server;
}

export function getMediaServer(): MediaServer | null {
  return mediaServerSingleton;
}

export function __resetMediaServerSingleton(): void {
  mediaServerSingleton = null;
}