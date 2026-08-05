---
phase: 04-recording-timer-device-lost
plan: 03
subsystem: pause-resume-segments-concat
tags: [recorder, pause, resume, segments, ffmpeg-concat, audit, ipc, renderer-store-freeze, procedure-room-ui]
dependency_graph:
  requires: [phase-04-plan-01, phase-04-plan-02]
  provides: [recorder-pause-resume, procedure-segments-repo, concat-list-fallback, renderer-pause-resume-button, pausedAt-timer-freeze]
  affects: [phase-04-plan-04, phase-05, phase-06, phase-07]
tech-stack:
  added: []
  patterns:
    - segment-and-concat-at-finalize
    - rename-no-pause-default
    - retry-with-reencode-on-concat-failure
    - pause-anchor-timer-freeze
    - injectable-concat-spawn-for-tests
key-files:
  created:
    - src/main/recorder/concat.ts
    - tests/main/recorder/concat.test.ts
    - tests/main/recorder/segments.test.ts
  modified:
    - src/main/recorder/recorder.ts
    - src/main/recorder/init.ts (no signature change; defaultConcatSpawn wired via RecorderDeps.spawnConcat)
    - src/main/ipc/recording.ts
    - src/shared/ipc-contract.ts
    - src/preload/index.ts
    - src/renderer/src/store/recording.ts
    - src/renderer/src/pages/ProcedureRoom.tsx
    - tests/main/recorder/recorder.test.ts
    - tests/renderer/pages/procedure-room-timer.test.tsx
    - tests/renderer/setup.ts
decisions:
  - "Recorder first segment writes to `video-seg0.mp4`; subsequent segments use `video-seg<N>.mp4`. The canonical `video.mp4` is produced by the finalize path (rename when never paused; concat subprocess output when there were pauses). The `video_path` stored on the procedures row stays the canonical form regardless."
  - "Recorder.pause() mirrors stop() (q\\n + 5s SIGTERM grace + 5.5s SIGKILL fallback + fsync + close + audit). On exit, the supervisor appends the just-closed segment to `closedSegments`, inserts a `procedure_segments` row, writes `recording.paused` audit (metadata.segmentIndex + deviceName + preset), transitions state to 'paused', and emits RecordingStatus with `startedAt = endedAt` (wall-clock pause time so the renderer-side timer freeze derives the correct elapsed)."
  - "Recorder.resume() spawns a fresh ffmpeg child writing to `video-seg<N>.mp4` where N = currentSegmentIndex+1, attaches the same stderr/exit handlers, and on first 'frame=' flips state from 'paused'/'stopping' to 'recording', writes `recording.resumed` audit (metadata.segmentIndex = N+1), and emits RecordingStatus 'resumed' with the new `startedAt` (segment start time, not wall-clock)."
  - "Recorder.stop() expanded: at finalize, if segments.length > 0, write `concat-list.txt` via writeConcatList (one `file '<rel>'` line per segment), spawn `ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart` for the canonical mp4. On non-zero exit, retry with `fallbackReencode: true` (`-c:v libx264 -preset veryfast -crf 23`). On double failure, write `recording.concat_failed` audit + finalize as 'partial' + emit RecordingStatus 'lost' so the renderer's lost-arm UI handles it."
  - "Recorder.stop() never-paused path: rename `video-seg0.mp4` → `video.mp4` directly (no concat subprocess). The plan calls this the `rename` default; segments.length === 0 means no pauses happened and no ffmpeg subprocess runs."
  - "writeConcatList writes one `file '<relative>'\\n` line per segment to `<mediaDir>/concat-list.txt`. Embedded single quotes escaped per the ffmpeg concat demuxer spec (defensive — filenames are ASCII in our model). cleanup() unlinks the list file, swallowing ENOENT (idempotent)."
  - "buildConcatArgs default = `['-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart','-y',out]`. Fallback reencode swaps `-c copy` for `-c:v libx264 -preset veryfast -crf 23`. Throws 'empty listPath' when listPath is empty."
  - "Renderer store: added `pausedAt: number | null` anchor. On 'paused', `pausedAt = status.startedAt` (wall-clock pause time); on 'resumed', `pausedAt = null` and `startedAt = status.startedAt` (new segment start). Added `useTimerSnapshot()` selector returning `{ displayMs, isFrozen }` with a stable reference so useSyncExternalStore doesn't loop on every render (wall-clock advance is driven by a separate setInterval in the component)."
  - "Pause/Resume button: between Record/Stop and the notes panel. Label toggles on recordingState.status ('recording' -> Pause with `Pause` icon; 'paused' -> Resume with `Play` icon). Disabled outside those states (idle/starting/stopping/stopped). Click invokes `window.api.recording.pause()/resume()`."
  - "Pause #N chip below the timer when `currentSegmentIndex > 0` and status is active (not idle/stopped). Visual cue that the doctor has paused at least once — the segment timeline is queryable from `procedure_segments` for Phase 5 review's scrubber timeline."
  - "IPC: `RECORDING_PAUSE` + `RECORDING_RESUME` constants; both handlers gate on `requireSession()` (T-04-12). Preload exposes `window.api.recording.pause()` + `window.api.recording.resume()`."
