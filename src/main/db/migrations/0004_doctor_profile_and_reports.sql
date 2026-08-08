-- 0004_doctor_profile_and_reports.sql — Phase 6.
-- Per CONTEXT.md D-01, D-02, D-03, D-04, D-05, D-07.
--
-- Three tables in one migration:
--   doctor_profile       — 1:1 with users; bilingual EN+AR profile fields (D-02)
--   reports              — 1:1 with procedures; draft→finalized state machine (D-05, D-06, D-07)
--   report_screenshots   — join table for screenshots attached to the report (D-07)
--
-- Per D-03 — idempotent backfill: copy users.full_name + settings.clinic_name
-- into one doctor_profile row per non-deleted user. Safe to run on every
-- launch until each user has exactly one doctor_profile row; the WHERE
-- NOT EXISTS subquery guard makes it a no-op for any subsequent run.

CREATE TABLE doctor_profile (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name_en    TEXT NOT NULL,
  full_name_ar    TEXT,
  clinic_name_en  TEXT NOT NULL,
  clinic_name_ar  TEXT,
  address         TEXT,
  phone           TEXT,
  signature_path  TEXT,    -- userData-relative per Anti-Pattern 2
  logo_path       TEXT,    -- userData-relative per Anti-Pattern 2
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_doctor_profile_user ON doctor_profile(user_id);

-- 1:1 with procedures (D-05: UNIQUE on procedure_id).
-- status column is gated by a CHECK so the draft/finalized state machine
-- can never silently hold a third value (e.g. 'drafting').
-- doctor_id ON DELETE RESTRICT mirrors procedures.doctor_id — the doctor's
-- own account cannot be deleted while reports exist that point at them.
CREATE TABLE reports (
  id                  TEXT PRIMARY KEY,
  procedure_id        TEXT NOT NULL UNIQUE REFERENCES procedures(id) ON DELETE CASCADE,
  doctor_id           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  findings            TEXT NOT NULL DEFAULT '',
  diagnosis           TEXT NOT NULL DEFAULT '',
  recommendations     TEXT NOT NULL DEFAULT '',
  procedure_details   TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL CHECK(status IN ('draft','finalized')) DEFAULT 'draft',
  finalized_at        INTEGER,
  pdf_path            TEXT,    -- userData-relative per Anti-Pattern 2
  pdf_generated_at    INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_reports_procedure ON reports(procedure_id);
CREATE INDEX idx_reports_doctor ON reports(doctor_id, created_at DESC);
CREATE INDEX idx_reports_finalized ON reports(finalized_at) WHERE finalized_at IS NOT NULL;

-- Join table. Composite PK guarantees one row per (report, screenshot).
-- idx_report_screenshots_order drives the PDF render query (ORDER BY sort_order ASC).
CREATE TABLE report_screenshots (
  report_id     TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL,
  PRIMARY KEY (report_id, screenshot_id)
);
CREATE INDEX idx_report_screenshots_order ON report_screenshots(report_id, sort_order ASC);

-- D-03 — idempotent backfill. The NOT EXISTS guard makes this a no-op on
-- subsequent launches (each user already has exactly one doctor_profile row).
-- Clinic name defaults to '' when settings.clinic_name is unset; the
-- wizard always writes that row, but the backfill is defensive against
-- legacy databases that pre-date the settings table.
INSERT OR IGNORE INTO doctor_profile
  (id, user_id, full_name_en, full_name_ar, clinic_name_en, clinic_name_ar, address, phone, signature_path, logo_path, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  u.full_name,
  NULL,
  COALESCE((SELECT value FROM settings WHERE key = 'clinic_name'), ''),
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  u.created_at,
  u.created_at
FROM users u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM doctor_profile WHERE doctor_profile.user_id = u.id);
