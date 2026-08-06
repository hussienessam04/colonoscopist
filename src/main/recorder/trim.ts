// applyTrim — one-shot ffmpeg subprocess that produces a sibling trimmed
// mp4 from the canonical recording. Per D-07 + D-08 + RESEARCH §Pattern 1.
//
// Mirrors Phase 4 concat.ts: pure argv via buildTrimArgs(), then a child
// spawn via defaultFfmpegPath() with windowsVerbatimArguments for the
// Windows path-quoting quirk (PITFALLS §10). The original mp4 is NEVER
// overwritten — the trimmed file lives at `<basename>-trimmed.mp4` and
// the IPC handler updates procedures.video_path + video_path_original
// (only the FIRST trim populates video_path_original; the COALESCE guard
// in proceduresRepo.updateVideoPath is the canonical lock).
//
// The fsyncSync after exit code 0 is the canonical PITFALLS §1 recovery —
// ensures the trimmed file's bytes are on disk before the IPC handler
// updates the row (a power loss between spawn-exit and fsync could leave
// the DB pointing at a torn file).

import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, openSync } from 'node:fs';
import path from 'node:path';
import { IpcErrorException, ipcError } from '@shared/errors';
import { proceduresRepo } from '../db/procedures-repo';
import { videoFilePath } from '../paths';
import { buildTrimArgs } from './ffmpeg-args';
import { defaultFfmpegPath } from './ffmpeg-path';

export type ApplyTrimInput = {
  procedureId: string;
  inMs: number;
  outMs: number;
};

export type ApplyTrimResult = {
  trimmedVideoPath: string;
};

// ponytail: 5 minutes is enough for any realistic trim (a 30-minute recording
// streams in a few seconds; an aborted run gets SIGKILL'd before the OS
// watchdog). Keeps the IPC round-trip bounded.
const TRIM_TIMEOUT_MS = 5 * 60 * 1000;

export async function applyTrim(input: ApplyTrimInput): Promise<ApplyTrimResult> {
  // Defensive — zod already rejects outMs <= inMs in proceduresTrimInput, but
  // a stray caller could skip zod. PITFALLS §6 — keep the check close to
  // the args builder so the negative-range failure mode is consistent.
  if (input.outMs <= input.inMs) {
    throw new IpcErrorException(
      ipcError('IPC_VALIDATION', 'outMs must be greater than inMs'),
    );
  }

  const procedure = proceduresRepo.get(input.procedureId);
  if (!procedure) {
    throw new IpcErrorException(
      ipcError('IPC_NOT_FOUND', `Procedure ${input.procedureId} not found`),
    );
  }

  // D-13 — trim is disabled on partial recordings. Defensive too: a
  // recording still in flight or crashed mid-stream has no meaningful cut
  // range. Only `completed` is allowed.
  if (procedure.status !== 'completed') {
    throw new IpcErrorException(
      ipcError(
        'IPC_VALIDATION',
        `Cannot trim a ${procedure.status} recording`,
      ),
    );
  }

  // Resolve paths. The trimmed file is a SIBLING of the canonical mp4 —
  // never overwrite the input. The `-trimmed` suffix sorts alphabetically
  // (e.g. "video.mp4" → "video-trimmed.mp4") so a re-trim of an already
  // trimmed file produces "video-trimmed-trimmed.mp4" (still a sibling,
  // still no overwrite).
  const inputAbs = videoFilePath(procedure.patientId, input.procedureId, procedure.videoPath);
  if (!existsSync(inputAbs)) {
    throw new IpcErrorException(
      ipcError(
        'IPC_NOT_FOUND',
        `Source video missing at ${procedure.videoPath}`,
      ),
    );
  }
  const { dir, name } = path.parse(inputAbs);
  const outputAbs = path.join(dir, `${name}-trimmed.mp4`);

  const args = buildTrimArgs({
    inputPath: inputAbs,
    inMs: input.inMs,
    outMs: input.outMs,
    outputPath: outputAbs,
  });

  await runFfmpegTrim(args);

  // PITFALLS §1 — fsync the trimmed file so a power loss between the trim
  // exit and the DB UPDATE doesn't leave the row pointing at a torn file.
  // The Windows fsync quirk (EPERM on 'r' handles) is benign here — the
  // ffmpeg child already exited 0 so the bytes are on disk; the fsync
  // is best-effort durability.
  try {
    const fd = openSync(outputAbs, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Best-effort: ffmpeg already wrote + exited cleanly. Swallow ENOENT
    // (shouldn't happen — we just spawned and waited) + EPERM (Windows
    // fsync quirk on read-only handles).
  }

  const trimmedRel = path.relative(path.dirname(inputAbs), outputAbs);
  return { trimmedVideoPath: trimmedRel };
}

function runFfmpegTrim(args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(defaultFfmpegPath(), args as string[], {
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // already exited
      }
      // Grace window: SIGTERM at 5min, escalate to SIGKILL 500ms later if
      // ffmpeg refuses to exit. Mirrors the recorder's SIGTERM_GRACE_MS
      // / SIGKILL_FALLBACK_MS pattern.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 500);
    }, TRIM_TIMEOUT_MS);

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      // Cap the buffer so a runaway ffmpeg doesn't OOM the supervisor.
      stderrBuf = (stderrBuf + chunk.toString('utf8')).slice(-8_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new IpcErrorException(
        ipcError('IPC_VALIDATION', `Failed to spawn ffmpeg: ${err.message}`),
      ));
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new IpcErrorException(
          ipcError('IPC_VALIDATION', `ffmpeg trim timed out after ${TRIM_TIMEOUT_MS}ms`),
        ));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      // ponytail: surface the last stderr line so the renderer toast shows
      // a useful message instead of "ffmpeg exited 1". Truncated to the
      // tail to keep the IPC envelope small.
      const tail = stderrBuf.trim().split('\n').filter(Boolean).slice(-3).join(' | ');
      reject(new IpcErrorException(
        ipcError('IPC_VALIDATION', `ffmpeg trim failed (code=${code}, signal=${signal ?? 'none'})${tail ? `: ${tail}` : ''}`),
      ));
    });
  });
}
