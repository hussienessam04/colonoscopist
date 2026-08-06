// procedures:* IPC round-trip + audit + requireSession() gate.
// Plan 04-01 — create is reserved for future plans (recording.start inserts
// the active row); finalize + get + list are exercised here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

// Stub spawn so applyTrim's ffmpeg subprocess returns exit code 0 without
// a real binary. Tests in this file that exercise trim need this.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

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
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  ipcRenderer: {
    invoke: async () => null,
    on: () => {},
    removeListener: () => {},
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-procedures-ipc-'));
  handlers.clear();
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    return {
      stderr: { on: () => undefined },
      on: (e: string, cb: (...a: unknown[]) => void) => {
        if (e === 'exit') {
          Promise.resolve().then(() => cb(0, null));
        }
      },
      kill: () => undefined,
    };
  });
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndLogin(): Promise<string> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const { session } = await import('../../../src/main/auth/session');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  expect(session.currentUserId).toBe(r.userId);
  return r.userId;
}

describe('procedures IPC', () => {
  it('rejects when no session is active (IPC_VALIDATION)', async () => {
    await bootstrapAndLogin();
    // Drop the session.
    const { session } = await import('../../../src/main/auth/session');
    session.clear();

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const get = handlers.get('procedures:get');
    expect(get).toBeDefined();
    let caught: unknown = null;
    try {
      await get!({}, { id: '00000000-0000-4000-8000-000000000001' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    // The wrapped error carries the original ipcError payload.
    const wrapped = caught as Error & { ipcError?: { code: string; message: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.message).toMatch(/Not authenticated/i);
  });

  it('inserts via recording.start path, get + finalize + list round-trip + audit', async () => {
    const adminId = await bootstrapAndLogin();

    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    // Seed a patient for FK.
    const patientId = '00000000-0000-4000-8000-000000000010';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Alice', '1990-01-01', Date.now(), Date.now());

    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: adminId,
      videoPath: 'data/media/patients/abc/proc1/video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });

    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(inserted.status).toBe('recording');

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used in this test');
      },
    });

    const getHandler = handlers.get('procedures:get');
    expect(getHandler).toBeDefined();
    const got = await getHandler!({}, { id: inserted.id });
    expect((got as { id: string }).id).toBe(inserted.id);

    const finalizeHandler = handlers.get('procedures:finalize');
    expect(finalizeHandler).toBeDefined();
    const finalized = (await finalizeHandler!({}, {
      id: inserted.id,
      status: 'completed',
      endedAt: Date.now(),
      durationSeconds: 60,
      videoPath: 'data/media/patients/abc/proc1/video.mp4',
    })) as { status: string; durationSeconds: number };
    expect(finalized.status).toBe('completed');
    expect(finalized.durationSeconds).toBe(60);

    const listHandler = handlers.get('procedures:list');
    expect(listHandler).toBeDefined();
    const list = (await listHandler!({}, { patientId })) as { rows: unknown[]; total: number };
    expect(list.total).toBe(1);
    expect(list.rows).toHaveLength(1);

    // Audit: a row for each mutating IPC.
    const auditRows = db
      .prepare(
        `SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id ASC`,
      )
      .all(inserted.id) as { action: string }[];
    const actions = auditRows.map((r) => r.action);
    expect(actions).toContain('procedure.view');
    expect(actions).toContain('procedure.finalize');
  });

  it('procedures.list pagination + filter (status) round-trip', async () => {
    const adminId = await bootstrapAndLogin();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    const patientId = '00000000-0000-4000-8000-000000000020';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Bob', '1992-02-02', Date.now(), Date.now());

    for (let i = 0; i < 3; i++) {
      proceduresRepo.insert({
        patientId,
        doctorId: adminId,
        videoPath: `data/media/patients/abc/proc${i}/video.mp4`,
        presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
        audioDeviceName: null,
      });
    }

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const listHandler = handlers.get('procedures:list');
    expect(listHandler).toBeDefined();
    const page1 = (await listHandler!({}, { patientId, page: 1, pageSize: 2 })) as {
      rows: unknown[];
      total: number;
    };
    expect(page1.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    const page2 = (await listHandler!({}, { patientId, page: 2, pageSize: 2 })) as {
      rows: unknown[];
      total: number;
    };
    expect(page2.rows).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Plan 03 — procedures.trim + procedures.restore real handlers.
  //
  // The trim handler invokes applyTrim (which spawns ffmpeg); we stub
  // the child_process spawn so the test doesn't need a real ffmpeg
  // binary. The restore handler is purely a repo round-trip.
  // ─────────────────────────────────────────────────────────────────────────

  it('procedures.trim rejects partial recordings with IPC_VALIDATION (D-13)', async () => {
    const adminId = await bootstrapAndLogin();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    const patientId = '00000000-0000-4000-8000-000000000030';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Carol', '1993-03-03', Date.now(), Date.now());
    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: adminId,
      videoPath: 'video.partial.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    proceduresRepo.updateFinalized(inserted.id, {
      endedAt: Date.now(),
      durationSeconds: 30,
      status: 'partial',
      videoPath: 'video.partial.mp4',
    });

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const trimHandler = handlers.get('procedures:trim');
    expect(trimHandler).toBeDefined();
    let caught: unknown = null;
    try {
      await trimHandler!({}, { id: inserted.id, inMs: 0, outMs: 5_000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; message: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.message).toMatch(/partial/);
  });

  it('procedures.restore rejects when video_path_original is null', async () => {
    const adminId = await bootstrapAndLogin();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    const patientId = '00000000-0000-4000-8000-000000000040';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Dave', '1994-04-04', Date.now(), Date.now());
    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: adminId,
      videoPath: 'video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    proceduresRepo.updateFinalized(inserted.id, {
      endedAt: Date.now(),
      durationSeconds: 60,
      status: 'completed',
      videoPath: 'video.mp4',
    });

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const restoreHandler = handlers.get('procedures:restore');
    expect(restoreHandler).toBeDefined();
    let caught: unknown = null;
    try {
      await restoreHandler!({}, { id: inserted.id });
    } catch (err) {
      caught = err;
    }
    const wrapped = caught as Error & { ipcError?: { code: string; message: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.message).toMatch(/original/i);
  });

  it('procedures.restore succeeds when video_path_original is populated + file exists', async () => {
    const adminId = await bootstrapAndLogin();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { writeFileSync, mkdirSync } = await import('node:fs');

    const patientId = '00000000-0000-4000-8000-000000000050';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Eve', '1995-05-05', Date.now(), Date.now());
    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: adminId,
      videoPath: 'video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    proceduresRepo.updateFinalized(inserted.id, {
      endedAt: Date.now(),
      durationSeconds: 60,
      status: 'completed',
      videoPath: 'video.mp4',
    });
    // Write the original file so restoreFromOriginal's fs.existsSync check
    // passes.
    const origAbs = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      patientId,
      inserted.id,
      'video.mp4',
    );
    mkdirSync(path.dirname(origAbs), { recursive: true });
    writeFileSync(origAbs, Buffer.alloc(64));
    // Now simulate a prior trim having populated video_path_original.
    proceduresRepo.updateVideoPath(inserted.id, 'video-trimmed.mp4', 'video.mp4');

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const restoreHandler = handlers.get('procedures:restore');
    expect(restoreHandler).toBeDefined();
    const restored = (await restoreHandler!({}, { id: inserted.id })) as {
      videoPath: string;
      videoPathOriginal: string;
    };
    expect(restored.videoPath).toBe('video.mp4');
    expect(restored.videoPathOriginal).toBe('video.mp4');

    // Audit row carries the procedure.restored action.
    const auditRows = db
      .prepare(`SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id ASC`)
      .all(inserted.id) as { action: string }[];
    expect(auditRows.some((r) => r.action === 'procedure.restored')).toBe(true);
  });

  it('procedures.trim audits procedure.trimmed with userData-relative paths', async () => {
    const adminId = await bootstrapAndLogin();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();
    const { writeFileSync, mkdirSync } = await import('node:fs');

    const patientId = '00000000-0000-4000-8000-000000000060';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Frank', '1996-06-06', Date.now(), Date.now());
    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: adminId,
      videoPath: 'video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    proceduresRepo.updateFinalized(inserted.id, {
      endedAt: Date.now(),
      durationSeconds: 60,
      status: 'completed',
      videoPath: 'video.mp4',
    });
    // Write the source file so applyTrim's existsSync check passes.
    const srcAbs = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      patientId,
      inserted.id,
      'video.mp4',
    );
    mkdirSync(path.dirname(srcAbs), { recursive: true });
    writeFileSync(srcAbs, Buffer.alloc(64));

    // Stub spawn so applyTrim's ffmpeg subprocess returns exit code 0
    // without needing a real binary. The mock is set up in beforeEach()
    // at the module level.

    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const trimHandler = handlers.get('procedures:trim');
    expect(trimHandler).toBeDefined();
    const trimmed = (await trimHandler!({}, {
      id: inserted.id,
      inMs: 1_000,
      outMs: 30_000,
    })) as { videoPath: string; videoPathOriginal: string };
    expect(trimmed.videoPath).toBe('video-trimmed.mp4');
    expect(trimmed.videoPathOriginal).toBe('video.mp4');

    // Audit row carries procedure.trimmed + the userData-relative paths.
    const auditRows = db
      .prepare(
        `SELECT action, metadata FROM audit_log WHERE entity_id = ? AND action = 'procedure.trimmed'`,
      )
      .all(inserted.id) as { action: string; metadata: string | null }[];
    expect(auditRows.length).toBeGreaterThan(0);
    const meta = JSON.parse(auditRows[0]?.metadata ?? '{}');
    expect(meta.inMs).toBe(1_000);
    expect(meta.outMs).toBe(30_000);
    expect(meta.originalVideoPath).toBe('video.mp4');
    expect(meta.trimmedVideoPath).toBe('video-trimmed.mp4');
  });
});