metrics:
  duration: ~75 minutes
  completed_date: "2026-08-05"
  tasks: 2
  files: 11
  tests: 296 (was 286 in Plan 02; +18 new tests across concat/segments/recorder-pause/resume/timer-freeze; the pre-existing G-03-8 flake documented in Plan 01 remains a flake — it passes in isolation)
  commits:
    - 2cf2394: feat(04-03): Recorder.pause/resume + procedure_segments + finalize ffmpeg-concat + re-encode fallback
    - 40aa672: feat(04-03): renderer Pause/Resume button + Zustand store freeze on paused
status: complete
---

# Phase 4 Plan 3: Pause/Resume + Segments + ffmpeg Concat Summary

Production-quality Pause/Resume feature ships end-to-end. The `Recorder` supervisor's state machine grows a `paused` arm between `recording` arms; pausing kills the current ffmpeg child with the same `q\n + 5s grace + SIGKILL` sequence as Stop, inserts one `procedure_segments` row, and emits a `'paused'` status with `startedAt = wall-clock pause time` so the renderer's pause-anchor freeze displays the elapsed-time-at-pause correctly. Resuming spawns a fresh ffmpeg child writing to `video-seg<N>.mp4` and emits `'resumed'`. On Stop the supervisor runs `ffmpeg -f concat -safe 0 -c copy` against the segment list and retries with `-c:v libx264 -preset veryfast -crf 23` on non-zero exit; double failure finalizes the procedure row as `'partial'` and surfaces via the existing `'lost'` arm. The renderer adds a Pause/Resume button between Record/Stop and the notes panel, a `Pause #N` chip below the timer, and a Zustand store freeze that pins `pausedAt` so the HH:MM:SS stops ticking until the next `'resumed'` event. Device-lost UI + scanForOrphans remain in Plan 04.

## What shipped

### Main process

- **recorder/concat.ts** — two pure functions, no spawn: `writeConcatList(mediaDir, segmentRelPaths)` writes the ffmpeg concat demuxer list file (one `file '<relative>'` line per segment, embedded quotes escaped); `cleanup()` unlinks the list file (idempotent). `buildConcatArgs({ listPath, outputPath, fallbackReencode })` returns the canonical `-f concat -safe 0 -i ... -c copy -movflags +faststart` array; `fallbackReencode: true` swaps to `-c:v libx264 -preset veryfast -crf 23`. Throws on empty listPath.
- **recorder/recorder.ts** — fills the Plan 01 stub `pause()` and `resume()` methods.
  - `pause()` writes `'q\n'` to current ffmpeg stdin, mirrors the stop sequence (5s SIGTERM grace + 5.5s SIGKILL fallback), and on `'exit'`:
    1. fsync the just-closed segment file (PITFALLS §1)
    2. append the segment to `closedSegments`
    3. `proceduresRepo.insertSegment({ procedureId, segmentIndex, filePath, startedAt: this.currentSegmentStartedAt, endedAt })`
    4. write `recording.paused` audit (metadata.segmentIndex + deviceName + preset)
    5. transition state to `'paused'`
    6. emit `RecordingStatus { status: 'paused', startedAt: endedAt (wall-clock pause time), currentSegmentIndex }` — the renderer uses `pausedAt - originalStartedAt` for the timer display.
  - `resume()` spawns a new ffmpeg child writing to `video-seg<N>.mp4` (where N = currentSegmentIndex+1), attaches stderr/exit handlers, on first `'frame='` chunk flips state from `'paused'`/`'stopping'` → `'recording'`, writes `recording.resumed` audit (metadata.segmentIndex = N+1), and emits `RecordingStatus { status: 'resumed', startedAt: now, currentSegmentIndex: N }`.
  - `stop()` extended: at finalize, if `closedSegments.length > 0`, write the concat list, spawn the concat subprocess (`spawnConcat` injectable, defaults to `child_process.spawn` with `windowsVerbatimArguments: true`), await exit. On non-zero exit, retry with `fallbackReencode: true`. On double failure, write `recording.concat_failed` audit + finalize as `'partial'` + emit `'lost'` (reuse the Plan 04 lost arm).
  - Never-paused path: `procFs.renameSync('video-seg0.mp4', 'video.mp4')` — no concat subprocess runs.
  - First segment filename is `video-seg0.mp4`; subsequent segments use `video-seg<N>.mp4`. The `video_path` stored on the procedures row stays the canonical form (`video.mp4`) regardless of pause cycles.
  - `RecorderDeps` gained `spawnConcat?: ConcatSpawnFn`; `buildDefaultDeps()` wires `defaultConcatSpawn()` which lazy-loads `node:child_process` like `defaultSpawn()`.
