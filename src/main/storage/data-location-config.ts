// data-location-config — app-level (NOT in-DB) JSON file at
// `<userData>/data-location.json` that records whether the doctor
// opted in to sharing the SQLite DB across devices via a shared
// folder (SMB / NFS / Dropbox mounted as a folder / etc.).
//
// Quick task 20260912-shared-database-optional.
//
// Why a JSON file instead of a `settings` table row:
//   The DB IS the storage location the toggle points at. Storing
//   the pointer IN the DB is circular (where does the DB that
//   records "the DB lives at X" live?). The config lives outside
//   the DB at the local userData root — the doctor always has a
//   stable local app config even when the DB is shared.
//
// ponytail: file ops are sync because every consumer (paths.ts +
// app boot) runs before the renderer mounts and reads them off
// the main thread. async fs would force a refactor of `paths.ts`
// to be async-aware, which is more churn than this toggle
// justifies. Reads are cached at module load; the toggle change
// applies on the next app launch (UI explicitly says so).

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type DataLocationConfig = {
  enabled: boolean;
  // Absolute path to the shared folder (NOT including `/data`).
  // Ignored when `enabled === false`.
  sharedPath: string | null;
  // Unix ms of the last write.
  updatedAt: number;
};

const DEFAULT_CONFIG: DataLocationConfig = {
  enabled: false,
  sharedPath: null,
  updatedAt: 0,
};

function configPath(): string {
  // Always local — see file header.
  return path.join(app.getPath('userData'), 'data-location.json');
}

function readFromDisk(): DataLocationConfig {
  const file = configPath();
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DataLocationConfig>;
    // Defensive validation — a corrupted or hand-edited config
    // should fall back to defaults rather than crash the app.
    return {
      enabled: parsed.enabled === true,
      sharedPath:
        typeof parsed.sharedPath === 'string' && parsed.sharedPath.length > 0
          ? parsed.sharedPath
          : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeToDisk(cfg: DataLocationConfig): void {
  const file = configPath();
  // Make sure the userData folder exists. Electron normally
  // creates it on first launch, but a doctor who wiped
  // userData could land here on the very first boot.
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
}

// Module-level cache. `paths.ts` reads from this on every call
// (cheap). Config writes bump the cache so subsequent reads in
// the same process see the new value — the renderer can't toggle
// from "local" to "shared" mid-session (we require restart),
// but other main-process handlers that fire after the toggle
// (e.g. audit logging) read the fresh value.
let cache: DataLocationConfig | null = null;

export function getDataLocationConfig(): DataLocationConfig {
  if (cache === null) cache = readFromDisk();
  return cache;
}

export function setDataLocationConfig(next: {
  enabled: boolean;
  sharedPath: string | null;
}): DataLocationConfig {
  const validated: DataLocationConfig = {
    enabled: next.enabled === true,
    sharedPath:
      typeof next.sharedPath === 'string' && next.sharedPath.length > 0
        ? next.sharedPath
        : null,
    updatedAt: Date.now(),
  };
  writeToDisk(validated);
  cache = validated;
  return validated;
}

// Used by tests + the IPC handler. Returns null when the path is
// unusable (missing / not a directory / not writable).
export function validateSharedPath(candidate: string): {
  ok: boolean;
  reason?: 'missing' | 'not-directory' | 'not-writable';
} {
  try {
    if (!existsSync(candidate)) return { ok: false, reason: 'missing' };
    const stat = statSync(candidate);
    if (!stat.isDirectory()) return { ok: false, reason: 'not-directory' };
    // Probe writability: try to create + remove a sentinel file.
    const sentinel = path.join(candidate, `.colonoscopist-write-probe-${Date.now()}`);
    try {
      writeFileSync(sentinel, '');
      // Sync fs is fine — fs.unlinkSync removes the probe.
      // Use try/finally so a probe write that succeeds but a
      // probe delete that fails doesn't leak the file forever.
      try {
        // ponytail: defer the unlink to a side-effect import so
        // the sync read/write flow stays self-contained. Use
        // node:fs unlinkSync via require lazily to avoid adding
        // an import line just for the probe cleanup.
        const { unlinkSync } = require('node:fs') as typeof import('node:fs');
        unlinkSync(sentinel);
      } catch {
        // ignore — probe file is harmless if it lingers
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'not-writable' };
    }
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

// Used by the IPC handler + tests to force a re-read from disk.
// The renderer can't toggle mid-session, but tests do.
export function __resetDataLocationConfigCache(): void {
  cache = null;
}