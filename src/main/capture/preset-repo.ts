// Per-doctor default + per-doctor-per-device preset matrix in `settings`.
//
// BLOCKER 4: `doctorId` is NEVER derived from the renderer payload. Every
// repo method takes a `doctorId` that the IPC layer passes from
// `requireSession()`; the renderer cannot influence the key.
//
// CAPT-10 / D-11: `deviceId` is the canonical form (NFC + trim + collapse).
// Repo canonicalizes ONCE on write so a stray non-canonical input never
// generates a stray key.

import { getDb } from '../db';
import { canonicalizeOrThrow } from './canonicalize';
import type { QualityPreset } from '@shared/ipc-contract';

export const SETTINGS_KEY_VERSION = 1;

export function defaultDeviceKey(doctorId: string): string {
  return `capture.default_device_id.${doctorId}`;
}

export function presetKey(doctorId: string, deviceId: string): string {
  return `capture.preset.${doctorId}.${deviceId}`;
}

export const presetRepo = {
  getDefault(doctorId: string): string | null {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(defaultDeviceKey(doctorId)) as { value: string } | undefined;
    if (!row) return null;
    // ponytail: trust-but-still-canonicalize — nothing escapes the boundary.
    try {
      return canonicalizeOrThrow(row.value);
    } catch {
      return null;
    }
  },

  setDefault(doctorId: string, deviceId: string): void {
    const canonical = canonicalizeOrThrow(deviceId);
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(defaultDeviceKey(doctorId), canonical, Date.now());
  },

  getPreset(doctorId: string, deviceId: string): QualityPreset | null {
    const canonical = canonicalizeOrThrow(deviceId);
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(presetKey(doctorId, canonical)) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as QualityPreset;
    } catch {
      return null;
    }
  },

  setPreset(doctorId: string, deviceId: string, preset: QualityPreset): void {
    const canonical = canonicalizeOrThrow(deviceId);
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(presetKey(doctorId, canonical), JSON.stringify(preset), Date.now());
  },
};
