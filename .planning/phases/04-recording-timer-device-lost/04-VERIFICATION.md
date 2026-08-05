---
phase: 04-recording-timer-device-lost
verified: 2026-08-05T15:00:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
deferred: []
human_verification: []
---

# Phase 4: Recording — Timer + Device-Lost Verification Report

**Phase Goal:** Recording — ffmpeg child process + procedure timer + device-lost handling. Capture procedures, mark findings as screenshots during the case, no internet dependency.

**Verified:** 2026-08-05T15:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (goal-backward from phase goal + ROADMAP Phase 4)

| #   | Truth                                                                                                                                                          | Status     | Evidence                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A Record click spawns exactly one ffmpeg-static child per procedureId; a second `start()` for the same procedureId throws `RecorderBusyError`.                 | ✓ VERIFIED | `src/main/recorder/recorder.ts:192-198` reserves `procedureId` in registry FIRST, throws `RecorderBusyError` on duplicate. `registry.ts:8-15` enforces one-per-id. `tests/main/recorder/registry.test.ts` passes; recorder test 1 covers the busy path. |
| 2   | ffmpeg args include canonical device name, libx264/veryfast/23/+faststart, per-preset bitrate, framerate, resolution, rtbufsize 100M, mp4 to userData media path. | ✓ VERIFIED | `src/main/recorder/ffmpeg-args.ts:35-48` returns the verbatim D-12 array; preset bitrate matrix (sd=4M, hd=10M, custom=5M) in `presetSpec()`. `tests/main/recorder/ffmpeg-args.test.ts` covers all 3 presets. |
| 3   | Stop writes `'q\n'` to ffmpeg stdin within 50 ms, escalates to SIGTERM at 5 s → SIGKILL at 5.5 s, fsyncs the open mp4 fd before close, finalizes the procedure row. | ✓ VERIFIED | `src/main/recorder/recorder.ts:251-341` — `proc.stdin.write('q\n')` + 5s SIGTERM + 5.5s SIGKILL; `onExit` does `openSync`/`fsyncSync`/`closeSync` (line 632-635) + `proceduresRepo.updateFinalized` (line 738-744). Tests in `recorder.test.ts` cover happy path + grace + fsync sequence. |
| 4   | Procedure Room renderer enables Record button, subscribes to `recording:status` via `window.api.recording.onStatus`, ticks a `HH:MM:SS` derived from `startedAt` via `setInterval(1000)`. | ✓ VERIFIED | `src/renderer/src/pages/ProcedureRoom.tsx:64-72` (onStatus subscription), 78-94 (`setInterval(1000)` tick driver), 196-210 (Record/Stop toggle). `tests/renderer/pages/procedure-room-timer.test.tsx` "renders HH:MM:SS derived from recording:status startedAt" passes. |
| 5   | On `recording:status { status: 'stopped', procedureId }`, renderer navigates to `{ name: 'procedure-review', procedureId }` and renders the placeholder page.      | ✓ VERIFIED | `src/renderer/src/pages/ProcedureRoom.tsx:97-103` (navigate-on-stopped effect), `src/renderer/src/App.tsx:81-82` (case 'procedure-review'). `src/renderer/src/pages/ProcedureReview.tsx` fetches + renders the row. Test "navigates to procedure-review on recording:status stopped" passes. |
| 6   | Every `recording.started` / `recording.stopped` event writes one `audit_log` row with action + entityType='procedure' + entityId + deviceName/preset metadata; userId from `requireSession()`. | ✓ VERIFIED | `recorder.ts:447-453` (started audit), `:745-755` (stopped audit). `ipc/recording.ts:84-150` calls `audit({ action: 'recording.start', userId: doctorId, ...})` (line 136-145) — `userId` is `requireSession()` output, not from payload. `recording:stop` writes `recording.stop` audit (line 158-163). |
| 7   | All paths stored relative to `userData`; ffmpeg binary path rewritten `app.asar` → `app.asar.unpacked`; `package.json` `build.asarUnpack: ['**/node_modules/ffmpeg-static/**']`. | ✓ VERIFIED | `src/main/recorder/recorder.ts:212, 958-961` stores `data/media/patients/<patientId>/<procedureId>/video.mp4` (relative). `src/main/recorder/ffmpeg-path.ts:18` rewrites `app.asar` → `app.asar.unpacked` + `existsSync` guard (line 19-21). `package.json:11` `build.asarUnpack: ['**/node_modules/ffmpeg-static/**']` — confirmed via `node -p`. |
| 8   | The device-lost branch renames the segment to `.partial.mp4` + writes a sidecar JSON + emits `'lost'` status + writes `recording.lost` audit with `outcome='failed'`; finalizes as `'partial'`. | ✓ VERIFIED | `src/main/recorder/device-lost.ts:13` (DEVICE_LOST_RE matches 6 substrings case-insensitively), `:43-56` (parseLastKnownTimestampMs + 30min cap), `:91-106` (rewritePartial renames + writes sidecar). `recorder.ts:427-602` wires `onStderr` regex → `enterDeviceLost` → `handleDeviceLostExit` (rename + sidecar + audit with outcome='failed' + emit 'lost'). Finalize-as-partial path: `recorder.ts:261-301` (status='partial' + videoPath = `<segment>.partial.mp4`). `tests/main/recorder/device-lost.test.ts` covers all 6 cases; `tests/renderer/pages/procedure-room-timer.test.tsx` covers banner render, dismiss, Stop-stays-enabled, banner-below-notes, ProcedureReview Alert for partial. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact                                                                                       | Expected                                                              | Status     | Details                                                                                          |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `src/main/db/migrations/0002_procedures.sql`                                                   | procedures + procedure_notes + procedure_segments + indexes           | ✓ VERIFIED | Three tables with all required CHECK constraints + UNIQUE on (procedure_id, segment_index).      |
| `src/main/db/procedures-repo.ts`                                                                | insert / get / list / updateFinalized / insertNote / listNotes / insertSegment / listSegments / findByPartialPath | ✓ VERIFIED | 333 lines; all methods present with cached prepared statements.                                 |
| `src/main/recorder/recorder.ts`                                                                 | Recorder class with injectable deps + start/stop/pause/resume + device-lost branch | ✓ VERIFIED | 1060 lines; full state machine + segment-and-concat finalize + device-lost branch wired.        |
| `src/main/recorder/registry.ts`                                                                 | Map<procedureId, Recorder> + RecorderBusyError                        | ✓ VERIFIED | 41 lines; throws RecorderBusyError on duplicate procedureId.                                     |
| `src/main/recorder/ffmpeg-args.ts`                                                              | `buildFfmpegArgs` returning verbatim D-12 array                       | ✓ VERIFIED | 49 lines; pure function with per-preset bitrate matrix.                                         |
| `src/main/recorder/ffmpeg-path.ts`                                                              | `defaultFfmpegPath()` with asarUnpack rewrite + `existsSync` guard    | ✓ VERIFIED | 29 lines; matches plan verbatim.                                                                 |
| `src/main/recorder/init.ts`                                                                     | `initRecorder({ emit })` + `scanForOrphans()` re-exported from orphans.ts | ✓ VERIFIED | 29 lines; scanForOrphans re-exports the real implementation.                                    |
| `src/main/recorder/concat.ts`                                                                   | `writeConcatList` + `buildConcatArgs` pure functions                   | ✓ VERIFIED | 61 lines; default `-c copy` + fallback reencode args.                                           |
| `src/main/recorder/device-lost.ts`                                                              | DEVICE_LOST_RE + parseLastKnownTimestampMs + writePartialJson + rewritePartial | ✓ VERIFIED | 106 lines; all helpers + 30min cap.                                                              |
| `src/main/recorder/orphans.ts`                                                                  | scanForOrphans walker + fingerprintOrphan + idempotent audit dedup     | ✓ VERIFIED | 147 lines; depth-2 walk + audit_log LIKE-on-fingerprint dedup.                                  |
| `src/main/ipc/procedures.ts`                                                                    | procedures.create/get/list/finalize + procedure-notes:create/list      | ✓ VERIFIED | 242 lines; all handlers gate on requireSession + transaction+audit.                             |
| `src/main/ipc/recording.ts`                                                                     | start (canonicalize-before-insert) + stop + pause + resume             | ✓ VERIFIED | 201 lines; all handlers gate on requireSession.                                                  |
| `src/main/paths.ts`                                                                             | `procedureMediaDir(patientId, procedureId)` creates directory on demand | ✓ VERIFIED | 31 lines; mkdirSync recursive.                                                                   |
| `src/main/index.ts`                                                                             | `initRecorder` before IPC; `registerProceduresIpc` + `registerRecordingIpc`; `scanForOrphans()` at boot | ✓ VERIFIED | 94 lines; order correct, `void scanForOrphans()` call (line 75).                                |
| `src/shared/ipc-contract.ts`                                                                    | Procedure / ProcedureNote / ProcedureSegment / PresetSummary / RecordingStatus + IPC constants | ✓ VERIFIED | 302 lines; full type union + `RECORDING_PAUSE` + `RECORDING_RESUME` + `PROCEDURE_NOTES_*` constants. |
| `src/shared/validators.ts`                                                                      | proceduresCreateInput, proceduresGetInput, proceduresListQueryInput, proceduresFinalizeInput, procedureNoteCreateInput, procedureNoteListInput, recordingStartInput | ✓ VERIFIED | 186 lines; all zod schemas present, strict() where required.                                    |
| `src/preload/index.ts`                                                                          | `window.api.procedures.*`, `api.procedureNotes.*`, `api.recording.{start,stop,pause,resume,onStatus}` | ✓ VERIFIED | 83 lines; full bridge via contextBridge.                                                          |
| `src/renderer/src/store/recording.ts`                                                            | Zustand store + useTimerSnapshot + useLastLost + clearLastLost         | ✓ VERIFIED | 252 lines; per-slice selectors via useSyncExternalStore.                                         |
| `src/renderer/src/store/route.ts` + `lib/router.ts`                                             | Route union grows with `{ name: 'procedure-review'; procedureId }`     | ✓ VERIFIED | router.ts:15 confirms variant.                                                                   |
| `src/renderer/src/App.tsx`                                                                      | `case 'procedure-review'` renders `<ProcedureReview procedureId={route.procedureId} />` | ✓ VERIFIED | App.tsx:81-82.                                                                                   |
| `src/renderer/src/pages/ProcedureRoom.tsx`                                                       | Record/Stop toggle, HH:MM:SS timer, Pause/Resume, post-stop navigation, DeviceLostBanner mount, notes panel mount | ✓ VERIFIED | 387 lines; all four sub-features wired.                                                          |
| `src/renderer/src/pages/ProcedureReview.tsx`                                                    | Placeholder page + partial Alert wrap                                   | ✓ VERIFIED | 152 lines; loads procedure row + status Badge + partial Alert.                                   |
| `src/renderer/src/components/procedure-notes-panel.tsx`                                         | Textarea + Save button + ScrollArea + chronological list              | ✓ VERIFIED | 139 lines; h-[280px] ScrollArea; Save disabled when body empty/procedureId null.                 |
| `src/renderer/src/components/device-lost-banner.tsx`                                            | Inline Alert with formatted duration + device name + Dismiss           | ✓ VERIFIED | 46 lines; returns null when lastLost is null; non-modal.                                        |
| `src/renderer/src/lib/format-duration.ts`                                                       | `formatDurationHHMMSS(ms)` pure helper                                 | ✓ VERIFIED | 9 lines; clamps negatives.                                                                       |
| `src/renderer/src/components/ui/{textarea,scroll-area,badge,alert}.tsx`                         | Four shadcn additions                                                   | ✓ VERIFIED | All four files present.                                                                          |
| `package.json` build.asarUnpack                                                                  | `["**/node_modules/ffmpeg-static/**"]`                                 | ✓ VERIFIED | Confirmed via `node -p` — output `["**/node_modules/ffmpeg-static/**"]`.                        |
| `package.json` dependencies                                                                      | `@radix-ui/react-scroll-area@^1.2.18` (only Plan 02 dep added)         | ✓ VERIFIED | Confirmed; matches SUMMARY claim of single new dep.                                             |

