// Centralised userData path resolution (SET-03 foundation).
// Phase 2 adds dbPath() + mediaDir() for the data layer + Phase 4 video storage.
//
// Quick task 20260912-shared-database-optional — `dataRoot()` reads
// the doctor-config JSON to decide whether to use the local
// `<userData>/data` (default) or a shared folder path (opt-in
// toggle). Everything below flows from `dataRoot()` so flipping
// the toggle moves the entire data subtree atomically.
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDataLocationConfig } from './storage/data-location-config';

// Quick task 20260912-shared-database-optional — the effective
// root for everything below `data/`. Local by default; the shared
// path takes over when the doctor toggles "Share database across
// devices" on in Settings → Storage. The toggle takes effect on
// the next app launch (per the data-location-config file header).
export function dataRoot(): string {
  const cfg = getDataLocationConfig();
  if (cfg.enabled && cfg.sharedPath) {
    return cfg.sharedPath;
  }
  return app.getPath('userData');
}

export function dataDir(): string {
  const dir = path.join(dataRoot(), 'data');
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

// Phase 6 / Plan 01 — Doctor profile asset storage (PROF-01, D-04).
// `<userData>/data/profiles/<userId>/signature.{png,jpg}` and
// `.../logo.{png,jpg}` live under per-doctor subdirectories so backup
// zip (Phase 7) captures the subtree naturally. The DB stores the
// userData-relative path per Anti-Pattern 2; absolute resolution
// happens at read time via `profileAssetPath`.
export function profilesDir(): string {
  const dir = path.join(dataDir(), 'profiles');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function profileDir(userId: string): string {
  const dir = path.join(profilesDir(), userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ponytail: resolve the stored relative path against the per-user
// directory at read time. The DB column holds the relative filename
// (e.g. `signature.png`); the helper joins userId + filename so the
// absolute path stays machine-portable.
export function profileAssetPath(userId: string, assetRel: string): string {
  return path.join(profileDir(userId), assetRel);
}

// Phase 6 / Plan 01 — PDF report storage (RPT-05, D-09).
// `<userData>/data/reports/<reportId>.pdf` per CONTEXT.md D-09.
// `reportsDir()` pre-creates the directory; `reportPdfPath()` is a pure
// join so callers can compose the path without a side effect.
export function reportsDir(): string {
  const dir = path.join(dataDir(), 'reports');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function reportPdfPath(reportId: string): string {
  return path.join(reportsDir(), `${reportId}.pdf`);
}

// Phase 6 / Plan 01 — Read-side helper for the PDF template. The
// screenshots table stores userData-relative `file_path` (per
// Anti-Pattern 2); the PDF template runs in main so it has direct FS
// access and can resolve the absolute path here. Never used for writes.
//
// Quick task 20260912-shared-database-optional — joins against
// `dataRoot()` (not `app.getPath('userData')` directly) so a
// screenshot stored by device A still resolves when device B
// reads the same row from the shared DB. Stored paths are
// RELATIVE to the data root (e.g. `data/media/...`); the resolver
// stays the same for both local + shared modes because both
// device roots have a `data/` subtree.
export function screenshotAbsPath(
  _patientId: string,
  _procedureId: string,
  filePath: string,
): string {
  return path.join(dataRoot(), filePath);
}

// Phase 7 / Plan 07-01 — Restore staging directory (D-14).
// `<userData>/data-restore-<timestamp>/` is a SIBLING of the active `data/`
// directory. The active data folder is NEVER overwritten by Phase 7 — only
// an explicit "Activate this backup" button (v1.1 placeholder) would swap
// directories. The doctor can inspect the staging dir with File Explorer
// if the auto-restore hits a snag. No mkdir here — the caller creates the
// directory on demand so staging dirs that never get used don't litter
// the userData folder.
export function restoreStagingDir(timestamp: number): string {
  return path.join(app.getPath('userData'), `data-restore-${timestamp}`);
}

// Phase 8 / Plan 01 — license sidecar storage (LIC-02 + D-10 verbatim).
// The shipped `.lic` artifact is an archiver-produced zip of `license.json` +
// `license.sig`. After activation, the verify-side files are unpacked here
// as flat files so the boot-time verify path reads them without a yauzl
// round-trip on every cold start. Sibling of media/, profiles/, reports/.
export function licenseDir(): string {
  const dir = path.join(dataDir(), 'license');
  mkdirSync(dir, { recursive: true });
  return dir;
}