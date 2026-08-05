// procedures:* IPC round-trip + audit + requireSession() gate.
// Plan 04-01 — create is reserved for future plans (recording.start inserts
// the active row); finalize + get + list are exercised here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
});