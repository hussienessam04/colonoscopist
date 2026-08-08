// doctor_profile table repository — cached prepared statements only.
// Per CONTEXT.md D-01..D-04 + PROF-01.
//
// One row per user (user_id is UNIQUE). Signature + logo paths are stored
// userData-relative per Anti-Pattern 2; resolution to absolute paths
// happens at read time via profileAssetPath(userId, assetRel).
//
// `upsert` is the only write path: callers passing new profile data hit
// the insert branch when no row exists, the updateCore branch otherwise.
// updateSignaturePath / updateLogoPath are separate so the IPC handler
// can write the file to disk first and then commit the path without
// re-sending the rest of the profile.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';
import type { DoctorProfile } from '@shared/ipc-contract';

export type DoctorProfileRow = {
  id: string;
  user_id: string;
  full_name_en: string;
  full_name_ar: string | null;
  clinic_name_en: string;
  clinic_name_ar: string | null;
  address: string | null;
  phone: string | null;
  signature_path: string | null;
  logo_path: string | null;
  created_at: number;
  updated_at: number;
};

export type DoctorProfileUpsertInput = {
  userId: string;
  fullNameEn: string;
  fullNameAr?: string | null;
  clinicNameEn: string;
  clinicNameAr?: string | null;
  address?: string | null;
  phone?: string | null;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  updateCore: Stmt;
  updateSignature: Stmt;
  updateLogo: Stmt;
  getById: Stmt;
  getByUserId: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO doctor_profile
        (id, user_id, full_name_en, full_name_ar, clinic_name_en, clinic_name_ar,
         address, phone, signature_path, logo_path, created_at, updated_at)
       VALUES
        (@id, @user_id, @full_name_en, @full_name_ar, @clinic_name_en, @clinic_name_ar,
         @address, @phone, NULL, NULL, @created_at, @updated_at)`,
    ),
    updateCore: db.prepare(
      `UPDATE doctor_profile SET
         full_name_en = @full_name_en,
         full_name_ar = @full_name_ar,
         clinic_name_en = @clinic_name_en,
         clinic_name_ar = @clinic_name_ar,
         address = @address,
         phone = @phone,
         updated_at = @updated_at
       WHERE user_id = @user_id`,
    ),
    updateSignature: db.prepare(
      `UPDATE doctor_profile SET signature_path = @signature_path, updated_at = @updated_at
       WHERE user_id = @user_id`,
    ),
    updateLogo: db.prepare(
      `UPDATE doctor_profile SET logo_path = @logo_path, updated_at = @updated_at
       WHERE user_id = @user_id`,
    ),
    getById: db.prepare(`SELECT * FROM doctor_profile WHERE id = ?`),
    getByUserId: db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements
// must be dropped on teardown.
export function __resetDoctorProfileRepoCache(): void {
  cached = null;
}

function rowToProfile(row: DoctorProfileRow): DoctorProfile {
  return {
    id: row.id,
    userId: row.user_id,
    fullNameEn: row.full_name_en,
    fullNameAr: row.full_name_ar,
    clinicNameEn: row.clinic_name_en,
    clinicNameAr: row.clinic_name_ar,
    address: row.address,
    phone: row.phone,
    signaturePath: row.signature_path,
    logoPath: row.logo_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const doctorProfileRepo = {
  // ponytail: explicit insert-vs-update branch via getByUserId rather than
  // `INSERT ... ON CONFLICT` so the caller's audit row can distinguish
  // `profile.created` from `profile.updated` (see IPC handler).
  upsert(input: DoctorProfileUpsertInput): DoctorProfile {
    const existing = this.get(input.userId);
    const now = Date.now();
    if (existing) {
      stmts().updateCore.run({
        full_name_en: input.fullNameEn,
        full_name_ar: input.fullNameAr ?? null,
        clinic_name_en: input.clinicNameEn,
        clinic_name_ar: input.clinicNameAr ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        updated_at: now,
        user_id: input.userId,
      });
    } else {
      stmts().insert.run({
        id: randomUUID(),
        user_id: input.userId,
        full_name_en: input.fullNameEn,
        full_name_ar: input.fullNameAr ?? null,
        clinic_name_en: input.clinicNameEn,
        clinic_name_ar: input.clinicNameAr ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        created_at: now,
        updated_at: now,
      });
    }
    const refreshed = this.get(input.userId);
    if (!refreshed) {
      throw new Error('doctor_profile row missing immediately after upsert');
    }
    return refreshed;
  },

  get(userId: string): DoctorProfile | null {
    const row = stmts().getByUserId.get(userId) as DoctorProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  },

  updateSignaturePath(userId: string, signaturePath: string): void {
    stmts().updateSignature.run({
      signature_path: signaturePath,
      updated_at: Date.now(),
      user_id: userId,
    });
  },

  updateLogoPath(userId: string, logoPath: string): void {
    stmts().updateLogo.run({
      logo_path: logoPath,
      updated_at: Date.now(),
      user_id: userId,
    });
  },
};
