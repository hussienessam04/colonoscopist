// Centralised userData path resolution (SET-03 foundation).
// Phase 2 adds dbPath() + mediaDir() for the data layer + Phase 4 video storage.

import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), 'app.db');
}

export function mediaDir(): string {
  const dir = path.join(dataDir(), 'media');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Per D-03 + Anti-Pattern 2 — every procedure gets its own directory under
// <userData>/data/media/patients/<patientId>/<procedureId> so partial mp4s
// can be quarantined without colliding with active recordings.
export function procedureMediaDir(patientId: string, procedureId: string): string {
  const dir = path.join(mediaDir(), 'patients', patientId, procedureId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Phase 5 / D-04 — screenshots live under the procedure's media directory in a
// `screenshots/` subfolder. Not pre-created here; the screenshots.add IPC
// handler creates it lazily on first write.
export function screenshotsDir(patientId: string, procedureId: string): string {
  return path.join(procedureMediaDir(patientId, procedureId), 'screenshots');
}

// Phase 5 / D-07 — canonical resolver for the procedures.video_path column.
// The DB stores the path as a userData-relative form per Anti-Pattern 2;
// both the trim subprocess (applyTrim) and the PreviewServer /media/ route
// route absolute resolution through this helper so the path derivation
// stays in one place. Lazy mkdir is intentionally absent — the caller is
// expected to already have a procedure directory on disk (either via a
// prior recording stop or a prior trim).
export function videoFilePath(
  patientId: string,
  procedureId: string,
  videoRel: string,
): string {
  return path.join(procedureMediaDir(patientId, procedureId), videoRel);
}