// recording:* IPC surface — start / stop (no pause/resume yet).
// Per CAPT-04/05/06/07 + D-01 + BLOCKER 4.
//
// doctorId is derived from `requireSession()` (BLOCKER 4). deviceId is
// canonicalized via canonicalizeOrThrow BEFORE the procedure row insert so
// the stored video_path parent directory always uses the canonical name.

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, type PresetSummary, type QualityPreset } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';
import { getDb } from '../db';
import { proceduresRepo } from '../db/procedures-repo';
import { presetRepo } from '../capture/preset-repo';
import { canonicalizeOrThrow } from '../capture/canonicalize';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { Recorder, type RecorderDeps } from '../recorder/recorder';
import { recordingStartInput } from '@shared/validators';

function fromZodError(err: z.ZodError, fallbackField?: string): IpcErrorException {
  const issue = err.issues[0];
  const field = (issue?.path[0] as string | undefined) ?? fallbackField;
  return new IpcErrorException(
    ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
  );
}

function safeParse<T>(schema: z.ZodType<T>, raw: unknown, fallbackField?: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) throw fromZodError(err, fallbackField);
    throw err;
  }
}

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Not authenticated'));
  }
  return id;
}

function asIpcError(err: unknown): Error {
  if (err instanceof z.ZodError) return asIpcError(fromZodError(err));
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function presetSummaryFor(preset: QualityPreset): PresetSummary {
  if (preset.preset === 'sd') {
    return { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' };
  }
  if (preset.preset === 'hd') {
    return { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' };
  }
  return { kind: 'custom', resolution: preset.resolution, framerate: preset.framerate, bitrate: '5M' };
}

function summaryFromStored(preset: QualityPreset): PresetSummary {
  return presetSummaryFor(preset);
}

export type RegisterRecordingIpcDeps = {
  buildRecorder: (overrides?: Partial<RecorderDeps>) => Recorder;
};

export type StartInput = {
  patientId: string;
  deviceId: string;
  preset: QualityPreset;
};

export type StartResult = { procedureId: string; startedAt: number };

export function registerRecordingIpc(deps: RegisterRecordingIpcDeps): void {
  ipcMain.handle(IPC.RECORDING_START, async (_e, raw) => {
    try {
      const parsed = safeParse(recordingStartInput, raw, 'patientId');
      const doctorId = requireSession();
      // Canonicalize deviceId BEFORE the procedures insert (T-04-01).
      const canonical = canonicalizeOrThrow(parsed.deviceId);
      const presetSummary = summaryFromStored(parsed.preset);
      const db = getDb();
      let procedureId = '';
      let startedAt = 0;
      db.transaction(() => {
        // Per Plan 02 — the renderer may have already created the procedure
        // row via `procedures.create` so the notes panel has a stable id
        // before Record is pressed (D-08). If so, reuse the existing row;
        // otherwise create one on demand (legacy path).
        if (parsed.procedureId) {
          const existing = proceduresRepo.get(parsed.procedureId);
          if (!existing) {
            throw new IpcErrorException(
              ipcError('IPC_NOT_FOUND', `Procedure ${parsed.procedureId} not found`),
            );
          }
          if (existing.patientId !== parsed.patientId) {
            throw new IpcErrorException(
              ipcError('IPC_VALIDATION', 'Procedure does not belong to this patient'),
            );
          }
          procedureId = existing.id;
        } else {
          const inserted = proceduresRepo.insert({
            patientId: parsed.patientId,
            doctorId,
            videoPath: '',
            presetSummary,
            audioDeviceName: null,
          });
          procedureId = inserted.id;
          // ponytail: stamp started_at = 0 so the supervisor can rewrite on
          // ffmpeg spawn success. updateStartedAt() in the supervisor will
          // overwrite this value once the first 'frame=' line lands.
        }
      })();
      const recorder = deps.buildRecorder();
      const { startedAt: startedNow } = await recorder.start({
        procedureId,
        deviceId: canonical,
        patientId: parsed.patientId,
        doctorId,
        preset: parsed.preset,
        presetSummary,
      });
      startedAt = startedNow;
      audit({
        action: 'recording.start',
        entityType: 'procedure',
        entityId: procedureId,
        userId: doctorId,
        metadata: {
          deviceName: canonical,
          preset: presetSummary,
        },
      });
      return { procedureId, startedAt };
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.RECORDING_STOP, async () => {
    try {
      const doctorId = requireSession();
      const recorder = deps.buildRecorder();
      await recorder.stop();
      audit({
        action: 'recording.stop',
        entityType: 'procedure',
        entityId: null,
        userId: doctorId,
      });
    } catch (err) {
      throw asIpcError(err);
    }
  });
}

export const __test = {
  safeParse,
  fromZodError,
  asIpcError,
  requireSession,
  presetSummaryFor,
};

// Used by init.ts so the IPC layer doesn't import preset-repo directly.
export { presetRepo };