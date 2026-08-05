// procedure-notes:* IPC round-trip + audit + requireSession() gate.
// Plan 04-02 — D-06/D-07/D-09. Empty body and over-length bodies fail at the
// DB CHECK (per Don't Hand-Roll "Notes length validation"). Audit metadata
// carries bodyLength only, never the body content (per Fix 6).

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-procedure-notes-'));
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

async function bootstrapAndLogin(): Promise<{
  doctorId: string;
  patientId: string;
  procedureId: string;
}> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const { session } = await import('../../../src/main/auth/session');
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  expect(session.currentUserId).toBe(r.userId);

  // Seed a patient + procedure for FK satisfaction.
  const db = getDb();
  const patientId = '00000000-0000-4000-8000-000000000001';
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', Date.now(), Date.now());
  const inserted = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: '',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });

  return { doctorId: r.userId, patientId, procedureId: inserted.id };
}

describe('procedure-notes IPC', () => {
  it('happy path: create returns { id, procedureId, body, createdAt } and persists', async () => {
    const { doctorId, procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const create = handlers.get('procedure-notes:create');
    expect(create).toBeDefined();
    const before = Date.now();
    const note = (await create!({}, { procedureId, body: 'Polyp at 12 o\'clock' })) as {
      id: number;
      procedureId: string;
      body: string;
      createdAt: number;
    };
    const after = Date.now();
    expect(note.id).toBeGreaterThan(0);
    expect(note.procedureId).toBe(procedureId);
    expect(note.body).toBe("Polyp at 12 o'clock");
    expect(note.createdAt).toBeGreaterThanOrEqual(before);
    expect(note.createdAt).toBeLessThanOrEqual(after + 50);

    const rows = db
      .prepare(`SELECT body, procedure_id AS procedureId, created_at AS createdAt FROM procedure_notes WHERE id = ?`)
      .get(note.id) as { body: string; procedureId: string; createdAt: number };
    expect(rows.body).toBe("Polyp at 12 o'clock");
    expect(rows.procedureId).toBe(procedureId);

    // Audit row content.
    const audits = db
      .prepare(
        `SELECT action, entity_type, entity_id, user_id, metadata FROM audit_log WHERE entity_id = ? AND action = 'procedure.note_added'`,
      )
      .all(procedureId) as {
      action: string;
      entity_type: string;
      entity_id: string;
      user_id: string;
      metadata: string;
    }[];
    expect(audits).toHaveLength(1);
    expect(audits[0].entity_type).toBe('procedure');
    expect(audits[0].entity_id).toBe(procedureId);
    expect(audits[0].user_id).toBe(doctorId);
    const meta = JSON.parse(audits[0].metadata) as { bodyLength: number };
    expect(meta.bodyLength).toBe("Polyp at 12 o'clock".length);
    // per Fix 6: body content never appears in audit metadata
    expect(audits[0].metadata).not.toContain('Polyp');
  });

  it('empty body: throws IPC_VALIDATION with field=body (DB CHECK)', async () => {
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const create = handlers.get('procedure-notes:create');
    expect(create).toBeDefined();
    let caught: unknown = null;
    try {
      await create!({}, { procedureId, body: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; field?: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.field).toBe('body');
  });

  it('over-length body (1001 chars): throws IPC_VALIDATION with field=body', async () => {
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const create = handlers.get('procedure-notes:create');
    expect(create).toBeDefined();
    let caught: unknown = null;
    try {
      await create!({}, { procedureId, body: 'x'.repeat(1001) });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; field?: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.field).toBe('body');
  });

  it('unauthenticated: throws IPC_VALIDATION and writes no note/audit row (T-04-11)', async () => {
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    // Drop session AFTER bootstrap so the seed rows exist.
    const { session } = await import('../../../src/main/auth/session');
    session.clear();

    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const notesBefore = (db.prepare(`SELECT COUNT(*) AS c FROM procedure_notes`).get() as {
      c: number;
    }).c;
    const auditBefore = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as {
      c: number;
    }).c;

    const create = handlers.get('procedure-notes:create');
    expect(create).toBeDefined();
    let caught: unknown = null;
    try {
      await create!({}, { procedureId, body: 'should not be persisted' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; message: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.message).toMatch(/Not authenticated/i);

    const notesAfter = (db.prepare(`SELECT COUNT(*) AS c FROM procedure_notes`).get() as {
      c: number;
    }).c;
    const auditAfter = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as {
      c: number;
    }).c;
    expect(notesAfter).toBe(notesBefore);
    expect(auditAfter).toBe(auditBefore);
  });

  it('audit row metadata carries bodyLength only, never the body content', async () => {
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const secret = 'secret-marker-9af3';
    const create = handlers.get('procedure-notes:create');
    expect(create).toBeDefined();
    await create!({}, { procedureId, body: `body contains ${secret} token` });

    const audits = db
      .prepare(
        `SELECT metadata FROM audit_log WHERE entity_id = ? AND action = 'procedure.note_added' ORDER BY id DESC LIMIT 1`,
      )
      .all(procedureId) as { metadata: string }[];
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).not.toContain(secret);
    const meta = JSON.parse(audits[0].metadata) as { bodyLength: number };
    expect(meta.bodyLength).toBe(`body contains ${secret} token`.length);
  });

  it('list returns rows in created_at ASC order; empty list returns []', async () => {
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');

    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const list = handlers.get('procedure-notes:list');
    expect(list).toBeDefined();

    const empty = (await list!({}, { procedureId })) as { id: number; body: string }[];
    expect(empty).toEqual([]);

    // Insert three notes with strictly increasing timestamps.
    const a = proceduresRepo.insertNote({ procedureId, body: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    const b = proceduresRepo.insertNote({ procedureId, body: 'second' });
    await new Promise((r) => setTimeout(r, 5));
    const c = proceduresRepo.insertNote({ procedureId, body: 'third' });

    const rows = (await list!({}, { procedureId })) as {
      id: number;
      body: string;
      createdAt: number;
    }[];
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(rows.map((r) => r.body)).toEqual(['first', 'second', 'third']);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].createdAt).toBeGreaterThanOrEqual(rows[i - 1].createdAt);
    }
  });

  it('list writes one audit_log row with action=procedure.note_list (AUDIT-01 reads)', async () => {
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const list = handlers.get('procedure-notes:list');
    expect(list).toBeDefined();
    await list!({}, { procedureId });

    const audits = db
      .prepare(
        `SELECT action, entity_id, metadata FROM audit_log WHERE action = 'procedure.note_list'`,
      )
      .all() as { action: string; entity_id: string; metadata: string }[];
    expect(audits).toHaveLength(1);
    expect(audits[0].entity_id).toBe(procedureId);
    const meta = JSON.parse(audits[0].metadata) as { procedureId: string; count: number };
    expect(meta.procedureId).toBe(procedureId);
    expect(meta.count).toBe(0);
  });

  it('create inside a transaction rolls back the audit row on a CHECK violation', async () => {
    // Per AUDIT-01 + D-07 — a failed insert must not leave a half-written audit row.
    const { procedureId } = await bootstrapAndLogin();
    const { registerProceduresIpc } = await import('../../../src/main/ipc/procedures');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    registerProceduresIpc({
      createProcedure: () => {
        throw new Error('not used');
      },
    });

    const auditsBefore = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as {
      c: number;
    }).c;

    const create = handlers.get('procedure-notes:create');
    expect(create).toBeDefined();
    let caught: unknown = null;
    try {
      await create!({}, { procedureId, body: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();

    const auditsAfter = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as {
      c: number;
    }).c;
    expect(auditsAfter).toBe(auditsBefore);
  });
});
