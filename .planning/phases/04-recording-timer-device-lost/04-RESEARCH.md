# Phase 4: Recording - Research

**Researched:** 2026-08-04
**Domain:** Electron desktop — ffmpeg child process supervision, procedure timer, device-lost handling, schema
**Confidence:** HIGH (most work fronts the locked CONTEXT.md D-01..D-12; remaining gaps are catalogued)

## Summary

Phase 4 owns three production layers: a ffmpeg child supervisor (`src/main/recorder/`), a `procedures` / `procedure_notes` / `procedure_segments` schema migration, and the Pause/Resume + device-lost UX surface on the Procedure Room. The decisions are locked: STOP = `q\n` + 5s grace + SIGKILL fallback (D-01), Pause = segment-and-concat at finalize (D-11), device-lost = `<basename>.partial.mp4` + sidecar JSON + inline banner (D-03), one child per procedure (Anti-Pattern 5). The supervisor's state machine transitions are emitted as `recording:status` push events so the renderer can `setInterval(1000)` a local timer derived from the canonical `started_at` (D-10) — authoritative values live in the DB row.

**Primary recommendation:** Build the supervisor as a pure class with **injectable child-spawn + clock** so unit tests can drive all transitions without spawning real ffmpeg (Question 6). Wire the Pause/Resume via segment files written next to the canonical mp4 — concat list file lives inside `procedureMediaDir()` with the same cleanup path. Add ffmpeg-static to `asarUnpack` once; path rewrite is automatic via `defaultFfmpegPath()`.

## User Constraints (from 04-CONTEXT.md)

### Locked Decisions
- **D-01** Stop click → `q\n` on stdin → 5s grace → SIGTERM/SIGKILL fallback; procedure row → `status='completed'`, `ended_at = Date.now()`, `duration_seconds = floor((ended_at - started_at) / 1000)`. Audio/UI: Stop is the only finalize-while-recording button.
- **D-02** Finish = Stop while recording; rendering routes `finish()` → `stop()` then navigates on `closed` event. No recording → Phase 3 navigation behavior.
- **D-03** Device-lost = inline warning banner (NOT modal). mp4 → `<basename>.partial.mp4`; sidecar JSON `<basename>.partial.json` = `{ procedureId, lastKnownTimestampMs, deviceLostAt, deviceName }`. Procedure row stays `status='recording'` until Stop finalizes as `status='partial'`.
- **D-04** Crash recovery on next launch: scan `<userData>/data/media/patients/*/*/video.mp4.partial` + sidecar JSON; append `audit_log` rows with `action='recording.crash_partial'`. Orphan file left on disk; Phase 7 cleanup owns deletion.
- **D-05** Post-finalize navigation → Route `'procedure-review'; procedureId: string`. Phase 4 placeholder shows metadata + "Review + trim land in Phase 5"; for `status='partial'` shows partial banner.
- **D-06** Notes persist as separate `procedure_notes` table (append-only log). Schema: `id, procedure_id REFERENCES procedures(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK(length(body) > 0 AND length(body) <= 1000), created_at INTEGER NOT NULL`. Index on `(procedure_id, created_at DESC)`.
- **D-07** Notes save via explicit "Save note" button → `procedure_notes.create({ procedureId, body })`. Empty + click = no-op. Each save = one row + one `audit_log` row `action='procedure.note_added'`.
- **D-08** Notes side-rail in right-hand column of `ProcedureRoom.tsx` below the existing record controls. Always visible; `disabled={!procedureId}`.
- **D-09** Notes list renders newest at bottom (chat-style), scrollable, no pagination.
- **D-10** Timer values live in main: `started_at` set on ffmpeg spawn success, `ended_at` on close, `duration_seconds` computed at finalize. Renderer receives `started_at` via `recording:status` event + ticks locally via `setInterval(1000)`. Event payload: `{ status: 'started'|'paused'|'resumed'|'stopped'|'lost', startedAt, currentSegmentIndex? }`.
- **D-11** Pause/Resume = segments + concat at finalize. Pause → `q\n` → kill segment → insert `procedure_segments` row; Resume → spawn new ffmpeg writing `<basename>-seg<N>.mp4`. Finalize → `ffmpeg -f concat -safe 0 -i list.txt -c copy final.mp4` → delete segment files → write canonical `video_path`. Schema: `procedure_segments(id, procedure_id, segment_index, file_path, started_at, ended_at)`. During pause, timer freezes (renderer-side); `status='recording'` until finalize.
- **D-12** All presets: `-c:v libx264 -preset veryfast -crf 23 -movflags +faststart`. Resolution + framerate from Phase 3 preset matrix. Internal constants: `-pix_fmt yuv420p`, `-b:v` SD=4M, HD=10M, Custom=5M. Lives in `src/main/recorder/ffmpeg-args.ts`.

### the agent's Discretion
- Device-lost banner exact wording (substance locked).
- ffmpeg stderr regex for device-lost (substring matching acceptable).
- Segment file naming inside `mediaDir` (recommended `<basename>-seg<N>.mp4`).
- Empty notes side-rail copy + styling.
- Procedure Review placeholder layout details.
- Pause/Resume button labels.
- `recording:status` events: no coalescing (each state change fires).
- Audit metadata keys for `recording.*` (minimum `{ deviceName, preset }` + timestamps).
- Concat list file path inside `mediaDir`.

