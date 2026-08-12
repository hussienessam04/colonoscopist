-- 0009_profile_header_footer_devices_premedication.sql
-- Quick task 260812-ns0 — add four new profile features:
--   1. header_image_path + footer_image_path: clinic branding on the
--      report (top band + bottom band).
--   2. used_devices: 1:N table for the devices the clinic routinely uses
--      (endoscope model, processor, light source, etc.).
--   3. premedication: free-text default for the procedure report header.
--
-- All new columns are nullable; backfill is a no-op for existing rows
-- (each existing doctor_profile row gets three new NULL columns + zero
-- used_devices rows). The migration runner marks id=9 in _migrations.

ALTER TABLE doctor_profile ADD COLUMN header_image_path TEXT;
ALTER TABLE doctor_profile ADD COLUMN footer_image_path TEXT;
ALTER TABLE doctor_profile ADD COLUMN premedication      TEXT;

-- 1:N used_devices per doctor_profile. ON DELETE CASCADE so deleting
-- the parent doctor_profile row (rare; admin-only) takes devices with it.
CREATE TABLE used_devices (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES doctor_profile(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_used_devices_profile ON used_devices(profile_id, sort_order ASC, created_at ASC);