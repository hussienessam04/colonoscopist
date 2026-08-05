// Crash recovery scan — finds orphan partial mp4 files in
// <userData>/data/media/patients/*/*/ and emits one audit row per orphan
// (per D-04 + RESEARCH §3). Re-runs dedup via audit_log LIKE-on-fingerprint.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null, on: () => {}, removeListener: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-orphans-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

import { fingerprintOrphan, scanForOrphans } from '../../../src/main/recorder/orphans';
import { audit, __resetAuditCache } from '../../../src/main/db/audit';
import { getDb, closeDb } from '../../../src/main/db';

function setupPatientsDir(): string {
  // ponytail: mirrors paths.ts:procedureMediaDir() — for tests we point at
  // tmpDir/data/media/patients.
  const patientsDir = path.join(tmpDir, 'data', 'media', 'patients');
  mkdirSync(patientsDir, { recursive: true });
  return patientsDir;
}

function createOrphan(
  patientsDir: string,
  patientId: string,
  procedureId: string,
  opts: { withSidecar?: boolean; sidecarBody?: Record<string, unknown> } = {},
): { orphanAbs: string; sidecarAbs: string } {
  const procDir = path.join(patientsDir, patientId, procedureId);
  mkdirSync(procDir, { recursive: true });
  const orphanAbs = path.join(procDir, 'video-seg0.partial.mp4');
  writeFileSync(orphanAbs, 'fake-mp4-bytes');
  const sidecarAbs = `${orphanAbs}.json`;
  if (opts.withSidecar !== false) {
    const body = opts.sidecarBody ?? {
      procedureId,
      lastKnownTimestampMs: 5000,
      deviceLostAt: 6000,
      deviceName: 'USB Cam',
    };
    writeFileSync(sidecarAbs, JSON.stringify(body));
  }
  return { orphanAbs, sidecarAbs };
}

describe('fingerprintOrphan', () => {
  it('returns a stable 16-char hex hash for the same inputs', () => {
    const a = fingerprintOrphan('p1', 5000, 'sidecar-content');
    const b = fingerprintOrphan('p1', 5000, 'sidecar-content');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it('returns a different hash when inputs differ', () => {
    expect(fingerprintOrphan('p1', 5000, 'a')).not.toBe(fingerprintOrphan('p1', 5000, 'b'));
    expect(fingerprintOrphan('p1', 5000, 'a')).not.toBe(fingerprintOrphan('p2', 5000, 'a'));
  });
});

describe('scanForOrphans', () => {
  beforeEach(() => {
    // Open the DB so audit_log exists. The migrations runner seeds audit_log.
    getDb();
    __resetAuditCache();
  });
  afterEach(() => {
    closeDb();
  });

  it('returns zero counts when the patients directory does not exist (fresh install)', () => {
    // tmpDir exists but data/media/patients does not.
    expect(existsSync(path.join(tmpDir, 'data', 'media', 'patients'))).toBe(false);
    const result = scanForOrphans();
    expect(result).toEqual({ scanned: 0, wrote: 0, skippedDuplicates: 0 });
  });

  it('writes one audit row per unique orphan with sidecar JSON', () => {
    const patientsDir = setupPatientsDir();
    createOrphan(patientsDir, 'p1', 'proc-1');

    const result = scanForOrphans();
    expect(result.scanned).toBe(1);
    expect(result.wrote).toBe(1);
    expect(result.skippedDuplicates).toBe(0);

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT action, entity_id, metadata FROM audit_log WHERE action = 'recording.crash_partial'`,
      )
      .all() as { action: string; entity_id: string; metadata: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity_id).toBe('proc-1');
    const meta = JSON.parse(rows[0]!.metadata);
    expect(meta.deviceName).toBe('USB Cam');
    expect(meta.lastKnownTimestampMs).toBe(5000);
    expect(meta.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(meta.sidecarPath).toMatch(/video-seg0\.partial\.mp4$/);
  });

  it('is idempotent: re-scan does NOT duplicate audit rows', () => {
    const patientsDir = setupPatientsDir();
    createOrphan(patientsDir, 'p1', 'proc-1');

    const first = scanForOrphans();
    expect(first.wrote).toBe(1);
    expect(first.skippedDuplicates).toBe(0);

    const second = scanForOrphans();
    expect(second.scanned).toBe(1);
    expect(second.wrote).toBe(0);
    expect(second.skippedDuplicates).toBe(1);

    const db = getDb();
    const rows = db
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'recording.crash_partial'`)
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('handles orphan files with missing sidecar JSON (deviceName=unknown, lastKnownTimestampMs=0)', () => {
    const patientsDir = setupPatientsDir();
    createOrphan(patientsDir, 'p1', 'proc-1', { withSidecar: false });

    const result = scanForOrphans();
    expect(result.scanned).toBe(1);
    expect(result.wrote).toBe(1);

    const db = getDb();
    const row = db
      .prepare(`SELECT metadata FROM audit_log WHERE action = 'recording.crash_partial'`)
      .get() as { metadata: string };
    const meta = JSON.parse(row.metadata);
    expect(meta.deviceName).toBe('unknown');
    expect(meta.lastKnownTimestampMs).toBe(0);
    expect(meta.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

// silence unused-import warnings
void audit;