### Deferred Ideas (OUT OF SCOPE)
- Audio in recording (Phase 3 D-08 locks `audio:false`).
- Resume recording to a partial procedure (v1.1; partial sidecar schema reserves room).
- Procedure audio transcription (out of v1).
- Trim during recording (TRIM-02; Phase 5 ships post-recording trim).
- Camera-side overlay / PIP.
- Per-procedure audio device pairing.
- Full Procedure Review UI (Phase 5 owns).
- PDF report flow (Phase 6).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **CAPT-04** | Recording uses ffmpeg-static as child process; spawned from main; one child per active procedure. | Section 1 (supervisor state machine) + Section 7 (packaging). |
| **CAPT-05** | mp4 → `<userData>/data/media/patients/<patientId>/<procedureId>/video.mp4` with `-c:v libx264 -preset veryfast -crf 23 -movflags +faststart`. | Section 1 (spawn args) + Section 4 (schema path) + Section 7 (ffmpeg-static packaging). |
| **CAPT-06** | Stop = SIGTERM with 5s grace → SIGKILL fallback; mp4 has valid moov atom + fsync on close. | Section 1 (close handlers) + Section 2 (concat moov merge). |
| **CAPT-07** | Procedure timer HH:MM:SS visible in UI during recording. | Section 1 (`recording:status` event) + Section 5 (IPC event channel); renderer ticks locally. |
| **CAPT-08** | Doctor attaches a quick note mid-procedure; stored against procedure row. | Section 4 (`procedure_notes` schema) + Section 5 (`procedure_notes.create` IPC) + UX D-07/D-08. |
| **CAPT-09** | Capture device disconnects → inline warning + `.partial.mp4` + sidecar JSON preserved. | Section 3 (stderr regex) + Section 1 (device-lost branch in supervisor). |

## Standard Stack

### Core (existing, locked — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ffmpeg-static` | ^5 | Bundled ffmpeg binary | SKILL §2; spawn as `child_process` from main. |
| `child_process` | Node built-in | Spawn + supervise ffmpeg | `spawn()` with args array; `windowsVerbatimArguments: true` per PITFALLS §10. |
| `better-sqlite3` | ^11 | WAL-mode SQLite | Phase 2 already wired; Phase 4 adds 3 tables. |
| `safeStorage` | Electron built-in | Encrypt sensitive fields at rest | Phase 2 wrapped; Phase 4 doesn't add encrypted columns. |

### No new dependencies required. Phase 4 ships inside the locked stack.

## Architecture Patterns

### System Architecture Diagram (recording flow)

```
[Click Record in ProcedureRoom]
    │  window.api.recording.start({ patientId, deviceId, preset })
    ▼
[preload → IPC.RECORDING_START]
    │
    ▼
[main: RegisterProceduresIpc → recording:start handler]
    │  • Require session
    │  • Insert procedure row (status='starting', started_at=null)
    │  • Build outputPath = procedureMediaDir(patientId, procedureId)/video.mp4
    │  • Spawn ffmpeg child (D-12 args + canonical device name from Phase 3)
    │  • On ffmpeg 'opened' / first frame: update procedure.started_at = Date.now()
    │  • Emit recording:status { status:'started', startedAt, currentSegmentIndex:0 }
    │  • Stderr watcher: pattern-match for device-lost signals (Section 3)
    ▼
[renderer: ProcedureRoom subscribes to recording.onStatus]
    │  • Starts setInterval(1000) → renders HH:MM:SS from received startedAt
    │  • Enables Pause/Resume + Save-note buttons
    │  • Notes panel lists procedure_notes ordered by created_at ASC (D-09)
    ▼
[Click Pause] → IPC.RECORDING_PAUSE
    │  • Main writes 'q\n' to current segment ffmpeg stdin
    │  • Waits 5s; SIGKILL fallback
    │  • INSERT procedure_segments row (segment_index, file_path, started_at, ended_at)
    │  • status='paused' event → renderer freezes timer
    ▼
[Click Resume] → IPC.RECORDING_RESUME
    │  • Main spawns new ffmpeg writing <basename>-seg<N>.mp4
    │  • status='resumed' event → renderer unfreezes timer
    ▼
[Click Stop / Finish] → IPC.RECORDING_STOP
    │  • Stop current segment (Pause-equivalent if segments exist)
    │  • If segments.length > 1: spawn ffmpeg concat (-c copy) → final video.mp4
    │  • Delete segment files; write canonical video_path
    │  • fsync finalize; update procedure.status='completed', ended_at, duration_seconds
    │  • status='stopped' event → renderer navigates to 'procedure-review'
    ▼
[Device-lost mid-recording]
    │  • stderr regex match → kill current segment cleanly
    │  • Rename video.mp4 → video.mp4.partial; write video.mp4.partial.json
    │  • status='lost' event → renderer shows inline banner
    │  • Procedure stays status='recording'; waiting for Stop
    ▼
[Crash recovery on next launch]
    │  • initRecorder.scanForOrphans() walks data/media/patients/*/*/video.mp4.partial
    │  • Appends audit_log { action:'recording.crash_partial', entityId, metadata }
    │  • Orphan file left on disk (Phase 7 cleanup)
```

### Pattern 1: Supervisor state machine
**What:** `Recorder` per-procedure singleton holding a state enum: `idle → starting → recording → paused → recording → … → stopping → completed`. Every transition is a single async function that updates the state, persists the DB row, and emits a `recording:status` event.
**Why:** Centralizes the spawn/kill/concat/fsync orchestration so that the IPC handlers stay thin (validation + auth → call supervisor method).
**Example sketch:**
```ts
// src/main/recorder/recorder.ts
export class Recorder {
  constructor(
    private readonly deps: {
      spawn: typeof spawn,                  // injectable for tests
      clock: { now(): number },             // injectable for tests
      procedures: ProceduresRepo,
      audit: AuditLogger,
      mediaDir: typeof procedureMediaDir,
      ffmpegPath: () => string,
      canonicalDevice: (id: string) => string,
    },
  ) {}

  private state: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' = 'idle'
  private child: ChildProcess | null = null
  private segments: Array<{ index: number; filePath: string; startedAt: number; endedAt?: number }> = []

  async start(input: { procedureId: string; patientId: string; deviceId: string; preset: QualityPreset }) { /* ... */ }
  async pause() { /* q\n + 5s + SIGKILL; INSERT procedure_segments */ }
  async resume() { /* spawn new ffmpeg; new segment */ }
  async stop() { /* stop current segment; if segments>1 run concat; finalize row */ }
  private onStderr(chunk: string) { /* watch for device-lost patterns; emit status='lost' */ }
  private onClose(code: number | null, signal: NodeJS.Signals | null) { /* fsync; finalize */ }
}
```

