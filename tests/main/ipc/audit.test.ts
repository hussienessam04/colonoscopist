// Phase 7 / Plan 07-01 — AUDIT_LOG IPC tests (AUDIT-01).
//
// Per Phase 2 Fix 6 + AUDIT-01, the only write surface for audit_log is
// the `audit()` helper inside main. Phase 7 adds the AUDIT_LOG IPC
// channel as a renderer-side write path that ALSO routes through the
// same helper (no bypass). This test file asserts:
//   1. audit.log({action}) appends exactly one row + count increments.
//   2. audit.log({metadata}) round-trips as JSON in the row's metadata column.
//   3. UPDATE/DELETE on audit_log throws via the append-only triggers
//      (Phase 2 hardening — IPC layer didn't accidentally re-open the surface).

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
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-audit-log-'));
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
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  return r.userId;
}

describe('audit:log IPC', () => {
  it('happy path: writes exactly one audit_log row tagged with the active user_id', async () => {
    const userId = await bootstrapAndLogin();
    const { registerAuditIpc } = await import('../../../src/main/ipc/audit');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    registerAuditIpc();
    const handler = handlers.get('audit:log');
    expect(handler).toBeDefined();

    const before = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c;
    const result = await handler!({}, { action: 'audit_view', entityType: 'audit' });
    expect(result).toEqual({ ok: true });
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c;
    expect(after).toBe(before + 1);

    // Most recent row carries our action + the active user_id.
    const row = db
      .prepare(`SELECT action, entity_type, user_id FROM audit_log ORDER BY id DESC LIMIT 1`)
      .get() as { action: string; entity_type: string; user_id: string };
    expect(row.action).toBe('audit_view');
    expect(row.entity_type).toBe('audit');
    expect(row.user_id).toBe(userId);
  });

  it('metadata object round-trips as JSON in the row.metadata column', async () => {
    const userId = await bootstrapAndLogin();
    const { registerAuditIpc } = await import('../../../src/main/ipc/audit');
    const { getDb } = await import('../../../src/main/db');
    const db = getDb();

    registerAuditIpc();
    const handler = handlers.get('audit:log');
    expect(handler).toBeDefined();

    await handler!(
      {},
      {
        action: 'backup.created',
        entityType: 'backup',
        entityId: 'test.zip',
        metadata: { sizeBytes: 1024, procedureCount: 7, note: 'unicode-✓' },
      },
    );

    const row = db
      .prepare(
        `SELECT action, entity_type, entity_id, metadata, user_id FROM audit_log ORDER BY id DESC LIMIT 1`,
      )
      .get() as {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: string;
      user_id: string;
    };
    expect(row.action).toBe('backup.created');
    expect(row.entity_type).toBe('backup');
    expect(row.entity_id).toBe('test.zip');
    expect(row.user_id).toBe(userId);
    const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
    expect(parsed.sizeBytes).toBe(1024);
    expect(parsed.procedureCount).toBe(7);
    expect(parsed.note).toBe('unicode-✓');
  });

  it('unauthenticated: throws IPC_AUTH_REQUIRED and writes no audit row', async () => {
    // Bootstrap but DO NOT log in — session.currentUserId stays null.
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();
    await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });

    const { registerAuditIpc } = await import('../../../src/main/ipc/audit');
    registerAuditIpc();
    const handler = handlers.get('audit:log');
    expect(handler).toBeDefined();

    const db = getDb();
    const before = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c;

    let caught: unknown = null;
    try {
      await handler!({}, { action: 'audit_view' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_AUTH_REQUIRED');

    const after = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c;
    expect(after).toBe(before); // no row added
  });

  it('audit_log append-only trigger still rejects UPDATE attempts (no bypass via audit:log)', async () => {
    // Per Phase 2 Fix 6 / AUDIT-02 — the append-only triggers must
    // remain in force even when the renderer-initiated AUDIT_LOG
    // channel is the most recent writer. This proves the IPC handler
    // didn't accidentally add an UPDATE/DELETE path.
    const userId = await bootstrapAndLogin();
    const { registerAuditIpc } = await import('../../../src/main/ipc/audit');
    const { getDb } = await import('../../../src/main/db');
    registerAuditIpc();
    const handler = handlers.get('audit:log');
    expect(handler).toBeDefined();

    await handler!({}, { action: 'will_be_tampered' });

    const db = getDb();
    expect(() =>
      db.prepare(`UPDATE audit_log SET action = 'tampered' WHERE user_id = ?`).run(userId),
    ).toThrow(/append-only/);

    expect(() =>
      db.prepare(`DELETE FROM audit_log WHERE user_id = ?`).run(userId),
    ).toThrow(/append-only/);
  });

  it('rejects malformed payloads via IPC_VALIDATION (zod .strict())', async () => {
    await bootstrapAndLogin();
    const { registerAuditIpc } = await import('../../../src/main/ipc/audit');
    registerAuditIpc();
    const handler = handlers.get('audit:log');
    expect(handler).toBeDefined();

    // Empty action — zod requires min(1).
    let caught: unknown = null;
    try {
      await handler!({}, { action: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; field?: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_VALIDATION');
    expect(wrapped.ipcError?.field).toBe('action');
  });
});