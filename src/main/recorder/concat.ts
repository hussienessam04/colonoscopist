// Segment concat helpers — D-11 + RESEARCH §2.
// Pure functions: writeConcatList + buildConcatArgs do no spawning. The
// supervisor spawns the ffmpeg subprocess in init.ts with windowsVerbatimArguments.
//
// Concatenation uses -c copy by default because every segment is encoded
// by the same ffmpeg invocation (identical fourcc/codec tag/profile/level/
// SPS-PPS per RESEARCH §2). On failure, init.ts retries with -c:v libx264
// to force a re-encode (the fallback path).

import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export type WriteConcatListResult = {
  listPath: string;
  cleanup(): void;
};

// ponytail: escape embedded single quotes per the ffmpeg concat demuxer spec
// (segment filenames are pure ASCII in our model, so this is defensive).
function escapeForConcat(s: string): string {
  return s.replace(/'/g, "\\'");
}

export function writeConcatList(mediaDir: string, segmentRelPaths: string[]): WriteConcatListResult {
  const listPath = path.join(mediaDir, 'concat-list.txt');
  // ffmpeg concat demuxer line: `file '<relative>'` — relative to the list
  // file's directory, so the segment paths must be filenames only (no
  // directory component). Each segment already lives in `mediaDir`.
  const body = segmentRelPaths
    .map((rel) => `file '${escapeForConcat(rel)}'`)
    .join('\n') + '\n';
  writeFileSync(listPath, body, 'utf8');
  return {
    listPath,
    cleanup(): void {
      // Best-effort: swallow ENOENT so a missing cleanup never aborts finalize.
      try {
        unlinkSync(listPath);
      } catch {
        // ignore
      }
    },
  };
}

export type BuildConcatArgsInput = {
  listPath: string;
  outputPath: string;
  fallbackReencode?: boolean;
};

export function buildConcatArgs(opts: BuildConcatArgsInput): string[] {
  if (!opts.listPath || opts.listPath.length === 0) {
    throw new Error('empty listPath');
  }
  const base = ['-f', 'concat', '-safe', '0', '-i', opts.listPath];
  const codec = opts.fallbackReencode
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
    : ['-c', 'copy'];
  return [...base, ...codec, '-movflags', '+faststart', '-y', opts.outputPath];
}