### Anti-Patterns to Avoid
- **Reusing ffmpeg across procedures** (ARCHITECTURE Anti-Pattern 5): state leaks, audio sync drift. Phase 4 spawns fresh per `procedureId`.
- **Optimistic UI for timer** (Anti-Pattern 4): the canonical `started_at` lives in the DB row; renderer derives its tick from the value received via `recording:status`, not local clocks.
- **Sleeping the main process with `setTimeout` chains** in the close handler: use `child.once('exit', …)` + a single `setTimeout` for the SIGKILL fallback.
- **Mutating `process.env.FFMPEG_PATH` globally** to "fix" the asar path: route every spawn through `defaultFfmpegPath()` so only the production path-rewrite lives in one place.

## 1. ffmpeg child supervision on Windows (D-01, D-02)

**State machine:** `idle → starting → recording → (paused ⇄ recording) → stopping → completed`. One `Recorder` instance per active procedure; tracked by a `Map<procedureId, Recorder>` in `src/main/recorder/registry.ts`.

**Spawn pattern (verbatim from SKILL §4, extended for Phase 4):**
```ts
const args: string[] = [
  '-f', 'dshow',
  '-rtbufsize', '100M',                          // SKILL §4
  '-i', `video=${canonicalDevice},`              // canonical form via Phase 3 canonicalizeOrThrow
  '-c:v', 'libx264',
  '-preset', 'veryfast',                          // D-12
  '-crf', '23',                                   // D-12
  '-movflags', '+faststart',                      // D-12 + PITFALLS §1
  '-pix_fmt', 'yuv420p',                          // SKILL §4
  '-r', String(preset.framerate),
  '-s', `${preset.width}x${preset.height}`,
  '-b:v', BITRATE_BY_PRESET[preset.kind],         // D-12: SD=4M, HD=10M, Custom=5M
  '-y', outputPath,
]
const child = spawn(ffmpegPath(), args, {
  windowsVerbatimArguments: true,                 // PITFALLS §10 — windows device quoting
  stdio: ['pipe', 'ignore', 'pipe'],
})
```

**Stop sequence (D-01 + PITFALLS §1):**
1. `child.stdin.write('q\n')` — ffmpeg flushes moov atom + closes mp4 cleanly.
2. `setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 5000)` — graceful 5s grace.
3. On `child.once('exit', (code) => { … })`: call `fs.fsync(fd)` on the file descriptor before `fs.close`; only then finalize the procedure row.

