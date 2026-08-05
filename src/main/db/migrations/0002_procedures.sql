-- 0002_procedures.sql — Phase 4 recording tables.
-- Per D-01 + D-03 + D-06 + D-11 + RESEARCH.md §4.
-- Three tables in one migration: procedures, procedure_notes, procedure_segments.
-- No triggers (audit_log triggers already shipped in 0001_init.sql).

CREATE TABLE procedures (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK(status IN ('recording','completed','partial','crashed')),
  video_path      TEXT NOT NULL,
  preset_summary  TEXT NOT NULL,
  audio_device_name TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_procedures_patient ON procedures(patient_id, started_at DESC);
CREATE INDEX idx_procedures_recording ON procedures(status) WHERE status = 'recording';
CREATE INDEX idx_procedures_doctor ON procedures(doctor_id, started_at DESC);

CREATE TABLE procedure_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id  TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK(length(body) > 0 AND length(body) <= 1000),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_procedure_notes_proc ON procedure_notes(procedure_id, created_at ASC);

CREATE TABLE procedure_segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id  TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  file_path     TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  UNIQUE(procedure_id, segment_index)
);
CREATE INDEX idx_procedure_segments_proc ON procedure_segments(procedure_id, segment_index ASC);