### Key Link Verification

| From                                                       | To                                               | Via                                                                                  | Status   | Details                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `window.api.recording.onStatus(cb)`                        | `recording:status` push event → store            | `preload/index.ts:62-73` `ipcRenderer.on(IPC.RECORDING_STATUS, listener)` + unsubscribe closure | ✓ WIRED | Returns `() => ipcRenderer.removeListener(...)`. Tested.                                        |
| `Recorder.start`                                           | `proceduresRepo.insert` + ffmpeg spawn           | `recorder.ts:219-237` insert → spawn; `recorder.ts:441-453` write started_at on first 'frame=' | ✓ WIRED | Tests cover both happy path and busy-error.                                                      |
| `Recorder.stop` → `'q\n'` → exit → fsync → updateFinalized | `proceduresRepo.updateFinalized` + audit         | `recorder.ts:325-340` (q\n + grace), `:604-770` (exit handler with fsync + update + audit + emit) | ✓ WIRED | All transitions covered by recorder.test.ts.                                                    |
| `build.asarUnpack` → ffmpeg-static binary                  | `defaultFfmpegPath()` rewrite                    | `package.json:11` + `ffmpeg-path.ts:18-22`                                            | ✓ WIRED | Verified at runtime.                                                                              |
| `procedureMediaDir(patientId, procedureId)`                 | `<userData>/data/media/patients/<p>/<proc>`      | `paths.ts:27-30`                                                                      | ✓ WIRED | mkdirSync recursive on call.                                                                     |
| `scanForOrphans`                                           | audit_log with `recording.crash_partial` rows    | `orphans.ts:132-142` `audit({...})`                                                   | ✓ WIRED | `tests/main/recorder/orphans.test.ts` covers happy path + idempotent re-run + missing sidecar + fresh install. |
| `RecordingStatus { status: 'lost' }`                       | Zustand `lastLost` → DeviceLostBanner render     | `store/recording.ts:121-136` + `ProcedureRoom.tsx:378-381`                            | ✓ WIRED | Test "renders the banner with formatted duration after a `lost` recording:status push" passes.   |