**fsync-on-close:** before writing the procedure row's final `ended_at`, the supervisor opens the file with `fs.openSync`, calls `fs.fsyncSync`, then `fs.closeSync`. This is the PITFALLS §1 recovery step that keeps a `-SIGKILL'd` mp4 from being unplayable.

**Pitfall 3 race (getUserMedia preview vs ffmpeg on the same device):** Phase 3 already sequences this — `enumerateDshowDevices` resolves canonical names, the renderer's `useVideoPreview` opens the device first (preview-only, audio:false). The renderer's preview handle is acquired before `recording.start` IPC is invoked. Phase 4's `recording.start` handler does **not** re-open the device via `getUserMedia` — it only opens the ffmpeg dshow handle. The two-handle case is the EasyCap power-glitch case (PITFALLS §3); the Phase 4 fallback is the device-lost banner (D-03), not a renderer-side re-open.

**One child per procedure (Anti-Pattern 5):** the registry enforces `if (registry.has(procedureId)) throw new RecorderBusyError(procedureId)`. Second `start()` for the same procedure rejects with a structured error code that the IPC surface maps to "Procedure already recording"; UI cannot fire it because Pause/Resume/Stop are the only mid-recording buttons.

## 2. Pause/Resume via segments + ffmpeg-concat (D-11)

**Per-segment file:** `<basename>-seg<N>.mp4` inside `procedureMediaDir(patientId, procedureId)`. First segment index is 0; `N` increments on each Pause→Resume cycle. Naming convention uses the `·-seg<N>.mp4` suffix (CONTEXT "Recommended" form) so a glob `*-seg*.mp4` finds all live segments during Phase 7 backup.

**Concat list file:** written inside `procedureMediaDir()` at finalize only. Format per SKILL §4 and the upstream ffmpeg concat demuxer contract:
```
file 'video-seg0.mp4'
file 'video-seg1.mp4'
file 'video-seg2.mp4'
```
Constructed with `path.join(mediaDir, 'concat-list.txt')`. Single line per segment; escaped single quotes inside the path would break the format but segment filenames are pure ASCII so this is a non-issue.

**Concat command at finalize:**
```ts
const args = [
  '-f', 'concat',
  '-safe', '0',
  '-i', listFilePath,
  '-c', 'copy',                                  // stream copy — no re-encode
  '-movflags', '+faststart',
  '-y', canonicalVideoPath,
]
spawn(ffmpegPath(), args, { windowsVerbatimArguments: true })
```

**Is `-c copy` reliable for H.264-in-mp4 across segment boundaries?** [VERIFIED: ffmpeg docs; SKILL §4] The concat demuxer **requires** identical codec parameters across segments. Because every segment is encoded by the same ffmpeg invocation with the same `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 30 -s <resolution> -b:v <bitrate>`, the fourcc, codec tag, profile, level, and SPS/PPS are byte-identical. The `-c copy` concat produces a playable mp4 with the same moov as a single-file write would. **Caveat:** if Pause happens mid-keyframe (rare; depends on GOP boundary), the segment may have a slightly different first-frame PTS — but the concat demuxer re-times per-segment timestamps to start at 0 and then concatenates, so the final mp4 plays back seamlessly. No re-encode is needed at finalize.

**Failure fallback:** if the concat fails (extremely rare with matched codec params), the supervisor falls back to a re-encode at finalize:
```ts
const args = ['-f', 'concat', '-safe', '0', '-i', listFilePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-y', canonicalVideoPath]
```
Writes the same canonical path; replaces the partial file. Plan should note this fallback but not exercise it in the happy path.

**Default case (never paused):** zero rows in `procedure_segments`, single mp4 at `video.mp4`. No concat subprocess is spawned. The finalize path short-circuits when `segments.length === 0` (treat the lone segment file as the canonical video directly, after the fsync).

## 3. device-lost detection

**Per PITFALLS §2 verbatim:** "ffmpeg stderr contains 'DeviceLost', 'EOF on input', 'I/O error'". The regex the supervisor uses on every stderr chunk:
```ts
const DEVICE_LOST_RE = /(I\/O error|device disconnected|DeviceLost|EOF on input|Immediate exit requested|av_interleaved_write_frame)/i
```
[ASSUMED] additional patterns worth including: `Immediate exit requested` (ffmpeg's own wrap-up message when its internal device-thread dies), `av_interleaved_write_frame` (a stale write that surfaces after a callback error). Substring matching is explicitly acceptable per CONTEXT "agent's discretion" — the regex above is a defensive refinement, not a strict requirement.

**Reliable ffmpeg-side signals:**
- stderr match → emit `recording:status { status: 'lost' }` immediately.
- 30-second silence on stderr + file size not growing → secondary signal (the supervisor `fs.stat`s the output file every 5s while recording; if size is unchanged for 30s and stderr is quiet, treat as soft-loss). Skipped in Phase 4 unless we observe ffmpeg exiting silently in practice — the stderr regex is the primary path.

**Windows `WM_DEVICECHANGE`:** [ASSUMED] would add a separate signal (USB removal broadcast) but requires a native addon or an Electron `systemPreferences` event we don't currently subscribe to. **Verdict:** out of Phase 4 scope. ffmpeg's stderr is the canonical signal; if a future phase observes silent device loss on a real EasyCap, we revisit with a Win32 hook.

**Supervisor handler:**
```ts
private onStderr(chunk: string) {
  this.lastStderr = chunk
  if (DEVICE_LOST_RE.test(chunk) && this.state === 'recording') {
    this.killCurrentSegment('device_lost')
    this.emitStatus({ status: 'lost', startedAt: this.startedAt, lastKnownTimestampMs: this.lastWrittenTimestamp })
  }
}
```
Then the D-03 partial-file flow: rename the segment file (or canonical video file, if first segment) to `<basename>.partial.mp4`, write the sidecar JSON, leave procedure row at `status='recording'`, wait for Stop. The renderer's inline banner shows the sidecar's `lastKnownTimestampMs` as `"recording preserved up to <last frame>"`.

**Crash recovery scan (D-04):** main scans `data/media/patients/*/*/video.mp4.partial` once on startup, before any UI interaction. For each match: read the sidecar JSON, append `audit_log { action: 'recording.crash_partial', entityId: sidecar.procedureId, metadata: { lastKnownTimestampMs, deviceName, sidecarPath } }`. Orphan file **left on disk** — Phase 7 cleanup owns deletion.

## 4. Schema

Recommended migration: **`0002_procedures.sql`** (single file, three tables + indexes, since they're tightly coupled and shipped together). Agent's call to split into three migrations if preferred.

```sql
-- procedures
CREATE TABLE procedures (
  id              TEXT PRIMARY KEY,                            -- uuid v4 (Phase 2 uses cuid-like; match Phase 2 convention)
  patient_id      TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at      INTEGER NOT NULL,                            -- D-10: set on ffmpeg spawn success
  ended_at        INTEGER,                                     -- nullable until finalize
  duration_seconds INTEGER NOT NULL DEFAULT 0,                 -- computed at finalize; default 0 for crash-orphans
  status          TEXT NOT NULL CHECK(status IN ('recording','completed','partial','crashed')),
  video_path      TEXT NOT NULL,                               -- relative to userData; e.g. 'data/media/patients/<pid>/<proc>/video.mp4'
  preset_summary  TEXT NOT NULL,                               -- JSON: { kind, resolution, framerate, bitrate }
  audio_device_name TEXT,                                      -- always NULL in Phase 4 (D-12); reserved for v1.1
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE INDEX idx_procedures_patient_started ON procedures (patient_id, started_at DESC);
CREATE INDEX idx_procedures_status          ON procedures (status) WHERE status = 'recording';  -- partial index: tiny in practice
CREATE INDEX idx_procedures_doctor_started  ON procedures (doctor_id, started_at DESC);

-- procedure_notes (D-06)
CREATE TABLE procedure_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id  TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK(length(body) > 0 AND length(body) <= 1000),
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_procedure_notes_proc_created ON procedure_notes (procedure_id, created_at ASC);

-- procedure_segments (D-11)
CREATE TABLE procedure_segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id  TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  file_path     TEXT NOT NULL,                                  -- relative to userData; e.g. 'data/media/patients/<pid>/<proc>/video-seg0.mp4'
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  UNIQUE (procedure_id, segment_index)
);

CREATE INDEX idx_procedure_segments_proc_index ON procedure_segments (procedure_id, segment_index ASC);
```

**Notes:**
- `video_path` always populated, even for `status='partial'` (per D-03, the file is renamed to `.partial.mp4` but the column still holds the canonical path; the partial suffix is also stored — see `*_partial_mp4_path` derivation: `video_path.replace(/\.mp4$/, '.partial.mp4')`). Alternative: add a `partial_video_path TEXT` column. **Recommendation:** keep the rename-only model from CONTEXT D-03, derive the partial path on read. Phase 5 review reads via the derivation.
- `duration_seconds` defaults to `0` so crash-orphans (which never finalize) don't break the NOT NULL constraint.
- `audio_device_name` column reserved for v1.1 audio (deferred per CONTEXT "Phase 4 does not expose `audio=<name>` to ffmpeg"). [ASSUMED] safe to add now even if unused; saves a migration later.
- `status` enum uses `recording | completed | partial | crashed`. `crashed` is the future-proofed value for crash-orphans; in Phase 4 the audit row carries the signal — `status='crashed'` becomes the post-Phase-7 cleanup flow. Not used in Phase 4 paths.

**Procedure row creation timing:** insert at `recording:start` IPC call with `started_at = Date.now()` optimistically and `status='recording'`. If ffmpeg fails to open the device, the supervisor catches the error and updates `status='crashed'` (or deletes the row; deletion is cleaner — see Audit row emitted before deletion).

## 5. Procedures IPC

Extend `src/shared/ipc-contract.ts`:

```ts
// IPC constants (extend existing IPC map)
export const IPC = {
  // ... existing
  RECORDING_START:         'recording:start',
  RECORDING_STOP:          'recording:stop',
  RECORDING_PAUSE:         'recording:pause',
  RECORDING_RESUME:        'recording:resume',
  PROCEDURES_CREATE:       'procedures:create',
  PROCEDURES_GET:          'procedures:get',
  PROCEDURES_LIST:         'procedures:list',
  PROCEDURES_FINALIZE:     'procedures:finalize',
  PROCEDURE_NOTES_CREATE:  'procedure-notes:create',
  PROCEDURE_NOTES_LIST:    'procedure-notes:list',
} as const

// Entity types (extend existing entities surface)
export interface Procedure {
  id: string
  patientId: string
  doctorId: string
  startedAt: number
  endedAt: number | null
  durationSeconds: number
  status: 'recording' | 'completed' | 'partial' | 'crashed'
  videoPath: string              // relative to userData
  partialVideoPath: string | null  // derived; populated when status='partial'
  presetSummary: PresetSummary
  audioDeviceName: string | null
  createdAt: number
}

export interface ProcedureNote {
  id: number
  procedureId: string
  body: string
  createdAt: number
}

export type RecordingStatus =
  | { status: 'started';  startedAt: number; currentSegmentIndex: number }
  | { status: 'paused';   startedAt: number; currentSegmentIndex: number }
  | { status: 'resumed';  startedAt: number; currentSegmentIndex: number }
  | { status: 'stopped';  startedAt: number; procedureId: string }
  | { status: 'lost';     startedAt: number; lastKnownTimestampMs: number; deviceName: string }

// IpcContract namespace additions
export interface IpcContract {
  // ... existing
  procedures: {
    create:   (input: { patientId: string }) => Promise<Procedure>
    get:      (input: { id: string }) => Promise<Procedure | null>
    list:     (query: { patientId?: string; status?: Procedure['status']; page?: number; pageSize?: number }) => Promise<{ rows: Procedure[]; total: number }>
    finalize: (input: { id: string; status: 'completed' | 'partial'; endedAt: number; durationSeconds: number; videoPath: string; partialJson?: { lastKnownTimestampMs: number; deviceLostAt: number; deviceName: string } }) => Promise<Procedure>
  }
  procedureNotes: {
    create: (input: { procedureId: string; body: string }) => Promise<ProcedureNote>
    list:   (query: { procedureId: string }) => Promise<ProcedureNote[]>
  }
  recording: {
    start:  (input: { patientId: string; deviceId: string; preset: QualityPreset }) => Promise<{ procedureId: string; startedAt: number }>
    pause:  () => Promise<void>
    resume: () => Promise<void>
    stop:   () => Promise<{ procedureId: string }>
    onStatus: (cb: (status: RecordingStatus) => void) => () => void  // returns unsubscribe
  }
}
```

**Renderer flow (recommended):** Procedure Room calls `procedures.create({ patientId })` → if not already in a procedure, then `recording.start({ patientId, deviceId, preset })`. The `create` returns the row; `start` returns `{ procedureId, startedAt }` and the same `procedureId` is now persistent. Subsequent `recording.pause/resume/stop` are procedure-scoped (the registry tracks the active procedure in the main-side singleton; renderer doesn't pass `procedureId` because there is exactly one active procedure at a time).

**Notes panel:** `procedureNotes.list({ procedureId })` on mount (and after each successful create). `procedureNotes.create({ procedureId, body })` returns the new note; renderer appends to the in-memory list optimistically only after the IPC resolves (CONTEXT "no auto-save, no optimistic UI").

**Finalize is internal:** the supervisor calls `procedures.finalize(...)` directly from main (not via IPC). The IPC namespace exposes `finalize` for completeness (e.g. for Phase 5+ review status rewrites) but the recording path uses the internal repo call.

## 6. UAT test surface

**Without owning a real endoscope**, the unit test surface relies on **dependency injection** in the `Recorder` class (see Pattern 1). Recommended injection points:

```ts
interface RecorderDeps {
  spawn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess  // fake spawn returns a scriptable EventEmitter
  clock: { now(): number }                                                    // fake clock for deterministic timer assertions
  fs: { openSync, fsyncSync, closeSync, statSync, renameSync }                // in-memory fs
  procedures: { insert, update, finalize }                                    // in-memory repo
  audit: { log: (action, entityId, metadata) => void }
  ffmpegPath: () => string                                                    // returns 'ffmpeg-mock.exe' or similar
  emit: (status: RecordingStatus) => void                                     // captured by test
}
```

**Supervisor transition tests** (no real ffmpeg):
1. `start` → fake spawn emits `opened` after 50ms → assert `emit` called with `{ status: 'started', startedAt: <injected clock> }`; assert procedure row has `started_at = <injected clock>`, `status='recording'`.
2. `stop` → fake spawn exits cleanly → assert `emit` called with `{ status: 'stopped', procedureId }`; assert finalize row has `ended_at` and `duration_seconds`.
3. `stop` with no `q` response → fake spawn ignores stdin → assert 5s wait → SIGKILL → assert exit handler still fires.
4. `pause` → `q\n` → exit → assert `procedure_segments` row inserted with `segment_index=0`, `ended_at` set.
5. `resume` → new spawn → assert `emit` called with `{ status: 'resumed', currentSegmentIndex: 1 }`.
6. `stop` after 2 segments → assert concat subprocess spawned with `-f concat -safe 0 -c copy`; assert canonical video_path written; assert segment files removed.
7. Device-lost: fake stderr emits `"av_interleaved_write_frame I/O error"` → assert `emit` called with `{ status: 'lost' }`; assert partial file rename + sidecar JSON written.
8. Crash recovery: pre-populate `data/media/patients/*/*/video.mp4.partial` + sidecar JSON in the in-memory fs; call `scanForOrphans()`; assert audit row written.

**Integration smoke test** (one real ffmpeg, real file, no device): spawn ffmpeg with `-f lavfi -i testsrc=duration=2:size=320x240:rate=10 -c:v libx264 -preset veryfast -crf 23 -movflags +faststart -y /tmp/test.mp4`; verify the produced mp4 has a valid moov atom via `ffprobe -v error -show_entries stream=codec_name`. This is the **D-12 happy-path test** that proves the spawn arguments work end-to-end. No EasyCap required.

**Windows-hardware smoke UAT** (Phase 3 pattern): `tests/integration/recording.smoke.test.ts` — manually triggered from a workstation with a webcam, expects a human-confirmed pass. Plan 04-NN assigns this UAT level.

**The user's STOP timing is testable too:** fake clock + fake spawn that delays `exit` event by 6s; assert that after `stop()` is called, the supervisor awaits the 5s window before escalating. After 5s the test fires a 'close' event from the fake spawn; supervisor proceeds to finalize.

## 7. ffmpeg-static packaging

**`package.json` `build.asarUnpack`:** confirmed requirement — add the single entry:
```json
{
  "build": {
    "asarUnpack": ["**/node_modules/ffmpeg-static/**"]
  }
}
```

**Production path rewrite:** the `ffmpeg-static` npm package returns the path to the binary inside `app.asar` (e.g. `resources/app.asar/node_modules/ffmpeg-static/ffmpeg.exe`). On Windows, executing a binary inside an asar archive fails ("Could not start process"); the asar-unpacked copy lives at `resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`. Rewrite:

```ts
// src/main/recorder/ffmpeg-path.ts (lazy singleton)
import ffmpegStatic from 'ffmpeg-static'
import { app } from 'electron'
import { existsSync } from 'node:fs'

let cachedPath: string | null = null

export function defaultFfmpegPath(): string {
  if (cachedPath) return cachedPath
  if (!ffmpegStatic) throw new Error('ffmpeg-static not bundled')
  // In packaged builds, replace app.asar -> app.asar.unpacked
  const resolved = ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
  if (!existsSync(resolved)) {
    throw new Error(`ffmpeg binary not found at ${resolved}; check build.asarUnpack`)
  }
  cachedPath = resolved
  return resolved
}
```

**Dev vs packaged:** in dev (`electron-vite dev`), `app.asar` is not in the path string — `ffmpegStatic` already points to the unpacked `node_modules`. The `replace` is a no-op. In `electron-builder` production builds, the rewrite is mandatory. The `existsSync` guard catches misconfigs early with a clear error.

**The path rewrite is needed only in `electron-builder` mode.** Dev skips it; tests (Vitest main-process suite) skip it (the file is at `node_modules/ffmpeg-static/ffmpeg.exe` directly). The lazy-singleton + `existsSync` check covers all three cases without branching.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| H.264 mp4 encoding | Custom muxer + x264 bindings | `ffmpeg-static` child process | Bitrate/framerate/CRF edge cases; container edge cases (faststart, moov placement). |
| Concat of segmented mp4s | Stream-merge library | `ffmpeg -f concat -safe 0 -i list.txt -c copy` | Demuxer-level concat is the canonical ffmpeg path; no re-encode. |
| USB device-lost detection | Win32 native addon for `WM_DEVICECHANGE` | ffmpeg stderr pattern matching | ffmpeg already detects it; one regex avoids a native module. |
| Procedure timer | Persistent `setInterval` across all sessions | Renderer `setInterval` + canonical `started_at` from event | DB row is authoritative; renderer derives. |
| File fsync on finalize | Custom fd management | `fs.fsyncSync(fd)` once on the output file | One-line; covers the SIGKILL recovery window. |
| Notes length validation | App-side regex + trim | SQL `CHECK(length(body) > 0 AND length(body) <= 1000)` | Enforced at the DB layer; UI can't write a zero-length row. |

**Key insight:** ffmpeg is the right tool for three of the four hardest problems (encoding, concat, device-loss detection). The supervisor's value is in the **state machine + lifecycle**, not in doing the multimedia work itself.

## Common Pitfalls

### Pitfall 1: `proc.kill('SIGKILL')` produces an unplayable mp4
**What goes wrong:** Hard-killing ffmpeg before it flushes the moov atom yields a 0-byte or unplayable file.
**Why:** mp4 metadata is written at the end by default; SIGKILL skips it.
**How to avoid:** `child.stdin.write('q\n')` + 5s grace + SIGKILL fallback — D-01.
**Warning signs:** `ffprobe -v error` reports "moov atom not found"; mp4 plays but stops 5–30s early.

### Pitfall 2: Concat demuxer rejects segments with different codec params
**What goes wrong:** `ffmpeg -f concat -c copy` aborts if segments have different codec tags.
**Why:** The demuxer cannot safely stream-copy across incompatible codec configurations.
**How to avoid:** Every segment is encoded by the same ffmpeg invocation with identical args (D-12). The concat path is reliable for the v1 stack.
**Warning signs:** Concat fails with "DTS mismatch" or "codec not currently supported in container".

### Pitfall 3: Race between renderer `getUserMedia` preview and main ffmpeg
**What goes wrong:** EasyCap-exclusive drivers reject the second open.
**Why:** PITFALLS §3 — preview and recorder both want the device.
**How to avoid:** Phase 3 establishes the preview open sequence; Phase 4's `recording.start` does NOT re-open via `getUserMedia`. The renderer's preview handle is acquired before the IPC is invoked.
**Warning signs:** `getUserMedia` rejects with "Could not start video source" the moment recording starts.

### Pitfall 4: Path quoting on Windows device names
**What goes wrong:** `video=USB Video Device` gets split into multiple args.
**Why:** PITFALLS §10 — Windows device names contain unicode, spaces, trailing whitespace.
**How to avoid:** `spawn(cmd, args, { windowsVerbatimArguments: true })` + Phase 3 canonicalization on enumeration; the canonical form is what ffmpeg sees.
**Warning signs:** ffmpeg exits immediately with "Option video= (null) not found".

### Pitfall 5: Notes panel scrolls unbounded for long procedures
**What goes wrong:** 100+ notes in one procedure re-renders the entire list.
**Why:** D-09 ships no pagination; the side-rail can scroll.
**How to avoid:** The notes panel uses a shadcn `<ScrollArea>` with fixed height; new notes append at the bottom and auto-scroll. For procedures with >100 notes, Phase 5 review adds pagination. [ASSUMED] the side-rail limit is acceptable for typical cases (doctors write 5–30 notes per procedure).
**Warning signs:** React DevTools shows 100+ `<li>` re-renders on each note add.

### Pitfall 6: Phase 2 audit table contention during recording
**What goes wrong:** `audit_log` writes for every recording event block the procedure finalize.
**Why:** Phase 2 AUDIT-01 mandates every event; recording is event-heavy.
**How to avoid:** Each `recordAudit` is a single-row prepared statement. Per PITFALLS Performance Traps table: "Append single statements outside explicit transactions; transactions only for multi-row writes." No batching needed in Phase 4.
**Warning signs:** UI lag during Pause/Resume on a slow disk.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already wired Phase 1) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm run test:unit -- --run recording` |
| Full suite command | `npm run test:unit -- --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAPT-04 | One child per procedure (registry enforces) | unit | `npm run test:unit -- --run recorder/registry` | ❌ Wave 0 |
| CAPT-05 | mp4 written to canonical path with D-12 args | unit | `npm run test:unit -- --run recorder/ffmpeg-args` | ❌ Wave 0 |
| CAPT-06 | Stop = q\n + 5s + SIGKILL; fsync on close | unit | `npm run test:unit -- --run recorder/stop` | ❌ Wave 0 |
| CAPT-07 | Timer HH:MM:SS visible in UI | unit (Renderer) | `npm run test:unit -- --run renderer/procedure-room timer` | ❌ Wave 0 |
| CAPT-08 | Note save creates procedure_notes row + audit | unit | `npm run test:unit -- --run procedure-notes/create` | ❌ Wave 0 |
| CAPT-09 | Device-lost → partial file + sidecar + banner | unit | `npm run test:unit -- --run recorder device-lost` | ❌ Wave 0 |
| D-11 | Pause/Resume segments + concat at finalize | unit | `npm run test:unit -- --run recorder/segments` | ❌ Wave 0 |
| D-04 | Crash recovery scan on startup | unit | `npm run test:unit -- --run recorder/orphans` | ❌ Wave 0 |
| Integration | ffmpeg lavfi test produces playable mp4 | integration | `npm run test:integration -- --run recording-smoke` | ❌ Wave 0 |
| Manual UAT | Real webcam produces playable mp4 | manual | Windows hardware smoke | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- --run recording`
- **Per wave merge:** `npm run test:unit -- --run`
- **Phase gate:** Full suite green + Windows hardware smoke UAT before `/gsd-verify-work 4`.

### Wave 0 Gaps
- [ ] `tests/main/recorder/recorder.test.ts` — covers all 8 transition tests from Section 6.
- [ ] `tests/main/recorder/registry.test.ts` — busy-error + procedureId scoping.
- [ ] `tests/main/recorder/ffmpeg-args.test.ts` — D-12 args builder; per-preset bitrate matrix.
- [ ] `tests/main/recorder/concat.test.ts` — segment list file format (-c copy happy path + re-encode fallback).
- [ ] `tests/main/recorder/orphans.test.ts` — crash recovery scan.
- [ ] `tests/main/db/migrations/0002_procedures.test.ts` — schema validation; CHECK constraints enforced.
- [ ] `tests/main/ipc/procedures.test.ts` — IPC round-trip for `create / get / list / finalize`.
- [ ] `tests/main/ipc/procedure-notes.test.ts` — IPC round-trip for `create / list` + empty-body rejection.
- [ ] `tests/renderer/pages/procedure-room-timer.test.tsx` — HH:MM:SS rendering from injected `startedAt`.
- [ ] `tests/integration/recording-smoke.test.ts` — real ffmpeg lavfi → playable mp4.
- [ ] Framework: existing Vitest; no new dependencies.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | `requireSession()` from Phase 2 BLOCKER 4 — every IPC handler threads `session.currentUserId` into the procedure row. |
| V3 Session Management | yes | Active session ends at app close (Phase 1). No reauth needed mid-procedure. |
| V4 Access Control | yes | Renderer cannot pass `procedureId` cross-patient; `procedures.create` derives `patientId` from `requireSession()` + the route's patientId. |
| V5 Input Validation | yes | `procedure_notes.body` validated by SQL `CHECK(length(body) > 0 AND length(body) <= 1000)`; page/pageSize on `list` clamped to `[1, 100]`. |
| V6 Cryptography | no | No new encrypted columns. |
| V7 Error Handling | yes | Structured error codes (`RecorderBusyError`, `DeviceLostError`) returned over IPC; no PII in error messages. |
| V9 Communications | yes | No new network calls — fully offline. |
| V10 Malicious Code | yes | `recording.start` validates the deviceId is one of `enumerateDshowDevices()` results (canonicalized). Renderer cannot inject `ffmpeg` argv. |
| V11 Business Logic | yes | Registry enforces one child per procedureId; finalize is idempotent (re-call on same procedure is a no-op). |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer spoofs `procedureId` cross-patient | Tampering | `procedures.create` only accepts `patientId`; the procedure row's `doctor_id` is derived from `session.currentUserId`. Renderer cannot pass `doctorId`. |
| Renderer kills ffmpeg via OS signal | Denial of Service | Renderer has no IPC for raw child-process control; only `recording.stop` which goes through the supervisor's grace window. |
| Audit pollution from unauthenticated session | Repudiation | All `recording.*` audit calls gate on `requireSession()` (Phase 2 pattern). |
| Notes XSS in PDF report | Tampering | `@react-pdf/renderer` text escaping is the v1 control; Phase 6 PDF renderer adds explicit `<Text>` wrapping for user input. |
| Path traversal via `video_path` | Information Disclosure | All paths stored **relative to userData** (Anti-Pattern 2); resolved at read time via `path.join(app.getPath('userData'), storedRelPath)`. |

## Sources

### Primary (HIGH confidence)
- `.opencode/skills/electron-ffmpeg/SKILL.md` — full content read; verified spawn pattern, stderr regex, IPC contract pattern, asar unpack.
- `.planning/phases/04-recording-timer-device-lost/04-CONTEXT.md` — locked D-01..D-12; verified.
- `.planning/research/PITFALLS.md` — §1 (corrupt mp4), §2 (device-lost), §10 (path quoting) verified verbatim.
- `.planning/research/ARCHITECTURE.md` — Pattern 3 (ffmpeg supervision), Anti-Pattern 5 (no reuse), Data Flow §3-4 verified.

### Secondary (MEDIUM confidence)
- ffmpeg docs `-f concat -c copy` reliability for matched H.264 segments — [VERIFIED: ffmpeg docs; SKILL §4 + CONTEXT D-11].
- Phase 3 `canonicalizeOrThrow` + `enumerateDshowDevices` available — implicit; Phase 3 plan 03-01 establishes.
- `safeStorage` + `requireSession` + `recordAudit` prior art — Phase 2 patterns visible in `src/main/db/audit.ts` and `src/main/auth/session.ts` (per CONTEXT "Reusable Assets").

### Tertiary (LOW confidence)
- `WM_DEVICECHANGE` Win32 hook — [ASSUMED] out of Phase 4 scope; skip native addon.
- 30s stderr-silence secondary signal — [ASSUMED] defensive; not exercised in Phase 4 unless observed in practice.
- `audio_device_name` column reserved for v1.1 — [ASSUMED] safe to add now.
- `status='crashed'` enum value — [ASSUMED] not used in Phase 4 paths; reserved for future cleanup.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; locked by PROJECT.md.
- Architecture: HIGH — Pattern 3 + Anti-Pattern 5 are the documented standard; supervisor state machine is the canonical ffmpeg-supervision pattern.
- Schema: HIGH — D-06 / D-11 are locked; SQL CHECK constraints are the canonical input-validation pattern.
- IPC: HIGH — extends Phase 1/2/3 typed contract pattern.
- Pause/Resume concat: HIGH — `-c copy` is reliable for matched codec params; ffmpeg docs confirm.
- Device-lost detection: HIGH — stderr regex is the canonical ffmpeg signal; PITFALLS §2 verbatim.
- UAT test surface: HIGH — dependency injection is the standard testable-recorder pattern.
- Packaging: HIGH — `asarUnpack` is the canonical ffmpeg-static packaging pattern.

**Research date:** 2026-08-04
**Valid until:** 2026-09-04 (30 days; stable stack, no fast-moving deps)

---

*Phase: 4-recording-timer-device-lost*