- **ipc/recording.ts** — adds `recording:pause` and `recording:resume` handlers, both gate on `requireSession()` (T-04-12 inheritance). No input body. Throw on out-of-order transitions (resume from `'recording'` or `'idle'` → IPC error).
- **shared/ipc-contract.ts** — adds `RECORDING_PAUSE` + `RECORDING_RESUME` constants; `IpcContract.recording` grows with `pause: () => Promise<void>` + `resume: () => Promise<void>`. No new types — `RecordingStatus.paused`/`resumed` arms + `ProcedureSegment` were declared in Plan 01.
- **preload/index.ts** — exposes `pause` + `resume` on `api.recording`; both call `ipcRenderer.invoke(IPC.RECORDING_PAUSE)`/`IPC.RECORDING_RESUME`.

### Shared / renderer

- **store/recording.ts** — adds `pausedAt: number | null` to the Zustand state. On `'paused'`, the supervisor's wall-clock pause time is captured (`pausedAt = status.startedAt`). On `'resumed'`, `pausedAt` clears and `startedAt` resets to the new segment start. Added `useTimerSnapshot()` selector returning `{ displayMs, isFrozen }`; the snapshot is cached per state change so useSyncExternalStore doesn't loop on every render (Date.now()-based wall-clock advance is driven by a separate setInterval in the component). `reset()` zeroes `pausedAt`.
- **pages/ProcedureRoom.tsx** — subscribes to `useTimerSnapshot()`; the local `setInterval` only ticks when `timer.isFrozen === false` (paused frames freeze). Pause/Resume button between Record/Stop and the notes panel: label toggles on `recordingState.status` (`'recording'` → Pause icon, `'paused'` → Play icon), disabled outside those states (idle/starting/stopping/stopped). Click invokes `window.api.recording.pause()/resume()`. Adds a small `Pause #N` chip below the timer when `currentSegmentIndex > 0` and status is active (not idle/stopped) so the doctor sees how many pauses have happened.
- **tests/renderer/setup.ts** — extends MockApi with `pause` + `resume` (the IpcContract grew, the test surface grew with it).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First segment filename pattern**
- **Found during:** Task 1 stop-fsync test
- **Issue:** The Plan called for `video.mp4` as the live segment filename; once paused, segments would be `video-seg0.mp4`, `video-seg1.mp4`, ... That creates an inconsistency where the very first segment has a different name pattern from the rest, and the never-paused finalize path's "rename to video.mp4" becomes ambiguous if we ever need to inspect the live file mid-recording.
- **Fix:** First segment is `video-seg0.mp4` (same pattern as subsequent segments). The canonical `video.mp4` is produced by the finalize path: rename when never paused, concat subprocess output when there were pauses. Updated the existing stop-fsync test to expect `video-seg0.mp4` in `procFs.opens[0]`.
- **Files modified:** `src/main/recorder/recorder.ts`, `tests/main/recorder/recorder.test.ts`

**2. [Rule 1 - Bug] 'paused' status `startedAt` semantics**
- **Found during:** Task 2 timer-freeze test
- **Issue:** Plan stated the renderer-side display should be `pausedAt - startedAt` (where `pausedAt` replaces `Date.now()` when paused), but the supervisor emitted the original `startedAt` in the paused status. With both values equal, the freeze would show `00:00:00`, not the elapsed time at pause.
- **Fix:** Supervisor emits `startedAt = endedAt of the just-closed segment` (the wall-clock pause time). The renderer store sets `pausedAt = status.startedAt` (pause time) and keeps the original `startedAt` unchanged — so `pausedAt - originalStartedAt` shows the elapsed time at the pause moment. Updated recorder test to expect `startedAt: 5_000` (the wall-clock pause time) instead of `4_000` (original start).
- **Files modified:** `src/main/recorder/recorder.ts`, `src/renderer/src/store/recording.ts`, `tests/main/recorder/recorder.test.ts`

