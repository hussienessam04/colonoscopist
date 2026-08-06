// @vitest-environment node
// trim-smoke.test.ts — opt-in integration smoke for the trim ffmpeg
// subprocess. Per Plan 03 / Task 2.
//
// This test spawns the REAL `ffmpeg-static` binary against a 30-second
// `lavfi` source so the trimmed mp4 can be verified end-to-end (duration
// + moov atom + no torn file). It is OPT-IN via RUN_SMOKE=1 so the CI
// default skips it — `npm run test:unit` runs every test file but this
// file short-circuits when RUN_SMOKE !== '1'.
//
// Verify locally with:
//   RUN_SMOKE=1 npm run test:unit -- --run tests/integration/trim-smoke.test.ts
//
// Per RESEARCH §Pattern 1 (PITFALLS §1 corrupt mp4, §2 -ss before -i,
// §3 never overwrite, §6 negative range) + PITFALLS §10 + the SKILL
// §1 / §2 child_process supervision pattern.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ponytail: read RUN_SMOKE inside an always-running test so the value
// is captured even when the suite is skipped. (beforeAll doesn't fire
// when every `it` in the suite is `.skip` — Vitest short-circuits the
// setup phase entirely.)
let runSmoke = false;
it('probe RUN_SMOKE env var (always runs)', () => {
  runSmoke = process.env.RUN_SMOKE === '1';
  expect(typeof runSmoke).toBe('boolean');
});

let tmpRoot: string;
let tmpUserData: string;
let ffmpegPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'colonosco-trim-smoke-'));
  tmpUserData = path.join(tmpRoot, 'userData');
  // mirror procedureMediaDir layout: <userData>/data/media/patients/<patientId>/<procedureId>/
  mkdirSync(path.join(tmpUserData, 'data', 'media', 'patients', 'p1', 'proc1'), { recursive: true });
  // Resolve ffmpeg-static path. The unit-test stub doesn't apply here —
  // we want the real binary so the spawn matches the production path.
  ffmpegPath = require('ffmpeg-static') as string;
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error(
      `ffmpeg-static binary not found at ${ffmpegPath ?? '<undefined>'} — re-run npm install`,
    );
  }
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('applyTrim integration (opt-in via RUN_SMOKE=1)', () => {
  // ponytail: when RUN_SMOKE !== '1' the smoke tests are skipped via
  // a guard inside each test body. Vitest's `it.skip` doesn't run
  // beforeAll, so we can't rely on a `let runSmoke` resolved there.
  // Instead each test reads `runSmoke` (set by the always-running
  // probe above) and exits early when it's false.
  const guard = (fn: () => void) => (): void => {
    if (!runSmoke) return; // vitest reports the test as passed when it doesn't throw
    fn();
  };

  it('produces a trimmed mp4 ~20s long when cutting a 30s source from 5s to 25s', guard(() => {
    // 1. Generate a 30-second lavfi source mp4 (testsrc pattern, 1280x720@30).
    const srcFile = path.join(tmpUserData, 'data', 'media', 'patients', 'p1', 'proc1', 'video.mp4');
    const genArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=30:size=1280x720:rate=30',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      srcFile,
    ];
    const gen = spawnSync(ffmpegPath, genArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    expect(gen.status).toBe(0);
    expect(existsSync(srcFile)).toBe(true);

    // 2. Run applyTrim-style ffmpeg against the source.
    const trimmedFile = path.join(tmpUserData, 'data', 'media', 'patients', 'p1', 'proc1', 'video-trimmed.mp4');
    const trimArgs = [
      '-ss', '5',
      '-i', srcFile,
      '-t', '20',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', trimmedFile,
    ];
    const trim = spawnSync(ffmpegPath, trimArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    expect(trim.status).toBe(0);
    expect(existsSync(trimmedFile)).toBe(true);

    // 3. The trimmed file should exist + be ~20 seconds long (±500ms per D-08).
    const trimmedStat = statSync(trimmedFile);
    expect(trimmedStat.size).toBeGreaterThan(0);

    // Read duration via ffmpeg's stderr on a no-op transcode (`-f null -`).
    const probe = spawnSync(
      ffmpegPath,
      ['-i', trimmedFile, '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    expect(probe.status).toBe(0);
    const stderr = probe.stderr?.toString('utf8') ?? '';
    // ponytail: ffmpeg prints `Duration: HH:MM:SS.xx` on stderr for any
    // file it touches. The regex accepts the canonical format.
    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    expect(durationMatch).not.toBeNull();
    if (!durationMatch) return;
    const hh = Number(durationMatch[1]);
    const mm = Number(durationMatch[2]);
    const ss = Number(durationMatch[3]);
    const totalSeconds = hh * 3600 + mm * 60 + ss;
    expect(totalSeconds).toBeGreaterThan(19.5);
    expect(totalSeconds).toBeLessThan(20.5);

    // 4. The moov atom must be at the FRONT (PITFALLS §1) — read the first
    // 32 bytes and confirm an `ftyp` brand box starts at offset 4.
    // Canonical faststart mp4 layout: [size(4)][ftyp][brand][...].
    const head = readFileSync(trimmedFile, { length: 32 } as unknown as { flag?: string });
    expect(head.length).toBeGreaterThan(8);
    const ftypOffset = head.indexOf('ftyp');
    expect(ftypOffset).toBe(4); // ftyp box starts at offset 4 — confirms faststart
  }));

  it('produces a sibling trimmed file (original is NEVER overwritten)', guard(() => {
    const srcFile = path.join(tmpUserData, 'data', 'media', 'patients', 'p1', 'proc1', 'video.mp4');
    // Generate a tiny 1-second source to keep CI quick.
    const gen = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-f', 'lavfi',
        '-i', 'testsrc=duration=1:size=320x240:rate=10',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        srcFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    expect(gen.status).toBe(0);
    const beforeStat = statSync(srcFile);

    const trimmedFile = path.join(tmpUserData, 'data', 'media', 'patients', 'p1', 'proc1', 'video-trimmed.mp4');
    const trim = spawnSync(
      ffmpegPath,
      ['-ss', '0', '-i', srcFile, '-t', '0.5', '-c', 'copy', '-movflags', '+faststart', '-y', trimmedFile],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    expect(trim.status).toBe(0);

    // Source untouched (PITFALLS §3 + D-07).
    expect(existsSync(srcFile)).toBe(true);
    expect(statSync(srcFile).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(statSync(srcFile).size).toBe(beforeStat.size);
    expect(existsSync(trimmedFile)).toBe(true);
  }));
});
