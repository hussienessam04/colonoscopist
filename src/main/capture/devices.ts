// DirectShow device enumeration via ffmpeg-static.
//
// Phase 3 enumerates only; recording (the ffmpeg -i dshow arg) is Phase 4.
// ponytail: spawn once per IPC call, no caching here — renderer pages cache
// the list themselves (D-10 locks "re-enter to refresh").

import { spawn } from 'node:child_process';
import { canonicalizeName } from './canonicalize';
import { defaultFfmpegPath } from '../recorder/ffmpeg-path';
import type { CaptureDevice } from '@shared/ipc-contract';

export type EnumerateDshowOptions = {
  // Test hook: override the spawn callable so unit tests can mock ffmpeg.
  spawnFn?: typeof spawn;
  // Test hook: override the ffmpeg path returned by ffmpeg-static.
  ffmpegPath?: string;
};

// Quick task 260913-rp5 — use the shared `defaultFfmpegPath` from
// `recorder/ffmpeg-path.ts` (which rewrites `app.asar` →
// `app.asar.unpacked` so the binary is executable on Windows when
// shipped inside an asar). The local helper that previously lived
// here returned the raw `ffmpeg-static` path INSIDE app.asar, which
// spawn() can't execute (`Error: spawn ENOENT`) — exactly the error
// the user hit running the installed app. recorder.ts + trim.ts have
// always used the shared helper; capture/devices.ts shipped without
// the rewrite, hence the long-standing gap.

export async function enumerateDshowDevices(
  opts: EnumerateDshowOptions = {},
): Promise<CaptureDevice[]> {
  const spawnFn = opts.spawnFn ?? spawn;
  const ffmpegPath = opts.ffmpegPath ?? defaultFfmpegPath();

  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const proc = spawnFn(ffmpegPath, [
      '-list_devices',
      'true',
      '-f',
      'dshow',
      '-i',
      'dummy',
    ]);

    if (!proc) {
      reject(new Error('Failed to spawn ffmpeg'));
      return;
    }

    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      resolve(parseDshowVideoDevices(stderr));
    });
  });
}

export function parseDshowVideoDevices(stderr: string): CaptureDevice[] {
  const devices: CaptureDevice[] = [];
  let inVideo = false;
  let index = 0;
  for (const line of stderr.split('\n')) {
    if (line.includes('DirectShow video devices')) {
      inVideo = true;
      continue;
    }
    if (line.includes('DirectShow audio devices')) {
      inVideo = false;
      continue;
    }
    if (!inVideo) continue;
    // ponytail: real ffmpeg output looks like `[dshow @ 0x...]  "USB Video Device"`.
    // The `[dshow …]` prefix is optional so banner-only strings still match.
    const m = line.match(/^\s*(?:\[[^\]]+\])?\s*"([^"]+)"\s*$/);
    if (!m) continue;
    const raw = m[1];
    try {
      const canonical = canonicalizeName(raw);
      if (canonical.length === 0) continue;
      devices.push({
        deviceId: canonical,
        rawName: raw,
        index: index++,
        type: 'dshow',
      });
    } catch {
      // ponytail: empty canonical is filtered above; future validation throws
      // skip the row instead of crashing the whole enumeration.
    }
  }
  return devices;
}
