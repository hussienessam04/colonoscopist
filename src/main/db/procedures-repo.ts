// procedures + procedure_notes + procedure_segments repositories.
// Per CAPT-04/05/06/07 + D-01 + D-03 + D-06 + D-11.
// video_path is stored RELATIVE to userData (Anti-Pattern 2). Resolution
// happens at read time via path.join(app.getPath('userData'), storedRelPath).

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';
import type {
  Procedure,
  ProcedureNote,
  ProcedureSegment,
  PresetSummary,
} from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';

type ProcedureRow = {
  id: string;
  patient_id: string;
  doctor_id: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number;
  status: 'recording' | 'completed' | 'partial' | 'crashed';
  video_path: string;
  preset_summary: string;
  audio_device_name: string | null;
  created_at: number;
};

type ProcedureNoteRow = {
  id: number;
  procedure_id: string;
  body: string;
  created_at: number;
};

type ProcedureSegmentRow = {
  id: number;
  procedure_id: string;
  segment_index: number;
  file_path: string;
  started_at: number;
  ended_at: number;
};

export type ProcedureInsertInput = {
  patientId: string;
  doctorId: string;
  videoPath: string;
  presetSummary: PresetSummary;
  audioDeviceName?: string | null;
};

export type ProcedureUpdateFinalizedInput = {
  endedAt: number;
  durationSeconds: number;
  status: 'completed' | 'partial' | 'crashed';
  videoPath: string;
};

export type ProceduresListFilter = {
  patientId?: string;
  status?: 'recording' | 'completed' | 'partial' | 'crashed';
  page?: number;
  pageSize?: number;
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  get: Stmt;
  getIncludingDeleted: Stmt;
  updateStartedAt: Stmt;
  updateFinalized: Stmt;
  listAll: Stmt;
  listByPatient: Stmt;
  listByStatus: Stmt;
  listByPatientStatus: Stmt;
  countAll: Stmt;
  countByPatient: Stmt;
  countByStatus: Stmt;
  countByPatientStatus: Stmt;
  insertNote: Stmt;
  listNotes: Stmt;
  insertSegment: Stmt;
  listSegments: Stmt;
} | null = null;

