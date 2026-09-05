// screenshots:get-blob IPC handler tests — Phase 8 / Plan 19 (G-08-12).
//
// Closes G-08-12: "browser rejected blob" error. The main-side handler
// must return a fresh ArrayBuffer (not a Buffer-backed Uint8Array view)
// so the renderer receives a clean buffer that survives the IPC
// structured clone and is usable as a BlobPart.
//
// Coverage:
//   1. Happy path — writes a real JPEG on disk, calls the IPC handler
//      directly, asserts `bytes` is a real ArrayBuffer (not a Buffer or
//      Buffer-backed Uint8Array view) with the correct length + content.
//   2. Not found — invalid id returns `{ok:false, code:'IPC_SCREENSHOT_NOT_FOUND'}`.
//   3. Corrupted file — the file is deleted between row insert and the
//      IPC call; the handler throws (IPC error path), surfaced as the
//      dispatcher's thrown error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-getblob-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const REL_PATH = 'data/media/patients/p1/proc1/screenshots/5000.jpg';

// Minimal JPEG bytes (SOI + APP0 + EOI). Real magic-byte header so the
// handler treats the file as a valid JPEG payload.
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

async function seedScreenshot(): Promise<{ id: number }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });

  const patientId = '00000000-0000-4000-8000-000000000010';
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', 'MRN-GB-1', Date.now(), Date.now());

  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const proc = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'data/media/patients/p1/proc1/video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });

  const absPath = path.join(tmpDir, REL_PATH);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, JPEG_BYTES);

  const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
  const row = screenshotsRepo.add({
    procedureId: proc.id,
    timestampInVideoMs: 5000,
    filePath: REL_PATH,
    createdAt: Date.now(),
  });
  return { id: row.id };
}

// Invoke the IPC handler the way main actually calls it: register the
// handler, then capture it via ipcMain.handle mock + invoke it directly.
// Cleaner approach: register the module's exported handlers via the
// real registration entry, then dispatch through ipcMain.
async function callGetBlob(id: number): Promise<unknown> {
  const { ipcMain } = await import('electron');
  type Handler = (e: unknown, raw: unknown) => Promise<unknown>;
  let captured: Handler | null = null;
  // Re-mock ipcMain.handle to capture the registered handler.
  const orig = (ipcMain as unknown as { handle: (ch: string, h: Handler) => void }).handle;
  (ipcMain as unknown as { handle: (ch: string, h: Handler) => void }).handle = (ch, h) => {
    if (ch === 'screenshots:get-blob') captured = h;
    return orig(ch, h);
  };
  try {
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    registerScreenshotsIpc();
    if (!captured) throw new Error('getBlob handler was not registered');
    return await captured({}, { id });
  } finally {
    (ipcMain as unknown as { handle: (ch: string, h: Handler) => void }).handle = orig;
  }
}

describe('screenshots:get-blob (Plan 19 / G-08-12)', () => {
  it('happy path: returns a fresh ArrayBuffer of the JPEG bytes + image/jpeg mime', async () => {
    const { id } = await seedScreenshot();
    const result = await callGetBlob(id);

    // Phase 8 / Plan 19 — `bytes` is an ArrayBuffer. This is the
    // round-trip invariant: a Buffer-backed Uint8Array view used to
    // ship and the browser rejected the resulting blob. A fresh
    // ArrayBuffer survives structured clone cleanly.
    expect(result).toBeDefined();
    const r = result as { ok: true; bytes: ArrayBuffer; mimeType: string };
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');

    // The buffer is a real ArrayBuffer — not a Buffer / Node-land type.
    expect(r.bytes).toBeInstanceOf(ArrayBuffer);
    expect(r.bytes.byteLength).toBe(JPEG_BYTES.byteLength);

    // Bytes round-trip byte-for-byte.
    const received = new Uint8Array(r.bytes);
    expect(Array.from(received)).toEqual(Array.from(JPEG_BYTES));
    expect(r.mimeType).toBe('image/jpeg');
  });

  it('returns ok:false with IPC_SCREENSHOT_NOT_FOUND for an unknown id', async () => {
    const result = await callGetBlob(99_999);
    expect(result).toEqual({ ok: false, code: 'IPC_SCREENSHOT_NOT_FOUND' });
  });

  it('throws (IPC error path) when the underlying JPEG file is missing', async () => {
    const { id } = await seedScreenshot();
    // Delete the file after the row exists — the handler will fail
    // on readFile and throw an error (the IPC dispatcher surfaces this
    // as a renderer-side rejection).
    const { unlinkSync } = await import('node:fs');
    unlinkSync(path.join(tmpDir, REL_PATH));

    await expect(callGetBlob(id)).rejects.toThrow();
  });
});