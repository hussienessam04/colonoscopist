// devices.test.ts — CAPT-01 (mock spawn) + CAPT-10 (parser round-trip).
//
// Uses the EnumerateDshowOptions.spawnFn test hook already present in
// devices.ts so we never actually exec ffmpeg in CI / Mac dev. The test
// stub emits realistic ffmpeg dshow output and asserts:
//   - the parser returns ONLY DirectShow VIDEO entries (audio section excluded)
//   - canonical names round-trip the canonicalize pipeline edge cases
//     (NFC, zero-width, whitespace collapse, trim)
//   - each returned CaptureDevice carries the canonical deviceId + rawName
//
// Per CAPT-01 / CAPT-10 / D-11.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

let tmpDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-devices-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// Stub ChildProcess that delivers stderr on the next tick, then emits close.
class StubChild extends EventEmitter {
  stderr = new EventEmitter();
  // ponytail: never actually used, but the signature matches ChildProcess
  // just enough for the parser to attach to stderr + close.
}

function makeStubSpawn(stderrPayload: string): ReturnType<typeof vi.fn> {
  return vi.fn(() => {
    const child = new StubChild();
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from(stderrPayload, 'utf8'));
      child.emit('close', 0);
    });
    return child;
  });
}

const SAMPLE_DSHOW_VIDEO = `ffmpeg version 5.2.0 Copyright (c) 2000-2024 the FFmpeg developers
[dshow @ 000001a3] DirectShow video devices
[dshow @ 000001a3]  "USB Video Device"
[dshow @ 000001a3]  "HDMI Capture (1080p)"
[dshow @ 000001a3]  "EasyCap USB2.0 TV"
[dshow @ 000001a3] DirectShow audio devices
[dshow @ 000001a3]  "Microphone (Realtek Audio)"
[dshow @ 000001a3]  "Line In"
dummy: Immediate exit requested
`;

const SAMPLE_DSHOW_EMPTY = `ffmpeg version 5.2.0
[dshow @ 000001a3] DirectShow video devices
[dshow @ 000001a3] DirectShow audio devices
dummy: Immediate exit requested
`;

const SAMPLE_DSHOW_MIXED_WHITESPACE = [
  'ffmpeg version 5.2.0',
  '[dshow @ 000001a3] DirectShow video devices',
  '[dshow @ 000001a3]  "  USB  Video   Device  "',
  '[dshow @ 000001a3]  "EasyCap\tUSB2.0\tTV"',
  '[dshow @ 000001a3] DirectShow audio devices',
  '[dshow @ 000001a3]  "ignored audio device"',
  '',
].join('\n');

const SAMPLE_DSHOW_NON_ASCII = `ffmpeg version 5.2.0
[dshow @ 000001a3] DirectShow video devices
[dshow @ 000001a3]  "\u00DCmlauts Capture"
[dshow @ 000001a3]  "USB\u200B\u200C Video"
[dshow @ 000001a3] DirectShow audio devices
`;

const SAMPLE_DSHOW_ZERO_WIDTH = `ffmpeg version 5.2.0
[dshow @ 000001a3] DirectShow video devices
[dshow @ 000001a3]  "\uFEFFEasyCap"
[dshow @ 000001a3] DirectShow audio devices
`;