function stmts() {
  if (cached) return cached;
  const db = getDb();
  cached = {
    insert: db.prepare(
      `INSERT INTO procedures (id, patient_id, doctor_id, started_at, ended_at, duration_seconds, status, video_path, preset_summary, audio_device_name, created_at)
       VALUES (@id, @patient_id, @doctor_id, @started_at, NULL, 0, 'recording', @video_path, @preset_summary, @audio_device_name, @created_at)`,
    ),
    get: db.prepare('SELECT * FROM procedures WHERE id = ?'),
    getIncludingDeleted: db.prepare('SELECT * FROM procedures WHERE id = ?'),
    updateStartedAt: db.prepare('UPDATE procedures SET started_at = ? WHERE id = ?'),
    updateFinalized: db.prepare(
      `UPDATE procedures SET ended_at = @ended_at, duration_seconds = @duration_seconds, status = @status, video_path = @video_path WHERE id = @id`,
    ),
    listAll: db.prepare(
      `SELECT * FROM procedures ORDER BY started_at DESC LIMIT @limit OFFSET @offset`,
    ),
    listByPatient: db.prepare(
      `SELECT * FROM procedures WHERE patient_id = @patient_id ORDER BY started_at DESC LIMIT @limit OFFSET @offset`,
    ),
    listByStatus: db.prepare(
      `SELECT * FROM procedures WHERE status = @status ORDER BY started_at DESC LIMIT @limit OFFSET @offset`,
    ),
    listByPatientStatus: db.prepare(
      `SELECT * FROM procedures WHERE patient_id = @patient_id AND status = @status ORDER BY started_at DESC LIMIT @limit OFFSET @offset`,
    ),
    countAll: db.prepare(`SELECT COUNT(*) AS c FROM procedures`),
    countByPatient: db.prepare(`SELECT COUNT(*) AS c FROM procedures WHERE patient_id = @patient_id`),
    countByStatus: db.prepare(`SELECT COUNT(*) AS c FROM procedures WHERE status = @status`),
    countByPatientStatus: db.prepare(
      `SELECT COUNT(*) AS c FROM procedures WHERE patient_id = @patient_id AND status = @status`,
    ),
    insertNote: db.prepare(
      `INSERT INTO procedure_notes (procedure_id, body, created_at) VALUES (@procedure_id, @body, @created_at)`,
    ),
    listNotes: db.prepare(
      `SELECT * FROM procedure_notes WHERE procedure_id = ? ORDER BY created_at ASC`,
    ),
    insertSegment: db.prepare(
      `INSERT INTO procedure_segments (procedure_id, segment_index, file_path, started_at, ended_at)
       VALUES (@procedure_id, @segment_index, @file_path, @started_at, @ended_at)`,
    ),
    listSegments: db.prepare(
      `SELECT * FROM procedure_segments WHERE procedure_id = ? ORDER BY segment_index ASC`,
    ),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements must be dropped.
export function __resetProceduresRepoCache(): void {
  cached = null;
}

function rowToProcedure(row: ProcedureRow): Procedure {
  let summary: PresetSummary;
  try {
    summary = JSON.parse(row.preset_summary) as PresetSummary;
  } catch {
    summary = { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' };
  }
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    status: row.status,
    videoPath: row.video_path,
    presetSummary: summary,
    audioDeviceName: row.audio_device_name,
    createdAt: row.created_at,
  };
}

function rowToNote(row: ProcedureNoteRow): ProcedureNote {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

function rowToSegment(row: ProcedureSegmentRow): ProcedureSegment {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    segmentIndex: row.segment_index,
    filePath: row.file_path,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

const MAX_PAGE_SIZE = 200;

export const proceduresRepo = {
  insert(input: ProcedureInsertInput): Procedure {
    const id = randomUUID();
    const now = Date.now();
    try {
      stmts().insert.run({
        id,
        patient_id: input.patientId,
        doctor_id: input.doctorId,
        started_at: now,
        video_path: input.videoPath,
        preset_summary: JSON.stringify(input.presetSummary),
        audio_device_name: input.audioDeviceName ?? null,
        created_at: now,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ) {
        throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Patient or doctor not found'));
      }
      throw err;
    }
    const row = stmts().getIncludingDeleted.get(id) as ProcedureRow;
    return rowToProcedure(row);
  },

  get(id: string): Procedure | undefined {
    const row = stmts().get.get(id) as ProcedureRow | undefined;
    return row ? rowToProcedure(row) : undefined;
  },

  // Updates the timestamp set on ffmpeg spawn success (D-10).
  updateStartedAt(id: string, startedAt: number): void {
    stmts().updateStartedAt.run(startedAt, id);
  },

  updateFinalized(id: string, patch: ProcedureUpdateFinalizedInput): Procedure {
    stmts().updateFinalized.run({
      ended_at: patch.endedAt,
      duration_seconds: patch.durationSeconds,
      status: patch.status,
      video_path: patch.videoPath,
      id,
    });
    const row = stmts().getIncludingDeleted.get(id) as ProcedureRow;
    return rowToProcedure(row);
  },

  list(filter: ProceduresListFilter): { rows: Procedure[]; total: number } {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 25;
    const limit = Math.min(pageSize, MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;
    const hasPatient = !!filter.patientId;
    const hasStatus = !!filter.status;
    const params: Record<string, unknown> = {
      limit,
      offset,
      patient_id: filter.patientId ?? null,
      status: filter.status ?? null,
    };

    let listStmt: Stmt;
    let countStmt: Stmt;
    if (hasPatient && hasStatus) {
      listStmt = stmts().listByPatientStatus;
      countStmt = stmts().countByPatientStatus;
    } else if (hasPatient) {
      listStmt = stmts().listByPatient;
      countStmt = stmts().countByPatient;
    } else if (hasStatus) {
      listStmt = stmts().listByStatus;
      countStmt = stmts().countByStatus;
    } else {
      listStmt = stmts().listAll;
      countStmt = stmts().countAll;
    }

    const rows = listStmt.all(params) as ProcedureRow[];
    const total = (countStmt.get(params) as { c: number }).c;
    return { rows: rows.map(rowToProcedure), total };
  },

  // Notes (Plan 02-of-phase-04 fills the IPC; the repo is final here).
  insertNote(procedureId: string, body: string): ProcedureNote {
    const now = Date.now();
    const info = stmts().insertNote.run({
      procedure_id: procedureId,
      body,
      created_at: now,
    });
    return { id: Number(info.lastInsertRowid), procedureId, body, createdAt: now };
  },

  listNotes(procedureId: string): ProcedureNote[] {
    return (stmts().listNotes.all(procedureId) as ProcedureNoteRow[]).map(rowToNote);
  },

  // Segments (Plan 03-of-phase-04 fills the IPC; the repo is final here).
  insertSegment(input: {
    procedureId: string;
    segmentIndex: number;
    filePath: string;
    startedAt: number;
    endedAt: number;
  }): ProcedureSegment {
    const info = stmts().insertSegment.run({
      procedure_id: input.procedureId,
      segment_index: input.segmentIndex,
      file_path: input.filePath,
      started_at: input.startedAt,
      ended_at: input.endedAt,
    });
    return {
      id: Number(info.lastInsertRowid),
      procedureId: input.procedureId,
      segmentIndex: input.segmentIndex,
      filePath: input.filePath,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    };
  },

  listSegments(procedureId: string): ProcedureSegment[] {
    return (stmts().listSegments.all(procedureId) as ProcedureSegmentRow[]).map(rowToSegment);
  },
};