### Data-Flow Trace (Level 4)

| Artifact                                | Data Variable                                                | Source                                                              | Produces Real Data | Status     |
| --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------ | ---------- |
| `ProcedureRoom.tsx` timer               | `timerMs`                                                    | `recordingStore.setStatus` ← `recording:status` IPC push event      | Yes (real wall-clock via injected startedAt) | ✓ FLOWING  |
| `ProcedureRoom.tsx` notes panel         | `notes` state                                                | `window.api.procedureNotes.list` IPC → `proceduresRepo.listNotes`   | Yes (DB)            | ✓ FLOWING  |
| `ProcedureRoom.tsx` DeviceLostBanner    | `lastLost`                                                   | `recordingStore.useLastLost()` ← setStatus on 'lost' event          | Yes (from supervisor payload) | ✓ FLOWING  |
| `ProcedureReview.tsx`                   | `procedure`                                                  | `window.api.procedures.get` IPC → `proceduresRepo.get`             | Yes (DB)            | ✓ FLOWING  |
| `ProcedureNotesPanel.tsx` save flow     | `notes` append                                               | `window.api.procedureNotes.create` IPC → `proceduresRepo.insertNote` | Yes (DB)            | ✓ FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                       | Command                                                          | Result                                                       | Status   |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | -------- |
| `npm run test:unit`                                            | `npm run test:unit`                                              | 314/314 tests pass across 46 test files in 12.0s.           | ✓ PASS   |
| `npm run typecheck:node`                                       | `npx tsc --noEmit -p tsconfig.node.json`                         | No errors.                                                    | ✓ PASS   |
| `npm run typecheck:web`                                        | `npx tsc --noEmit -p tsconfig.web.json`                          | No errors.                                                    | ✓ PASS   |
| `node -p "require('./package.json').build.asarUnpack"`         | introspection                                                    | `["**/node_modules/ffmpeg-static/**"]`                        | ✓ PASS   |
| `node -p IPC constants` (recording + procedures)               | introspection                                                    | `RECORDING_START/STOP/PAUSE/RESUME/STATUS` + `PROCEDURES_*` + `PROCEDURE_NOTES_*` present | ✓ PASS   |
| DB migration: 3 tables + UNIQUE on (procedure_id, segment_index) | SQL review of `0002_procedures.sql`                            | All present; CHECK(length(body) > 0 AND length(body) <= 1000) | ✓ PASS   |
| DEVICE_LOST_RE 6 substrings                                    | review `device-lost.ts:13`                                       | `I/O error | device disconnected | DeviceLost | EOF on input | Immediate exit requested | av_interleaved_write_frame`, case-insensitive | ✓ PASS   |

