-- 0010_report_procedure_type_and_templates.sql
-- Quick task 20260812 — complete report redesign.
--
-- Three changes on `reports`:
--   1. DROP 4 old columns (findings / diagnosis / recommendations /
--      procedure_details) — the new 8 procedure-type-specific boxes
--      plus conclusion + recommendation replace all four. Old on-disk
--      PDFs are preserved; the row's text columns reset to ''. The
--      user explicitly asked for a "complete change".
--   2. ADD 8 box columns: esophagus / stomach / pylorus / duodenum /
--      colon / ileum / conclusion / recommendation. Each TEXT NOT NULL
--      DEFAULT ''. Per the new design the doctor picks a procedure
--      type at first edit (colon → colon + ileum + conclusion +
--      recommendation; upper_gi → esophagus + stomach + pylorus +
--      duodenum + conclusion + recommendation).
--   3. ADD procedure_type column (TEXT NOT NULL DEFAULT 'colon' with
--      a CHECK). The column is set ONCE on first edit; subsequent
--      updates are rejected by the repo (setProcedureType guards on
--      the empty-state invariant).
--   4. ADD instrument column (TEXT NULL) — pointer at used_devices.id,
--      picked from the dropdown at report-edit time.
--   5. ADD premedication_override column (TEXT NULL) — per-report
--      override of the profile's premedication default. NULL = fall
--      back to profile.
--
-- Plus the new `report_text_templates` table for the global saved-text
-- library. scope ∈ {esophagus, stomach, pylorus, duodenum, colon, ileum,
-- conclusion, recommendation}. UNIQUE(scope, label) so the doctor's
-- per-scope library can't grow duplicates.

ALTER TABLE reports DROP COLUMN findings;
ALTER TABLE reports DROP COLUMN diagnosis;
ALTER TABLE reports DROP COLUMN recommendations;
ALTER TABLE reports DROP COLUMN procedure_details;

ALTER TABLE reports ADD COLUMN procedure_type TEXT NOT NULL DEFAULT 'colon'
  CHECK(procedure_type IN ('colon', 'upper_gi'));
ALTER TABLE reports ADD COLUMN instrument TEXT;
ALTER TABLE reports ADD COLUMN premedication_override TEXT;

ALTER TABLE reports ADD COLUMN esophagus      TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN stomach        TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN pylorus        TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN duodenum       TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN colon          TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN ileum          TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN conclusion     TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN recommendation TEXT NOT NULL DEFAULT '';

CREATE TABLE report_text_templates (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL
                CHECK(scope IN ('esophagus','stomach','pylorus','duodenum',
                                'colon','ileum','conclusion','recommendation')),
  label       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(scope, label)
);
CREATE INDEX idx_report_text_templates_scope
  ON report_text_templates(scope, label);