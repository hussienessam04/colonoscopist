// useUpdater — SWR-style hook for the Settings → About update card.
//
// Quick task 20260913-64l: polls APP_UPDATE_GET_STATE every 30s
// (cheap, no IPC if unchanged). Exposes the state plus action
// callbacks that match the renderer-side workflow:
//   - check()  → manual re-check (fire-and-forget)
//   - download() → kick off the download, progress surfaces via
//     the polling state.progress field
//   - install()  → quitAndInstall() — the renderer does NOT wait;
//     quitAndInstall tears down the window synchronously
//
// ponytail: no stale-fetch guard. The 30s poll is cheap and
// idempotent; race conditions between check() and getState() are
// resolved by the next poll tick.

import { useCallback, useEffect, useState } from 'react';
import type { AppUpdateState } from '@shared/ipc-contract';

export type UseUpdaterResult = {
  state: AppUpdateState;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => void;
};

const INITIAL: AppUpdateState = {
  available: false,
  downloaded: false,
  progress: null,
  latestVersion: null,
  currentVersion: '0.0.0',
  error: null,
};

export function useUpdater(): UseUpdaterResult {
  const [state, setState] = useState<AppUpdateState>(INITIAL);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.api.app.update?.getState?.();
    if (next) setState(next);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const check = useCallback(async (): Promise<void> => {
    await window.api.app.update?.check?.();
    await refresh();
  }, [refresh]);

  const download = useCallback(async (): Promise<void> => {
    await window.api.app.update?.download?.();
    await refresh();
  }, [refresh]);

  const install = useCallback((): void => {
    window.api.app.update?.install?.();
  }, []);

  return { state, check, download, install };
}
