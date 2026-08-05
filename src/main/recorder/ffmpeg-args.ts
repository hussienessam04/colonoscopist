// ffmpeg argument builder per D-12 + PITFALLS §10 + RESEARCH §1.
// Pure function — no I/O, no spawn — for unit testing.
//
// Per-preset bitrate matrix: sd=4M, hd=10M, custom=5M.

import type { QualityPreset } from '@shared/ipc-contract';
import { EmptyFfmpegArgsError } from '@shared/errors';

export type FfmpegArgsOptions = {
  deviceName: string;
  preset: QualityPreset;
  outputPath: string;
};

// ponytail: resolution defaults live next to the preset — single source.
function presetSpec(preset: QualityPreset): {
  resolution: string;
  framerate: number;
  bitrate: string;
} {
  if (preset.preset === 'sd') return { resolution: '720x480', framerate: 30, bitrate: '4M' };
  if (preset.preset === 'hd') return { resolution: '1920x1080', framerate: 30, bitrate: '10M' };
  return { resolution: preset.resolution, framerate: preset.framerate, bitrate: '5M' };
}

export function buildFfmpegArgs(opts: FfmpegArgsOptions): string[] {
  const { deviceName, preset, outputPath } = opts;
  if (!deviceName || deviceName.length === 0) {
    throw new EmptyFfmpegArgsError('deviceName is empty');
  }
  if (!outputPath || outputPath.length === 0) {
    throw new EmptyFfmpegArgsError('outputPath is empty');
  }
  const spec = presetSpec(preset);
  return [
    '-f', 'dshow',
    '-rtbufsize', '100M',
    '-i', `video=${deviceName},`, // trailing comma — dshow expects no audio device
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-r', String(spec.framerate),
    '-s', spec.resolution,
    '-b:v', spec.bitrate,
    '-y', outputPath,
  ];
}