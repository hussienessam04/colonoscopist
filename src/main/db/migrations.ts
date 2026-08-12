// Versioned, append-only migration runner.
// Each migration runs inside db.transaction so a mid-migration failure rolls back.
// Per D-01 first-launch atomicity.

import type Database from 'better-sqlite3';
import initSql from './migrations/0001_init.sql?raw';
import proceduresSql from './migrations/0002_procedures.sql?raw';
import screenshotsAndTrimSql from './migrations/0003_screenshots_and_trim.sql?raw';
import doctorProfileAndReportsSql from './migrations/0004_doctor_profile_and_reports.sql?raw';
// Phase 7 / Plan 07-01 — language columns on users (D-18) +
// doctor_profile (D-17). One migration file per CONTEXT.md agent discretion
// (covers both ALTER TABLEs in one place).
import languageSql from './migrations/0007_doctor_profile_language_and_users_language.sql?raw';
import profileHeaderFooterDevicesPremedicationSql from './migrations/0009_profile_header_footer_devices_premedication.sql?raw';
// Quick task 20260812 — auto-generated MRN as serial number. Rebuilds the
// patients table with mrn NOT NULL + a one-row counter table for atomic
// increment (better-sqlite3 is sync + single-threaded inside db.transaction()).
import autoMrnSql from './migrations/0008_auto_mrn.sql?raw';

type Migration = {
  id: number;
  name: string;
  up: string;
};

// SQL is embedded by Vite's ?raw import — no filesystem read at runtime.
const MIGRATIONS: Migration[] = [
  { id: 1, name: 'init', up: initSql },
  { id: 2, name: 'procedures', up: proceduresSql },
  { id: 3, name: 'screenshots_and_trim', up: screenshotsAndTrimSql },
  { id: 4, name: 'doctor_profile_and_reports', up: doctorProfileAndReportsSql },
  // Phase 7 / Plan 07-01 — bilingual EN+AR language preference storage.
  { id: 7, name: 'doctor_profile_language_and_users_language', up: languageSql },
  // Quick task 20260812 — auto-MRN. Migration 8 keeps the id namespace
  // continuous (5 was deliberately skipped by Phase 6 reserved numbers).
  { id: 8, name: 'auto_mrn', up: autoMrnSql },
  // Quick task 260812-ns0 — header/footer/premedication/used-devices for Profile.
  { id: 9, name: 'profile_header_footer_devices_premedication', up: profileHeaderFooterDevicesPremedicationSql },
];

function loadMigrations(): typeof MIGRATIONS {
  return MIGRATIONS;
}

export function runMigrations(db: Database.Database): { applied: number[]; skipped: number[] } {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );

  const migrations = loadMigrations();
  const appliedRows = db.prepare('SELECT id FROM _migrations').all() as { id: number }[];
  const applied = new Set(appliedRows.map((r) => r.id));
  const insertApplied = db.prepare(
    'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  const appliedNow: number[] = [];
  const skipped: number[] = [];

  for (const m of migrations) {
    if (applied.has(m.id)) {
      skipped.push(m.id);
      continue;
    }
    const txn = db.transaction(() => {
      db.exec(m.up);
      insertApplied.run(m.id, m.name, Date.now());
    });
    txn();
    appliedNow.push(m.id);
  }

  return { applied: appliedNow, skipped };
}