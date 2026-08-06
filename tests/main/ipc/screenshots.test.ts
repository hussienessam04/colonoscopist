// Screenshots IPC + PROCEDURES_TRIM/RESTORE stub tests. Wave 0 of Plan 01.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

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
  ipcMain: {
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => {
      handlers.set(channel, cb);
    },
    on: () => {},
  },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null, on: () => {}, removeListener: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-shots-ipc-'));
  handlers.clear();
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// Valid 6 KB base64-encoded JPEG payload (tiny but above the 2 KB floor).
// We don't need real JPEG bytes — the handler writes whatever Buffer.from
// produces. The size floor (2 KB decoded) is enforced inside the handler
// regardless of pixel validity.
function fakeJpegBase64(decodedBytes = 4_000): string {
  return Buffer.alloc(decodedBytes, 0xaa).toString('base64');
}

async function bootstrap(): Promise<{ procedureId: string; patientId: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const { session } = await import('../../../src/main/auth/session');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  expect(session.currentUserId).toBe(r.userId);
  const db = getDb();
  const patientId = '00000000-0000-4000-8000-000000000010';
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', Date.now(), Date.now());
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const inserted = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'data/media/patients/abc/proc1/video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  return { procedureId: inserted.id, patientId };
}

describe('screenshots IPC', () => {
  it('add writes the JPEG file + inserts a row + audits screenshot.captured', async () => {
    const { procedureId, patientId } = await bootstrap();
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    const { getDb } = await import('../../../src/main/db');
    registerScreenshotsIpc();
    const add = handlers.get('screenshots:add');
    expect(add).toBeDefined();
    const created = (await add!({}, {
      procedureId,
      timestampInVideoMs: 12_345,
      jpegBase64: fakeJpegBase64(4_000),
    })) as {
      id: number;
      procedureId: string;
      timestampInVideoMs: number;
      filePath: string;
    };
    expect(created.id).toBeGreaterThan(0);
    expect(created.procedureId).toBe(procedureId);
    expect(created.timestampInVideoMs).toBe(12_345);

    // File present on disk at canonical location.
    const expectedAbs = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      patientId,
      procedureId,
      'screenshots',
      '12345.jpg',
    );
    expect(readFileSync(expectedAbs).byteLength).toBe(4_000);
    expect(created.filePath.replace(/\//g, path.sep)).toContain(`screenshots${path.sep}12345.jpg`);

    // Audit row.
    const db = getDb();
    const audits = db.prepare(
      `SELECT action, metadata FROM audit_log WHERE action = 'screenshot.captured' ORDER BY id ASC`,
    ).all() as { action: string; metadata: string }[];
    expect(audits).toHaveLength(1);
    const meta = JSON.parse(audits[0].metadata) as {
      procedureId: string;
      screenshotId: number;
      timestampInVideoMs: number;
    };
    expect(meta.procedureId).toBe(procedureId);
    expect(meta.screenshotId).toBe(created.id);
    expect(meta.timestampInVideoMs).toBe(12_345);
  });

  it('add rejects when the decoded payload is below 2 KB (IPC_VALIDATION)', async () => {
    const { procedureId } = await bootstrap();
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    registerScreenshotsIpc();
    const add = handlers.get('screenshots:add');
    let caught: unknown = null;
    try {
      await add!({}, {
        procedureId,
        timestampInVideoMs: 1,
        jpegBase64: fakeJpegBase64(1_000), // 1 KB decoded < 2 KB floor
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; field?: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.field).toBe('jpegBase64');
  });

  it('add rejects when the decoded payload exceeds 6 MB (IPC_VALIDATION)', async () => {
    const { procedureId } = await bootstrap();
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    registerScreenshotsIpc();
    const add = handlers.get('screenshots:add');
    let caught: unknown = null;
    try {
      // 7 MB decoded — also trips the zod 8_000_000 base64 cap (~6 MB
      // binary), so we use a payload smaller than that but still over
      // the 6 MB handler ceiling.
      await add!({}, {
        procedureId,
        timestampInVideoMs: 1,
        jpegBase64: fakeJpegBase64(6_500_000),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
  });

  it('list returns screenshots ordered by timestamp_in_video ASC', async () => {
    const { procedureId } = await bootstrap();
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const rel = (n: number) => `data/media/p/${procedureId}/screenshots/${n}.jpg`;
    registerScreenshotsIpc();
    const now = Date.now();
    // Insert out of order; list handler must order ASC.
    screenshotsRepo.add({ procedureId, timestampInVideoMs: 300, filePath: rel(300), createdAt: now });
    screenshotsRepo.add({ procedureId, timestampInVideoMs: 100, filePath: rel(100), createdAt: now });
    screenshotsRepo.add({ procedureId, timestampInVideoMs: 200, filePath: rel(200), createdAt: now });
    const list = handlers.get('screenshots:list');
    expect(list).toBeDefined();
    const rows = (await list!({}, { procedureId })) as { timestampInVideoMs: number }[];
    expect(rows.map((r) => r.timestampInVideoMs)).toEqual([100, 200, 300]);
  });

  it('delete rejects for an unknown id (IPC_NOT_FOUND)', async () => {
    await bootstrap();
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    registerScreenshotsIpc();
    const del = handlers.get('screenshots:delete');
    let caught: unknown = null;
    try {
      await del!({}, { id: 99_999 });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_NOT_FOUND');
  });

  it('updateAnnotation rejects empty annotation (IPC_VALIDATION)', async () => {
    const { procedureId } = await bootstrap();
    const { registerScreenshotsIpc } = await import('../../../src/main/ipc/screenshots');
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    registerScreenshotsIpc();
    const row = screenshotsRepo.add({
      procedureId,
      timestampInVideoMs: 1,
      filePath: 'data/media/foo.jpg',
      createdAt: Date.now(),
    });
    const upd = handlers.get('screenshots:update-annotation');
    let caught: unknown = null;
    try {
      await upd!({}, { id: row.id, annotation: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; field?: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.field).toBe('annotation');
  });
});

describe('procedures.trim / procedures.restore real handlers (Plan 03)', () => {
  // Plan 03 replaces the Plan 01 stubs — the handlers now do real work.
  // These tests assert the boundary rejection (unknown procedure id)
  // since the deeper happy-path is exercised in procedures.test.ts.

  it('trim rejects an unknown procedure with IPC_NOT_FOUND', async () => {
    await bootstrap();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('unused');
      },
    });
    const trim = handlers.get('procedures:trim');
    expect(trim).toBeDefined();
    let caught: unknown = null;
    try {
      await trim!({}, { id: '00000000-0000-4000-8000-000000000099', inMs: 0, outMs: 1000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; message: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_NOT_FOUND');
  });

  it('trim validates input via safeParse before throwing (outMs <= inMs)', async () => {
    await bootstrap();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('unused');
      },
    });
    const trim = handlers.get('procedures:trim');
    let caught: unknown = null;
    try {
      await trim!({}, { id: '00000000-0000-4000-8000-000000000099', inMs: 1000, outMs: 500 });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
  });

  it('restore rejects an unknown procedure with IPC_NOT_FOUND', async () => {
    await bootstrap();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('unused');
      },
    });
    const restore = handlers.get('procedures:restore');
    let caught: unknown = null;
    try {
      await restore!({}, { id: '00000000-0000-4000-8000-000000000099' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_NOT_FOUND');
  });
});
