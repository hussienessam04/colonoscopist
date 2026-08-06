-- 0003_screenshots_and_trim.sql — Phase 5.
-- Per D-04 + D-05 + D-07 + RESEARCH.md §1.
--
-- screenshots table — captures of the preview / playback frame, persisted
-- under <userData>/data/media/patients/<patientId>/<procedureId>/screenshots/.
-- The `file_path` column stores the userData-relative form per Anti-Pattern 2;
-- absolute resolution happens at read time via path.join(app.getPath('userData'),
-- storedRelPath).
--
-- procedures.video_path_original — populated by Plan 03's applyTrim() on the
-- FIRST trim and NEVER overwritten; subsequent trims re-trim the current
-- video_path. Schema locks the contract now so the trim IPC handler in
-- Plan 03 can rely on the column existing without a follow-up migration.

CREATE TABLE screenshots (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id         TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  timestamp_in_video   INTEGER NOT NULL CHECK(timestamp_in_video >= 0),
  file_path            TEXT NOT NULL,
  annotation           TEXT,
  created_at           INTEGER NOT NULL
);
CREATE INDEX idx_screenshots_proc_ts ON screenshots(procedure_id, timestamp_in_video ASC);

ALTER TABLE procedures ADD COLUMN video_path_original TEXT;
