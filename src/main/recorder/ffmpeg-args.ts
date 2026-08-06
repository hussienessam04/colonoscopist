// ffmpeg argument builder per D-12 + PITFALLS §10 + RESEARCH §1.
// Pure function — no I/O, no spawn — for unit testing.
//
// Per-preset bitrate matrix: sd=4M, hd=10M, custom=5M.
//
// Optional previewTcpPort appends a SECOND output: a low-res MJPEG stream
// to `tcp://127.0.0.1:<port>`. The PreviewServer in main listens on that
// port, splits the concatenated JPEG frames on FF D9 EOI markers, and
// re-serves the latest frame as multipart/x-mixed-replace so the
// renderer's <img src=previewUrl> shows the live feed during recording —
// ffmpeg has the DirectShow device lock, so renderer's getUserMedia
// can't get a stream. Single ffmpeg process, two outputs.

import type { QualityPreset } from '@shared/ipc-contract';
import { EmptyFfmpegArgsError } from '@shared/errors';

export type FfmpegArgsOptions = {
  deviceName: string;
  preset: QualityPreset;
  outputPath: string;
  // Optional tee'd MJPEG preview output (Plan: live preview during recording).
  // When set, appends a second `-map 0:v -vf scale=<previewWidth>:-1 -r 15 -f mjpeg -q:v 5 tcp://...`
  // block so ffmpeg writes a low-res MJPEG preview alongside the main mp4.
  // previewWidth tracks the recording preset (HD capped at 1280).
  previewTcpPort?: number;
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
  const { deviceName, preset, outputPath, previewTcpPort } = opts;
  if (!deviceName || deviceName.length === 0) {
    throw new EmptyFfmpegArgsError('deviceName is empty');
  }
  if (!outputPath || outputPath.length === 0) {
    throw new EmptyFfmpegArgsError('outputPath is empty');
  }
  const spec = presetSpec(preset);
  const args: string[] = [
    '-f', 'dshow',
    '-rtbufsize', '100M',
    '-i', `video=${deviceName}`,
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
  // ponytail: second `-map 0:v` so ffmpeg re-uses the same dshow input for the
  // MJPEG tee. Preview scale tracks the recording preset width so the
  // doctor can see what is being captured at a clinically useful size —
  // 320 wide was too small. HD caps at 1280 to keep the TCP bandwidth
  // trivial (~15fps MJPEG at 1280 wide is ~200-400 KB/s); SD/custom get
  // the recording width directly. -r 15 caps the preview FPS so the
  // renderer doesn't drown in redundant frames. -q:v 5 is the standard
  // ffmpeg MJPEG quality knob (lower=better, 2-5 is fine for preview).
  const recordingWidth = Number(spec.resolution.split('x')[0]);
  const previewWidth = Math.min(recordingWidth, 1280);
  if (previewTcpPort !== undefined && previewTcpPort > 0) {
    args.push(
      '-map', '0:v',
      '-vf', `scale=${previewWidth}:-1`,
      '-r', '15',
      '-f', 'mjpeg',
      '-q:v', '5',
      `tcp://127.0.0.1:${previewTcpPort}`,
    );
  }
  return args;
}

// Phase 5 / Plan 03 / D-08 — pure builder for the one-shot trim subprocess.
// Mirrors Phase 4 concat.ts: pure argv, no spawn, no I/O — for unit tests.
//
// -ss BEFORE -i enables fast keyframe-aligned seek (PITFALLS §2); accepts
// ±500 ms accuracy per D-08. -c copy is mandatory because -ss after -i
// would require a re-encode (incompatible with stream copy).
// -movflags +faststart rewrites the moov atom to the FRONT of the file
// (PITFALLS §1) so the trimmed mp4 plays in browsers without a full
// download first.
// -y overwrites the output path without prompting (the trimmed file is a
// sibling of the original — we never overwrite the original mp4 itself).
export type BuildTrimArgsInput = {
  inputPath: string;
  inMs: number;
  outMs: number;
  outputPath: string;
};

export function buildTrimArgs(opts: BuildTrimArgsInput): string[] {
  if (!opts.inputPath || opts.inputPath.length === 0) {
    throw new EmptyFfmpegArgsError('inputPath is empty');
  }
  if (!opts.outputPath || opts.outputPath.length === 0) {
    throw new EmptyFfmpegArgsError('outputPath is empty');
  }
  if (opts.outMs <= opts.inMs) {
    // PITFALLS §6 / D-08 — outMs must be strictly greater than inMs.
    // Negative or zero duration breaks ffmpeg's -t arithmetic.
    throw new EmptyFfmpegArgsError('outMs must be greater than inMs');
  }
  const inSec = (opts.inMs / 1000).toString();
  const durationSec = ((opts.outMs - opts.inMs) / 1000).toString();
  return [
    '-ss', inSec,
    '-i', opts.inputPath,
    '-t', durationSec,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y', opts.outputPath,
  ];
}