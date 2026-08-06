// Recorder initialization — wires the singleton registry, the default Recorder
// factory, and the IPC push-event forwarder. Plan 04 fills scanForOrphans body.
//
// Phase 5 / Plan 03 — also boots the long-lived MediaServer (localhost HTTP
// server that serves the canonical / trimmed mp4 to the renderer's <video>)
// and registers the singleton via the registry so the `recording:get-media-url`
// IPC handler can find it without a circular import.

import { BrowserWindow } from 'electron';
import { Recorder, buildDefaultDeps, type RecorderDeps } from './recorder';
import { MediaServer } from './preview-server';
import { setMediaServer } from './registry';
import type { RecordingStatus } from '@shared/ipc-contract';
import { scanForOrphans as realScanForOrphans } from './orphans';

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

// ponytail: separate from initRecorder() so the await on MediaServer.start()
// doesn't block the IPC handler registrations. main/index.ts calls this
// after the IPC layer is wired so the renderer can immediately fetch the
// media URL via `recording.getMediaUrl()`.
let mediaServerSingleton: MediaServer | null = null;

export async function initMediaServer(): Promise<MediaServer> {
  if (mediaServerSingleton && mediaServerSingleton.isRunning()) {
    return mediaServerSingleton;
  }
  const server = new MediaServer();
  await server.start();
  mediaServerSingleton = server;
  setMediaServer(server);
  return server;
}

// ponytail: re-export the real implementation from orphans.ts. main/index.ts
// already calls scanForOrphans() at boot — no call-site change required.
export const scanForOrphans = realScanForOrphans;

// ponytail: cleanup hook so app shutdown can tear the media server down
// without main/index.ts having to know about the MediaServer class.
export async function shutdownMediaServer(): Promise<void> {
  if (mediaServerSingleton) {
    await mediaServerSingleton.stop();
    mediaServerSingleton = null;
    setMediaServer(null);
  }
}