### Probe Execution

No probe scripts exist for this phase (the project does not use `scripts/*/tests/probe-*.sh`). The Wave 0 test suite is the verification surface.

### Requirements Coverage

The phase task narrowed to CAPT-04/05/06/07; the phase as a whole (across the 4 plans) covers all 6 procedure-related CAPT requirements.

| Requirement | Source Plan   | Description                                                                                                                   | Status      | Evidence                                                                                            |
| ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| CAPT-04     | 04-01         | Recording uses ffmpeg-static as a child process; spawned from main; one child process per active procedure.                  | ✓ SATISFIED | `recorder.ts:234-237` spawns ffmpeg-static via injectable `deps.spawn`; `registry.ts` enforces one-per-procedureId. |
| CAPT-05     | 04-01         | mp4 written to `<userData>/data/media/patients/<patientId>/<procedureId>/video.mp4` with `-c:v libx264 -preset veryfast -crf 23 -movflags +faststart`. | ✓ SATISFIED | `recorder.ts:212, 958-961` writes to that path; `ffmpeg-args.ts:38-46` produces the verbatim libx264 args. |
| CAPT-06     | 04-01         | On Stop, ffmpeg receives SIGTERM with grace (5s) → SIGKILL fallback; mp4 has a valid moov atom and fsync on close.         | ✓ SATISFIED | `recorder.ts:325-340` (5s SIGTERM + 5.5s SIGKILL), `:604-770` (fsync + close on exit), 318+ tests cover. |
| CAPT-07     | 04-01         | Procedure timer runs during recording (HH:MM:SS visible in the UI).                                                            | ✓ SATISFIED | `ProcedureRoom.tsx:78-94` setInterval(1000) tick; `format-duration.ts:3-8` formatter.               |
| CAPT-08     | 04-02         | Doctor can attach a quick note mid-procedure; notes are stored against the procedure row.                                     | ✓ SATISFIED | `procedure-notes-panel.tsx` (UI) + `proceduresRepo.insertNote` + `procedure-notes:create` IPC.       |
| CAPT-09     | 04-04         | If the capture device disconnects, the UI shows an inline warning; a `.partial.mp4` + sidecar JSON are preserved.         | ✓ SATISFIED | `device-lost.ts:DEVICE_LOST_RE` + `rewritePartial` (rename + sidecar JSON); `recorder.ts` emits 'lost' + audit; `DeviceLostBanner` (inline Alert) + `ProcedureReview` partial Alert. |

