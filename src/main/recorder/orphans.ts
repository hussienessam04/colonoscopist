// Crash recovery scanner — walks the patient/procedure tree once at launch
// and emits one audit row per orphan partial mp4 (per D-04 + RESEARCH §3).
//
// ponytail: NEVER delete orphan files — Phase 7 cleanup owns deletion. We
// only surface them via the audit log so the doctor sees them in the Audit
// page (Phase 7 audit UI) and can resolve manually.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import { audit } from '../db/audit';
import { getDb } from '../db';

export type ScanForOrphansResult = {
  scanned: number;
  wrote: number;
  skippedDuplicates: number;
};

// ponytail: pure — no I/O. Fingerprint = sha256 over (procedureId +
// lastKnownTimestampMs + sidecarContent) truncated to 16 hex chars. Two
// orphans with the same inputs dedup to the same fingerprint, so the
// audit_log LIKE-on-metadata check is robust.
export function fingerprintOrphan(
  procedureId: string,
  lastKnownTimestampMs: number,
  sidecarContent: string,
): string {
  const h = createHash('sha256');
  h.update(`${procedureId}:${lastKnownTimestampMs}:${sidecarContent}`);
  return h.digest('hex').slice(0, 16);
}

function patientsDir(): string {
  // ponytail: paths.ts:mediaDir() returns `<userData>/data/media` and creates
  // it on demand. We want `<userData>/data/media/patients` specifically.
  return join(app.getPath('userData'), 'data', 'media', 'patients');
}

// ponytail: depth-2 walk — explicit two-level readdir keeps us on Node 20.16
// semantics (no `recursive: true` dep). Patients are level 1, procedures are
// level 2; segment files live INSIDE the procedure directory.
function* walkProcedureDirs(): Generator<{ patientId: string; procedureId: string; procedureDir: string }> {
  const root = patientsDir();
  if (!existsSync(root)) return;
  for (const patientEntry of readdirSync(root, { withFileTypes: true })) {
    if (!patientEntry.isDirectory()) continue;
    const patientId = patientEntry.name;
    const patientDir = join(root, patientId);
    for (const procEntry of readdirSync(patientDir, { withFileTypes: true })) {
      if (!procEntry.isDirectory()) continue;
      yield {
        patientId,
        procedureId: procEntry.name,
        procedureDir: join(patientDir, procEntry.name),
      };
    }
  }
}

function findOrphanFiles(procedureDir: string): string[] {
  const files = readdirSync(procedureDir, { withFileTypes: true });
  const orphans: string[] = [];
  for (const f of files) {
    if (!f.isFile()) continue;
    // The Phase 4 partial-suffix contract — match `<anything>.partial.mp4`
    // (NOT `<anything>.partial.mp4.json` — that's the sidecar).
    if (f.name.endsWith('.partial.mp4')) {
      orphans.push(join(procedureDir, f.name));
    }
  }
  return orphans;
}

// ponytail: depth-2 walk — explicit two-level readdir keeps us on Node 20.16
// semantics (no `recursive: true` dep). Patients are level 1, procedures are
// level 2; segment files live INSIDE the procedure directory.

function hasAuditRow(fingerprint: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM audit_log
       WHERE action = 'recording.crash_partial'
         AND metadata LIKE ?`,
    )
    .get(`%${fingerprint}%`) as { c: number };
  return row.c > 0;
}

export function scanForOrphans(): ScanForOrphansResult {
  const root = patientsDir();
  if (!existsSync(root)) {
    return { scanned: 0, wrote: 0, skippedDuplicates: 0 };
  }
  let scanned = 0;
  let wrote = 0;
  let skippedDuplicates = 0;
  for (const { procedureId, procedureDir } of walkProcedureDirs()) {
    const orphans = findOrphanFiles(procedureDir);
    for (const orphanAbs of orphans) {
      scanned++;
      const sidecarAbs = `${orphanAbs}.json`;
      let lastKnownTimestampMs = 0;
      let deviceName = 'unknown';
      let sidecarContent = '';
      if (existsSync(sidecarAbs)) {
        try {
          sidecarContent = readFileSync(sidecarAbs, 'utf8');
          const parsed = JSON.parse(sidecarContent) as {
            procedureId?: string;
            lastKnownTimestampMs?: number;
            deviceName?: string;
          };
          lastKnownTimestampMs =
            typeof parsed.lastKnownTimestampMs === 'number' ? parsed.lastKnownTimestampMs : 0;
          deviceName = parsed.deviceName ?? 'unknown';
        } catch {
          // Malformed JSON — fall back to defaults; the fingerprint still
          // dedups re-runs because it includes the raw content.
        }
      }
      const fingerprint = fingerprintOrphan(procedureId, lastKnownTimestampMs, sidecarContent);
      if (hasAuditRow(fingerprint)) {
        skippedDuplicates++;
        continue;
      }
      const relPath = orphanAbs
        .replace(`${app.getPath('userData')}${require('node:path').sep}`, '')
        .replace(/\\/g, '/');
      audit({
        action: 'recording.crash_partial',
        entityType: 'procedure',
        entityId: procedureId,
        metadata: {
          lastKnownTimestampMs,
          deviceName,
          sidecarPath: relPath,
          fingerprint,
        },
      });
      wrote++;
    }
  }
  return { scanned, wrote, skippedDuplicates };
}