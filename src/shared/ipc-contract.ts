// Single source of truth for IPC channel names and contract types.
// Imported by main, preload, and renderer (via global Window augmentation).
//
// No SET-04 (user management) channels in Phase 1 — the stub is rendered in
// the renderer, not wired through IPC. Real CRUD ships in Phase 2.

export const IPC = {
  AUTH_STATUS: 'auth:status',
} as const;

// Discriminated union — extends in later phases.
// Phase 1: only the `scaffold` variant is reachable from `src/main/ipc/auth.ts`.
export type AuthStatus = { authenticated: false; reason: 'scaffold' };

// What `contextBridge.exposeInMainWorld('api', api)` exposes to the renderer.
// Every later phase appends to this interface, never invents a new one.
export interface IpcContract {
  auth: {
    status: () => Promise<AuthStatus>;
  };
}

declare global {
  interface Window {
    api: IpcContract;
  }
}