No orphaned requirements: every Phase 4 CAPT requirement (CAPT-04, 05, 06, 07, 08, 09) is implemented in one of the four plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) |  |  |  |  |

No TBD/FIXME/XXX markers introduced by Phase 4. One pre-existing `tbd-phase-8` in `src/main/auth/index.ts:191` is unrelated (Phase 8 license work).

### Stub / Placeholder Inventory (intentional, per plan)

| File | Stub | Reason |
|------|------|--------|
| `src/renderer/src/pages/ProcedureReview.tsx` | Trim + scrubber + screenshots not implemented | Phase 5 owns review + trim. Page already shows the row + status. |
| `recording:status` `'stopped'` arm clears `lastLost` before ProcedureReview mount | The Alert's formatted duration shows the static fallback `00:00:00` instead of the actual `lastKnownTimestampMs` (Plan 04 SUMMARY §"Known Stubs"). The mp4 is still recoverable via `video_path`. | Documented degraded-UX. A future plan can add an IPC channel to read the sidecar JSON on demand. |

Neither stub blocks the phase goal.

### Behavioral Evidence Coverage

All behavior-dependent truths in Step 3 are backed by passing tests in `tests/main/recorder/*.test.ts` and `tests/renderer/pages/procedure-room-timer.test.tsx`. No truth required a human-only verification item.

### Goal Achievement Summary

The phase goal "Recording — ffmpeg child process + procedure timer + device-lost handling" is observably achieved:

1. **ffmpeg child process** — Recorder spawns `ffmpeg-static` via injectable deps, enforces one-per-procedureId via the registry + RecorderBusyError, writes to the canonical relative path with the verbatim D-12 args + asarUnpack-aware binary resolution.
2. **Procedure timer** — `HH:MM:SS` visible in the UI, ticking every second from a `recording:status` subscription; formatDurationHHMMSS pure helper; pause/resume freezes/ unfreezes via Zustand `pausedAt` anchor; chip "Pause #N" surfaces segment count.
3. **Device-lost handling** — DEVICE_LOST_RE matches 6 substrings case-insensitively; supervisor renames the segment to `.partial.mp4` + writes `.partial.mp4.json` sidecar + writes `recording.lost` audit row with `outcome='failed'`; emit `'lost'` status; renderer mounts an inline `<Alert>` banner (no modal); Stop after device-lost finalizes the row as `'partial'` with the partial path; `scanForOrphans` walker emits one `recording.crash_partial` audit row per orphan on next launch with fingerprint-based idempotent dedup; `ProcedureReview` wraps the partial status in a full `<Alert variant='destructive'>`.

Plus the 4 supporting features from the same phase: append-only `procedure_notes` (DB CHECK 1..1000 chars), Pause/Resume with segment-and-concat finalize (default `-c copy` + re-encode fallback), procedures IPC round-trip with audit + `requireSession` gates, and a `procedure-review` placeholder page that navigates after Stop.

All 6 Phase 4 requirement IDs (CAPT-04, 05, 06, 07, 08, 09) are satisfied.

---

_Verified: 2026-08-05T15:00:00Z_
_Verifier: the agent (gsd-verifier)_
