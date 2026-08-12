// used-devices table repository — cached prepared statements only.
// Per Quick task 260812-ns0: 1:N table for the devices a clinic uses
// during procedures (endoscope, processor, light source, monitor).
// ON DELETE CASCADE on profile_id so dropping a doctor_profile row
// (rare admin path) cascades cleanly.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';

export type UsedDevice = {
  id: string;
  profileId: string;
  name: string;
  notes: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type UsedDeviceRow = {
  id: string;
  profile_id: string;
  name: string;
  notes: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type UsedDeviceInsertInput = {
  profileId: string;
  name: string;
  notes?: string | null;
  sortOrder?: number;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  delete: Stmt;
  listByProfile: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO used_devices (id, profile_id, name, notes, sort_order, created_at, updated_at)
       VALUES (@id, @profile_id, @name, @notes, @sort_order, @created_at, @updated_at)`,
    ),
    delete: db.prepare(`DELETE FROM used_devices WHERE id = ?`),
    listByProfile: db.prepare(
      `SELECT * FROM used_devices WHERE profile_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    ),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements
// must be dropped on teardown.
export function __resetUsedDevicesRepoCache(): void {
  cached = null;
}

function rowToDevice(row: UsedDeviceRow): UsedDevice {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    notes: row.notes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const usedDevicesRepo = {
  add(input: UsedDeviceInsertInput): UsedDevice {
    const now = Date.now();
    const id = randomUUID();
    stmts().insert.run({
      id,
      profile_id: input.profileId,
      name: input.name,
      notes: input.notes ?? null,
      sort_order: input.sortOrder ?? 0,
      created_at: now,
      updated_at: now,
    });
    const fresh = this.get(id);
    if (!fresh) {
      throw new Error('used_devices row missing immediately after insert');
    }
    return fresh;
  },

  get(id: string): UsedDevice | null {
    const row = getDb()
      .prepare(`SELECT * FROM used_devices WHERE id = ?`)
      .get(id) as UsedDeviceRow | undefined;
    return row ? rowToDevice(row) : null;
  },

  listByProfile(profileId: string): UsedDevice[] {
    const rows = stmts().listByProfile.all(profileId) as UsedDeviceRow[];
    return rows.map(rowToDevice);
  },

  remove(id: string): boolean {
    return stmts().delete.run(id).changes > 0;
  },
};