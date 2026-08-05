// Recorder initialization — wires the singleton registry, the default Recorder
// factory, and the IPC push-event forwarder. Plan 04 fills scanForOrphans body.

import { BrowserWindow } from 'electron';
import { Recorder, buildDefaultDeps, type RecorderDeps } from './recorder';
import type { RecordingStatus } from '@shared/ipc-contract';

export function initRecorder(): {
  newRecorder: (depsOverrides?: Partial<RecorderDeps>) => Recorder;
  emit: (status: RecordingStatus) => void;
} {
  const deps = buildDefaultDeps({
    emit: (status) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('recording:status', status);
      }
    },
  });

  return {
    newRecorder: (overrides) => new Recorder({ ...deps, ...(overrides ?? {}) }),
    emit: deps.emit,
  };
}

// ponytail: Plan 04 fills the body. Stub keeps the call sites stable.
export async function scanForOrphans(): Promise<void> {
  /* implemented in plan 04 */
}