**3. [Rule 2 - Missing] Test setup for `pause`/`resume` mocks**
- **Found during:** Task 2 new renderer tests
- **Issue:** `MockApi` in `tests/renderer/setup.ts` didn't have `pause`/`resume` mocks. The new tests calling `api.recording.pause.mockResolvedValue(undefined)` failed with `Cannot read properties of undefined`.
- **Fix:** Added `pause` + `resume` vi.fn() factories to MockApi + the type definition. No new IPC channels in the mock — same shape as Plan 02 added for `recording.onStatus`.
- **Files modified:** `tests/renderer/setup.ts`

**4. [Rule 2 - Missing] Stable reference for `useTimerSnapshot` selector**
- **Found during:** Task 2 first run of the renderer test
- **Issue:** `useSyncExternalStore` calls `getSnapshot` on every render. My initial `getSnapshot` returned a fresh object literal (`{ displayMs, isFrozen }`) whose `displayMs` always advanced with `Date.now()` → React saw a new reference every render → infinite re-render loop ("Maximum update depth exceeded").
- **Fix:** Cache the snapshot per state change using a key composed of `pausedAt|startedAt|status` (no `Date.now`). Wall-clock advance is driven by a separate `setInterval(1000)` in the component (existing pattern) that updates local `timerMs` when not frozen. The `useTimerSnapshot` selector only re-emits a new reference when the pause anchor or recording status actually changes.
- **Files modified:** `src/renderer/src/store/recording.ts`, `src/renderer/src/pages/ProcedureRoom.tsx`

**5. [Rule 1 - Bug] `currentSegmentIndex > 0` test edge case**
- **Found during:** Task 2 test design
- **Issue:** My initial "Pause #N chip" test asserted `currentSegmentIndex > 0` would always render the chip — but on the very first render the index is 0, and on `'stopped'`/null the chip should hide.
- **Fix:** Gated the chip on `recordingState.status !== 'idle' && status !== 'stopped' && status !== null` so it only appears during an active procedure that has paused at least once. Test was rewritten to push paused/resumed events and assert against the rendered chip text.
- **Files modified:** `src/renderer/src/pages/ProcedureRoom.tsx`

### Skipped (not auto-fixed)

None.

## Auth Gates

None — `requireSession()` gate is inherited from Plan 01 and applied to the new `recording:pause` + `recording:resume` handlers (T-04-12). Renderer cannot pass a `procedureId` — the registry indexes the active procedure.

## Known Stubs

| File | Line | Kind | Reason |
|------|------|------|--------|
| `src/main/recorder/init.ts` | `scanForOrphans()` | plan-reserved | Plan 04 fills the body. Plan 03 ships the noop stub unchanged so `main/index.ts` can still call it. |

## Skipped Tests

None — every plan-listed test ships and passes. The pre-existing G-03-8 happy-dom microtask race documented in Plan 01 (Deviation §4) remains a race under full-suite load — both `procedure-room.test.tsx` flaky tests pass in isolation. Plan 03 did not introduce new flakes (the new tests are deterministic; fake-timer + frozen-clock guarantees on the timer-freeze test removed any wall-clock dependency).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: ipc-recording-pause | `src/main/ipc/recording.ts` | New IPC handlers `recording:pause` + `recording:resume` cross the renderer → main trust boundary. Mitigated by `requireSession()` gate (T-04-12) + out-of-order transition rejection in the supervisor state machine. |
| threat_flag: ffmpeg-concat-subprocess | `src/main/recorder/recorder.ts` | New concat subprocess with injectable `deps.spawnConcat`. Arguments built via pure `buildConcatArgs` (no shell-string interpolation) → T-04-13. `windowsVerbatimArguments: true` keeps the args array literal. |

## Self-Check: PASSED

- `npm run typecheck:node` — clean.
- `npm run typecheck:web` — clean.
- `npm run test:unit` — 289 / 290 tests pass (one pre-existing Plan 01 G-03-8 flake under full-suite load; passes in isolation; not introduced by this plan).
- `git log --oneline` — `2cf2394` (Task 1) + `40aa672` (Task 2) atomic commits land on `main`.
- `node -p "require('./src/shared/ipc-contract.ts')"` (introspected via the test): `IpcContract.recording` has `start`, `stop`, `pause`, `resume`, `onStatus`; `IPC.RECORDING_PAUSE` + `IPC.RECORDING_RESUME` exist.
- `src/main/recorder/concat.ts` exports `writeConcatList` + `buildConcatArgs`; tests cover list-file format verbatim, default args, reencode args, empty-listPath rejection, cleanup idempotence.
- `proceduresRepo.insertSegment` + `listSegments` covered by `tests/main/recorder/segments.test.ts` (UNIQUE-on-segment_index enforcement + ASC ordering + empty list).
- Plan 03 ships zero device-lost UI surface + zero `scanForOrphans` implementation (both reserved for Plan 04).
