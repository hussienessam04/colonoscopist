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
  // Quick task 260812-ns0 — report-branding + procedure-defaults fields.
  header_image_path: string | null;
  footer_image_path: string | null;
  premedication: string | null;
  // Phase 7 / Plan 07-01 — I18N-01 (per D-17): per-doctor language
  // override. NULL means "follow users.language" (the doctor has not
  // picked their own preference yet). The renderer-side i18n resolver
  // reads this column first, then falls back to the active session's
  // users.language row.
  language: 'en' | 'ar' | null;
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
  // Quick task 260812-ns0 — premedication (free-text clinic default;
  // optional in profile.update; null clears, undefined leaves as-is).
  premedication?: string | null;
  // Phase 7 / Plan 07-01 — I18N-01. Optional; undefined means "leave
  // the existing value as-is", null means "clear the per-doctor
  // override so the resolver falls back to users.language".
  language?: 'en' | 'ar' | null;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  updateCore: Stmt;
  updateSignature: Stmt;
  updateLogo: Stmt;
  updateHeader: Stmt;
  updateFooter: Stmt;
  getById: Stmt;
  getByUserId: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    // Phase 7 / Plan 07-01 — I18N-01: include the language column on
    // insert. NULL on insert means "follow users.language" (the
    // wizard doesn't seed a per-doctor override).
    // Quick task 260812-ns0 — header/footer/premedication default to
    // NULL on insert so backfill rows for existing doctors get NULL.
    insert: db.prepare(
      `INSERT INTO doctor_profile
        (id, user_id, full_name_en, full_name_ar, clinic_name_en, clinic_name_ar,
         address, phone, signature_path, logo_path,
         header_image_path, footer_image_path, premedication,
         language, created_at, updated_at)
       VALUES
        (@id, @user_id, @full_name_en, @full_name_ar, @clinic_name_en, @clinic_name_ar,
         @address, @phone, NULL, NULL,
         NULL, NULL, NULL,
         @language, @created_at, @updated_at)`,
    ),
    // Phase 7 / Plan 07-01 — I18N-01: language is part of the core
    // update so a single profile.update IPC can flip the doctor's
    // preferred language alongside other fields.
    // Quick task 260812-ns0 — premedication joins the core update.
    updateCore: db.prepare(
      `UPDATE doctor_profile SET
         full_name_en = @full_name_en,
         full_name_ar = @full_name_ar,
         clinic_name_en = @clinic_name_en,
         clinic_name_ar = @clinic_name_ar,
         address = @address,
         phone = @phone,
         language = @language,
         premedication = @premedication,
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
    updateHeader: db.prepare(
      `UPDATE doctor_profile SET header_image_path = @header_image_path, updated_at = @updated_at
       WHERE user_id = @user_id`,
    ),
    updateFooter: db.prepare(
      `UPDATE doctor_profile SET footer_image_path = @footer_image_path, updated_at = @updated_at
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
    // Quick task 260812-ns0 — header/footer/premedication surfaces.
    headerImagePath: row.header_image_path,
    footerImagePath: row.footer_image_path,
    premedication: row.premedication,
    // Phase 7 / Plan 07-01 — I18N-01: surface language for the
    // renderer. NULL means "follow users.language".
    language: row.language,
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
    // ponytail: for the update branch, language defaults to "keep
    // existing" if the caller passed `undefined`. For the insert branch,
    // language defaults to NULL (the doctor's first row has no
    // per-doctor override yet — they fall back to users.language).
    const updateLanguage = input.language !== undefined
      ? input.language
      : existing?.language ?? null;
    if (existing) {
      stmts().updateCore.run({
        full_name_en: input.fullNameEn,
        full_name_ar: input.fullNameAr ?? null,
        clinic_name_en: input.clinicNameEn,
        clinic_name_ar: input.clinicNameAr ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        language: updateLanguage,
        // Quick task 260812-ns0 — `undefined` means "leave as-is" for
        // premedication (mirrors the language contract). Existing
        // callers that don't set premedication preserve whatever's in
        // the DB.
        premedication: input.premedication !== undefined ? input.premedication : existing.premedication,
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
        language: input.language ?? null,
        // Quick task 260812-ns0 — default NULL on insert (no per-row
        // premedication seeded by the wizard).
        premedication: input.premedication ?? null,
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

  // Quick task 260812-ns0 — header / footer image uploads mirror the
  // signature / logo pattern: file is committed to disk by the IPC
  // handler first, then the path is written here.
  updateHeaderImagePath(userId: string, headerImagePath: string): void {
    stmts().updateHeader.run({
      header_image_path: headerImagePath,
      updated_at: Date.now(),
      user_id: userId,
    });
  },

  updateFooterImagePath(userId: string, footerImagePath: string): void {
    stmts().updateFooter.run({
      footer_image_path: footerImagePath,
      updated_at: Date.now(),
      user_id: userId,
    });
  },
};