describe('parseDshowVideoDevices', () => {
  it('returns only entries from the DirectShow VIDEO section and excludes audio devices', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');

    const devices = parseDshowVideoDevices(SAMPLE_DSHOW_VIDEO);

    expect(devices.map((d) => d.deviceId)).toEqual([
      'USB Video Device',
      'HDMI Capture (1080p)',
      'EasyCap USB2.0 TV',
    ]);
    // ponytail: explicit negative assertion — the audio lines must NEVER leak
    // into the renderer payload.
    for (const d of devices) {
      expect(d.deviceId).not.toMatch(/Microphone|Line In/);
    }
  });

  it('returns an empty array when the VIDEO section has no quoted names', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    expect(parseDshowVideoDevices(SAMPLE_DSHOW_EMPTY)).toEqual([]);
  });

  it('preserves each captured entry\'s rawName alongside the canonical deviceId', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    const devices = parseDshowVideoDevices(SAMPLE_DSHOW_VIDEO);
    expect(devices[0]).toEqual({
      deviceId: 'USB Video Device',
      rawName: 'USB Video Device',
      index: 0,
      type: 'dshow',
    });
    expect(devices[1].index).toBe(1);
    expect(devices[2].index).toBe(2);
  });

  it('canonicalizes mixed whitespace, leading/trailing, tabs and double-spaces', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    const devices = parseDshowVideoDevices(SAMPLE_DSHOW_MIXED_WHITESPACE);
    expect(devices.map((d) => d.deviceId)).toEqual(['USB Video Device', 'EasyCap USB2.0 TV']);
    // ponytail: the raw form survives in rawName so audit can still tell us
    // what the doctor saw, but deviceId is the canonical form.
    expect(devices[0].rawName).toBe('  USB  Video   Device  ');
    expect(devices[1].rawName).toBe('EasyCap\tUSB2.0\tTV');
  });

  it('NF-normalizes non-ASCII names and strips zero-width chars', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    const devices = parseDshowVideoDevices(SAMPLE_DSHOW_NON_ASCII);
    expect(devices.map((d) => d.deviceId)).toEqual([
      '\u00DCmlauts Capture',
      'USB Video',
    ]);
    expect(devices[0].rawName).toBe('\u00DCmlauts Capture');
    expect(devices[1].rawName).toBe('USB\u200B\u200C Video');
  });

  it('strips a leading BOM so the same device matches across boots', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    const devices = parseDshowVideoDevices(SAMPLE_DSHOW_ZERO_WIDTH);
    expect(devices.map((d) => d.deviceId)).toEqual(['EasyCap']);
  });

  it('drops empty canonical names (whitespace + zero-width only) without crashing', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    const stderr = [
      `[dshow] DirectShow video devices`,
      `[dshow]  "   "`,
      `[dshow]  "\u200B"`,
      `[dshow]  "Good Device"`,
      `[dshow] DirectShow audio devices`,
      ``,
    ].join('\n');
    const devices = parseDshowVideoDevices(stderr);
    expect(devices.map((d) => d.deviceId)).toEqual(['Good Device']);
  });

  it('does not treat non-quoted ffmpeg banner lines as devices', async () => {
    const { parseDshowVideoDevices } = await import('../../../src/main/capture/devices');
    const stderr = [
      `ffmpeg version 5.2.0`,
      `  built with gcc 13.2.0`,
      `[dshow] DirectShow video devices`,
      `[dshow]  "Only Video"`,
      `[dshow] DirectShow audio devices`,
      ``,
    ].join('\n');
    const devices = parseDshowVideoDevices(stderr);
    expect(devices.map((d) => d.deviceId)).toEqual(['Only Video']);
  });
});

describe('enumerateDshowDevices', () => {
  it('forwards stderr through the parser and resolves with the canonical list', async () => {
    const { enumerateDshowDevices } = await import('../../../src/main/capture/devices');
    const spawnFn = makeStubSpawn(SAMPLE_DSHOW_VIDEO);
    const devices = await enumerateDshowDevices({
      spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
      ffmpegPath: '/fake/ffmpeg',
    });
    expect(devices.map((d) => d.deviceId)).toEqual([
      'USB Video Device',
      'HDMI Capture (1080p)',
      'EasyCap USB2.0 TV',
    ]);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const args = spawnFn.mock.calls[0]?.[1] as string[];
    expect(args).toEqual(['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  });

  it('rejects with the spawn error when ffmpeg cannot be exec\'d', async () => {
    const { enumerateDshowDevices } = await import('../../../src/main/capture/devices');
    const child = new StubChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    });
    await expect(
      enumerateDshowDevices({
        spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
        ffmpegPath: '/fake/ffmpeg',
      }),
    ).rejects.toThrow('ENOENT');
  });
});