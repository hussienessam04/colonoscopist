// ffmpeg-static path resolver with asarUnpack rewrite (per PITFALLS §10 + SKILL §2).
//
// In dev: ffmpeg-static returns a path inside node_modules/ffmpeg-static/.
// In packaged builds: the binary lives inside app.asar (and would be
// non-executable) — `build.asarUnpack: ["**/node_modules/ffmpeg-static/**"]`
// copies it next to app.asar.unpacked and we rewrite the path.

import { existsSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';

let cached: string | null = null;

export function defaultFfmpegPath(): string {
  if (cached) return cached;
  if (!ffmpegStatic) {
    throw new Error('ffmpeg-static not bundled');
  }
  const resolved = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked');
  if (!existsSync(resolved)) {
    throw new Error(`ffmpeg binary not found at ${resolved}; check build.asarUnpack`);
  }
  cached = resolved;
  return resolved;
}

// Test hook: drop the cached path so tests can re-derive with a stubbed ffmpeg-static.
export function __resetFfmpegPathCache(): void {
  cached = null;
}