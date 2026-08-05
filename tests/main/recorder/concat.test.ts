// writeConcatList + buildConcatArgs — pure functions (D-11 + RESEARCH §2).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildConcatArgs, writeConcatList } from '../../../src/main/recorder/concat';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-concat-'));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('writeConcatList', () => {
  it('writes one `file "<rel>"\n` line per segment; cleanup removes the list file', () => {
    const list = writeConcatList(tmpDir, ['video-seg0.mp4', 'video-seg1.mp4']);
    expect(existsSync(list.listPath)).toBe(true);
    const body = readFileSync(list.listPath, 'utf8');
    expect(body).toBe("file 'video-seg0.mp4'\nfile 'video-seg1.mp4'\n");
    list.cleanup();
    expect(existsSync(list.listPath)).toBe(false);
  });

  it('cleanup swallows ENOENT (idempotent)', () => {
    const list = writeConcatList(tmpDir, ['a.mp4']);
    list.cleanup();
    expect(() => list.cleanup()).not.toThrow();
  });
});

describe('buildConcatArgs', () => {
  it('returns the default `-c copy` arg array', () => {
    expect(
      buildConcatArgs({ listPath: '/x/list.txt', outputPath: '/x/video.mp4' }),
    ).toEqual([
      '-f', 'concat',
      '-safe', '0',
      '-i', '/x/list.txt',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', '/x/video.mp4',
    ]);
  });

  it('fallbackReencode: true swaps `-c copy` for `-c:v libx264 -preset veryfast -crf 23`', () => {
    expect(
      buildConcatArgs({
        listPath: '/x/list.txt',
        outputPath: '/x/video.mp4',
        fallbackReencode: true,
      }),
    ).toEqual([
      '-f', 'concat',
      '-safe', '0',
      '-i', '/x/list.txt',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-y', '/x/video.mp4',
    ]);
  });

  it('throws when listPath is empty', () => {
    expect(() =>
      buildConcatArgs({ listPath: '', outputPath: '/x/video.mp4' }),
    ).toThrow(/empty listPath/);
  });
});
