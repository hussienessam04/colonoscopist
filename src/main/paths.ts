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

// Phase 5 / D-07 + G-05-5 — canonical resolver for the procedures.video_path
// column. `videoRel` MUST be a FILENAME within the procedure directory
// (e.g. `video.mp4`, `video-trimmed.mp4`, `video-seg0.mp4.partial.mp4`).
// It is NOT a userData-relative path; the recorder's `relativeVideoPath`
// stores just the filename and this helper joins the procedure directory
// at READ time. The trim subprocess (applyTrim) and
// `proceduresRepo.restoreFromOriginal` route resolution through here so
// the path derivation stays in one place. Lazy mkdir is intentionally
// absent — the caller is expected to already have a procedure directory
// on disk (either via a prior recording stop or a prior trim).
export function videoFilePath(
  patientId: string,
  procedureId: string,
  videoRel: string,
): string {
  return path.join(procedureMediaDir(patientId, procedureId), videoRel);
}