# Phase 5: Screenshots + Procedure Review + Trim - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

## Phase Boundary

Doctor can capture screenshots during or after a procedure, walk through the recording on a scrubber with a clickable screenshot timeline, and trim the procedure to the salient portion. Phase 5 replaces the Phase 4 Procedure Review placeholder with a real review screen, adds a `screenshots` table + JPEG pipeline (served by main, captured from the current `<video>` / `<img>` frame), and adds a post-recording trim flow that produces a new mp4 (original never overwritten) via `ffmpeg -ss <start> -t <duration> -c copy`.

## Implementation Decisions

### Screenshot capture

- **D-01:** Screenshots are captured in **two places**: mid-procedure (button + `S` hotkey in ProcedureRoom, while a recording is active) AND post-recording (button in ProcedureReview, captures the current playback position). Two entry points cover both the "capture the moment while the endoscope is on the lesion" and the "scrub back later to find moments the doctor didn't mark" workflows. — **Reversibility:** reversible — UI surface only, IPC handlers are additive.
- **D-02:** Mid-procedure screenshot hotkey is **`S`** (matches the Phase 4 keyboard shortcut pattern: `Space` = pause/resume, `Esc` = stop, `R` = record; `S` = screenshot). Suppressed when typing in the notes textarea (same `isTypingTarget` guard from Phase 4). — **Reversibility:** reversible — renderer-side keymap.
- **D-03:** Screenshot content source: mid-procedure uses the live `<img>` MJPEG frame from the in-flight ffmpeg tee (the same frame the doctor sees on screen); post-recording uses the `<video>` element's current frame via canvas snapshot (`drawImage(videoRef.current, 0, 0, w, h)` → `canvas.toDataURL('image/jpeg', 0.85)` → save). Canvas path reuses the `MediaStream` + canvas pattern from `research/STACK.md §screenshots`; mid-procedure path is a NEW pattern (tee'd MJPEG is in scope per Phase 4 preview-server; Phase 5 just `fetch`es the latest multipart frame, or — simpler — writes a one-shot JPEG via ffmpeg's `image2` muxer). The agent chooses the simpler implementation. — **Reversibility:** reversible — frame source is internal to `captureScreenshot()`.
- **D-04:** JPEG quality = `0.85` and maximum dimension = `1280` (long edge; preserves enough detail for clinical review + PDF report). Files persist at `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<timestampMs>.jpg`; the DB stores `file_path` as the userData-relative form per Phase 4 D-04. — **Reversibility:** reversible — storage path is a const.
- **D-05:** Each screenshot row: `id INTEGER PRIMARY KEY AUTOINCREMENT, procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE, timestamp_in_video INTEGER NOT NULL CHECK(timestamp_in_video >= 0), file_path TEXT NOT NULL, annotation TEXT, created_at INTEGER NOT NULL`. Indexed on `(procedure_id, timestamp_in_video ASC)` for the timeline query. `timestamp_in_video` is in milliseconds since procedure start (matches `procedures.started_at` reference frame from Phase 4 D-10). `annotation` is nullable per ROADMAP — defaults to NULL on capture; the doctor can fill it later. — **Reversibility:** **one-way** — schema migration; the `screenshots` table is referenced by Phase 6 PDF report (per REQUIREMENTS REPORTS — attach selected screenshots). Changing shape later means a second migration.

### Trim

- **D-06:** Trim UX: **two draggable handles on the scrubber** (YouTube-style). When the doctor enters Trim mode (toggle button in the right rail), the scrubber grows two handles — one for the in-point, one for the out-point — and the cut region between them is highlighted in red. Doctor drags the handles, sees a live preview of the trimmed range (the `<video>` clips to the in/out), clicks Apply. Same scrubber the doctor already uses for seek — no separate mode. — **Reversibility:** reversible — UI behavior; trim handles are toggled by component state.
- **D-07:** Trim is **non-destructive** per ROADMAP ("original never overwritten"). On Apply, main runs `ffmpeg -ss <in_ms>/1000 -i <original.mp4> -t <(out_ms - in_ms)/1000> -c copy <trimmed.mp4>` (no re-encode; relies on segment boundary alignment for clean cuts per `research/PITFALLS.md §Pitfall 1`). `procedures.video_path` updates to `<trimmed>.mp4`; `procedures.video_path_original` is populated on first trim and never overwritten (later trims re-trim the **current** `video_path`, leaving `video_path_original` intact). The original mp4 is never deleted. — **Reversibility:** **one-way** — `video_path_original` is part of the schema; removing it requires a migration. The trim command itself is a write operation but reversible via Restore (see D-09).
- **D-08:** Trim accuracy: `-ss` BEFORE `-i` enables fast seek by keyframe (faster but cuts may land a few hundred ms off from the doctor's intended handle). `-ss` AFTER `-i` decodes from the start to the seek point (slower but cuts are exact). Phase 5 ships with **`-ss` BEFORE `-i`** (`-c copy` requires it for stream-copy to work) and accepts ±500ms accuracy per `research/PITFALLS.md §Pitfall 1`. Doctor can fine-tune with the trim handles if a cut lands awkwardly. — **Reversibility:** reversible — ffmpeg arg ordering, no schema impact.
- **D-09:** Re-trim / restore: the doctor can re-trim the current `video_path` (new handles, new trimmed file; `video_path_original` unchanged), OR restore from `video_path_original` to the original recording (single-click Restore in the right rail; restores the original segment boundaries + procedure timer + notes + screenshots). Restore is idempotent (the original mp4 is preserved at `video_path_original`, so re-restoring is a no-op). — **Reversibility:** reversible — restore is a single IPC call.

### Procedure Review screen layout

- **D-10:** Procedure Review screen layout: **video pane left + tools right**, mirroring the Phase 4 ProcedureRoom layout for visual consistency. Left: `<video>` player + scrubber + screenshot timeline + pause markers. Right: Notes accordion (D-09) + Trim action panel (mode toggle + Apply/Restore) + procedure metadata (patient name, doctor, started/ended, duration, status badge). Top: clean header (no "Step 3" labels — per the Phase 4 UI cleanup). — **Reversibility:** reversible — UI placement.
- **D-11:** Pause markers on the scrubber: the `procedure_segments` table (Phase 4 D-11) is queried for segment boundaries; each segment's `(started_at, ended_at)` renders as a vertical tick mark on the scrubber (subtle gray bar; tooltip shows "Pause 1: 02:34–04:12" on hover). Ticks are informational only — they don't gate seek or trim (the doctor can seek anywhere within the canonical mp4). — **Reversibility:** reversible — display-only.
- **D-12:** Screenshot timeline: rows below the scrubber, horizontally scrollable thumbnails (each ~120×90px), ordered by `timestamp_in_video ASC`. Clicking a thumbnail seeks the `<video>` to that timestamp. A "+ Capture" button at the end of the timeline captures from the current playback position. Hover on a thumbnail shows the timestamp + a small × to delete the screenshot (with an undo affordance via a Toast per the established shadcn pattern). — **Reversibility:** reversible — UI behavior.
- **D-13:** Status for partial procedures (`.partial.mp4`): the review screen plays the partial mp4 from the row's `video_path` (which already points to the partial path per Phase 4 D-03). The Destructive Alert from Phase 4 stays at the top. Scrubber/screenshot timeline work as normal but the doctor can see the partial recording play through. Trim is disabled on partial recordings (no meaningful in/out — there's nothing to cut to). — **Reversibility:** reversible — UI gate.

### the agent's Discretion

- Screenshot annotation UX — agent's call. Options: inline `<input>` on each thumbnail, modal "Edit annotation", or a dedicated annotation panel. The schema (`annotation TEXT` nullable) supports all three. Pick the simplest that doesn't crowd the timeline.
- Capture frame source implementation — agent's call between (a) canvas snapshot from the live `<img>` MJPEG and (b) one-shot ffmpeg `image2` muxer write triggered by IPC. The simpler one wins.
- Screenshot thumbnail size — `~120×90` is recommended for the timeline; agent can adjust to taste.
- Screenshot deletion UX — confirm modal vs. Toast-with-undo vs. no-delete (just hide). Schema has no `deleted_at` column, so deletion is a hard `DELETE FROM screenshots WHERE id = ?`. Agent picks the right affordance.
- Trim handle color and visual treatment — must indicate "drag me" + "cut region between me and the other handle". Agent picks shades (red highlighted region per the user's recommendation is the default).
- Restore button placement — right rail next to Trim Apply, or a separate "Restore original" button in the procedure metadata section. Agent picks.
- Trim accuracy tradeoff — Phase 5 ships `-ss before -i` (fast, ±500ms); a future Phase could add exact-cut by `-ss after -i -c:v libx264 -preset veryfast` (re-encode, slower but pixel-exact). Not in Phase 5 scope.
- Audit metadata fields for `screenshot.captured` / `screenshot.deleted` / `procedure.trimmed` / `procedure.restored` — agent picks keys; minimum is `{ screenshotId, timestamp_in_video }` for screenshots + `{ in_ms, out_ms, original_video_path }` for trim.
- Migration shape: `0005_screenshots_and_trim.sql` (one file with `screenshots` table + `ALTER TABLE procedures ADD COLUMN video_path_original TEXT`) — recommended, but the agent can split into `0005_screenshots.sql` + `0006_trim.sql` if it wants two smaller migrations.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements

- `.planning/ROADMAP.md` §Phase 5 — Goal, success criteria, pitfalls addressed, notes
- `.planning/REQUIREMENTS.md` §SCRN-01, §SCRN-02, §REV-01, §REV-02, §REV-03, §REV-04 (Traceability row)
- `.planning/PROJECT.md` §Key Decisions (ffmpeg-static vs MediaRecorder), §Constraints (no MediaRecorder for recording, Electron sandbox), §Out of Scope (advanced editing, AI detection)
- `.planning/STATE.md` §Current Focus (Phase 5 next milestone), §Phase 4 decisions (carry-forward D-03, D-05, D-09, D-10, D-11), §Phase 4 sub-plans table (8/8 plans shipped — no new infrastructure needed for Phase 5)

### Technical research (stack, pitfalls, architecture)

- `.planning/research/STACK.md` §Native `<video>` + canvas snapshot pattern (Phase 5 screenshots); §canvas `drawImage(videoRef.current)` + `toDataURL('image/jpeg', 0.85)` quality baseline
- `.planning/research/PITFALLS.md` §Pitfall 1 (corrupt mp4 at end of long procedure — Phase 5 trim's `-ss before -i -c copy` may produce imperfect cuts near non-keyframe boundaries; ±500ms acceptable), §Performance Traps (per-row re-render of the screenshot timeline — wrap thumbnails in a memoized `<ScreenshotThumbnail>` component)
- `.planning/research/ARCHITECTURE.md` §Pattern 3 (ffmpeg child process supervision — trim is a one-shot ffmpeg child, similar to concat), §Anti-Pattern 5 (no ffmpeg reuse across procedures — trim creates a fresh child for each Apply), §Data Flow §3 (Stop procedure flow — Phase 5 review replaces the Phase 4 placeholder; `video_path` is updated post-trim)
- `.planning/research/SUMMARY.md` §Phase 5 implications (native `<video>` + canvas snapshots, no exotic deps)

### Phase 1, 2, 3, 4 context (carry forward)

- `.planning/phases/01-scaffold/01-CONTEXT.md` — D-01..D-08 (app identity, security baseline, IPC contract pattern)
- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — D-01..D-08 (migrations runner, audit helper, soft-delete, IPC contract pattern)
- `.planning/phases/03-capture-enumeration-live-preview/03-CONTEXT.md` — D-01..D-11 (device picker UX, per-(doctor, device) preset matrix D-04, preview lifecycle D-07/D-08, canonical device-name D-11)
- `.planning/phases/04-recording-timer-device-lost/04-CONTEXT.md` — D-03 (device-lost → `.partial.mp4` + sidecar JSON; review plays the partial), D-05 (route `'procedure-review'` is final; Phase 5 replaces the placeholder), D-09 (notes may add pagination in review), D-10 (`procedures.started_at` referenced by trim in/out; `recording:status` IPC event channel), D-11 (`procedure_segments` table is the source for pause-marker timeline rendering)

### Skills & procedures (how to ship Phase 5)

- `.opencode/skills/electron-ffmpeg/SKILL.md` §7 (screenshot from preview — Phase 4 deferred this, Phase 5 uses), §1 (two-path architecture — Phase 4 owns recording, Phase 5 owns review), §2 (ffmpeg-static asarUnpack pattern — trim's ffmpeg child follows the same `defaultFfmpegPath()`), §4 (start a recording — trim's one-shot ffmpeg spawn mirrors this with a shorter args list), §5 (IPC wiring — Phase 5 extends `procedures.*` with `trim` + `restore` + `addScreenshot` + `deleteScreenshot` + `updateAnnotation`)
- `.opencode/skills/electron-vite/SKILL.md` — Three-process model; renderer↔main IPC contract
- `.opencode/skills/electron-sqlite/SKILL.md` — Migration runner; Phase 5 adds `0005_screenshots_and_trim.sql` (or split into `0005_screenshots.sql` + `0006_trim.sql`)

### Audit log integration (Phase 2 already wired)

- `src/main/db/audit.ts:audit()` — Phase 5 reuses for every `screenshot.captured` / `screenshot.deleted` / `procedure.trimmed` / `procedure.restored` event with structured metadata

### Schema baseline (Phase 4)

- `src/main/db/migrations/0002_procedures.sql` — Phase 5 extends with `screenshots` table + `ALTER TABLE procedures ADD COLUMN video_path_original TEXT`
- `src/main/db/migrations/0003_procedure_notes.sql` — Phase 5 references via JOIN for the right-rail Notes panel
- `src/main/db/migrations/0004_procedure_segments.sql` — Phase 5 queries for the pause-marker scrubber timeline

## Existing Code Insights

### Reusable Assets

- `src/shared/ipc-contract.ts:IpcContract` — Phase 5 extends the `procedures.*` namespace with `addScreenshot`, `deleteScreenshot`, `updateAnnotation`, `trim`, `restore`, plus `Screenshot` and `TrimRequest`/`TrimResult` entity types. Review screen reads via `procedures.get({ id })` (Phase 4 already wired).
- `src/shared/ipc-contract.ts:IPC` — Phase 5 grows with `SCREENSHOTS_ADD`, `SCREENSHOTS_DELETE`, `SCREENSHOTS_UPDATE_ANNOTATION`, `PROCEDURES_TRIM`, `PROCEDURES_RESTORE`.
- `src/main/paths.ts:procedureMediaDir(patientId, procedureId)` (Phase 4) — Phase 5 adds `screenshotsDir(patientId, procedureId)` returning the same dir + `/screenshots/`.
- `src/main/capture/canonicalize.ts:canonicalizeName()` / `canonicalizeOrThrow()` — Phase 5 doesn't use for screenshots, but the trim command pipes `video_path` through this if the user re-canonicalizes (deferred).
- `src/main/db/audit.ts:audit()` — Phase 5 reuses for all `screenshot.*` and `procedure.trimmed` / `procedure.restored` events.
- `src/main/auth/session.ts:session.currentUserId` — Phase 5 derives `userId` from `requireSession()` per Phase 2 BLOCKER 4.
- `src/preload/index.ts:api` — contextBridge surface; Phase 5 extends with `screenshots.*` + `procedures.trim` + `procedures.restore`.
- `src/renderer/src/store/route.ts:useRoute()` — `'procedure-review'; procedureId: string` already in Route union (Phase 4 D-05).
- `src/renderer/src/components/{RecordingControlsBar,RecIndicator,FramingGuide}.tsx` (Phase 4) — UI enhancement patterns (floating overlay, semi-transparent backdrop, lucide icons); Phase 5 reuses the visual language for the right-rail action panels.
- `src/renderer/src/components/ui/{button,card,scroll-area,alert,badge,dialog}.tsx` — Phase 5 uses for the trim controls, screenshot timeline cards, and delete-confirm dialog.
- `src/renderer/src/hooks/useCaptureDeviceMap.ts` + `useVideoPreview.ts` (Phase 3) — Phase 5 doesn't touch; review uses native `<video>` for the canonical mp4 playback.
- `src/renderer/src/pages/ProcedureRoom.tsx` (Phase 4) — Phase 5 adds a Screenshot button next to the Pause button + the `S` hotkey (same keydown handler as the Phase 4 Space/Esc/R).
- `src/renderer/src/pages/ProcedureReview.tsx` (Phase 4 placeholder) — Phase 5 replaces with the real review screen.
- `src/main/recorder/ffmpeg-args.ts:buildFfmpegArgs()` (Phase 4) — Phase 5 adds `buildTrimArgs()` for the trim one-shot.
- `src/main/recorder/concat.ts:writeConcatList()` (Phase 4) — Phase 5 references the concat pattern for the trim command's input (single file, but the args shape is identical to a 1-segment concat).
- `src/main/recorder/recorder.ts:onExit` (Phase 4) — Phase 5 mirrors the exit-handler pattern for the trim ffmpeg child (timeout + finalize).

### Established Patterns

- **Typed IPC contract via contextBridge** — every renderer-callable method is defined once in `src/shared/ipc-contract.ts`. Phase 5 extends, never invents.
- **One-way renderer → main for mutations, optimistic UI avoided** — renderer awaits IPC round-trip; screenshot writes + trim are awaited before navigation.
- **Audit-on-every-mutation** — `recordAudit({ action: 'screenshot.captured' | 'screenshot.deleted' | 'procedure.trimmed' | 'procedure.restored', entityType: 'procedure' | 'screenshot', entityId, metadata: { ... } })`.
- **No `any` in IPC contracts** — TS strict mode continues.
- **Single ffmpeg child per operation** — trim creates a fresh ffmpeg child per Apply (no reuse; matches Phase 4 D-01 + concat pattern).
- **UserData-relative paths** — `screenshots.file_path` stored as `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` minus the userData prefix (Anti-Pattern 2).
- **Inline status, no modal** — UX-Pitfalls table; trim Apply shows an inline progress indicator, not a blocking modal.
- **No MediaRecorder** — Phase 3 D-08 locks; Phase 5 uses canvas snapshots from `<video>`, never MediaRecorder.

### Integration Points

- `src/main/index.ts` — wires `registerProceduresIpc()` (Phase 4) + extends with trim/restore/screenshot IPC handlers. No new main-process init; everything hooks into existing `proceduresRepo` + new `screenshotsRepo`.
- `src/preload/index.ts` — `api` object grows with `screenshots.*` + `procedures.trim` + `procedures.restore`.
- `src/main/db/migrations.ts` — adds `0005_screenshots_and_trim.sql` migration (or split into `0005_screenshots.sql` + `0006_trim.sql`).
- `src/main/db/procedures-repo.ts` — adds `video_path_original` column + `trim(id, newVideoPath)` + `restore(id)` methods.
- `src/main/db/screenshots-repo.ts` (new) — `add`, `delete`, `listByProcedure`, `updateAnnotation`. Reuses the established repo pattern from Phase 2.
- `src/main/recorder/trim.ts` (new) — `applyTrim({ procedureId, inMs, outMs }): Promise<{ trimmedVideoPath: string }>`. Spawns a one-shot ffmpeg child with `buildTrimArgs()`, awaits exit code 0, copies output to the canonical `<basename>-trimmed.mp4`, updates `procedures.video_path` + `video_path_original` on first trim.
- `src/main/recorder/ffmpeg-args.ts` — adds `buildTrimArgs({ inputPath, inMs, outMs, outputPath })`.
- `src/shared/ipc-contract.ts` — extend `IPC` constants + `IpcContract` interface + `Screenshot` entity type.
- `src/renderer/src/App.tsx` — `'procedure-review'` route already wired (Phase 4); Phase 5 changes the component implementation only.
- `src/renderer/src/pages/ProcedureRoom.tsx` — add Screenshot button (next to Pause) + `S` hotkey in the existing keydown handler.
- `src/renderer/src/pages/ProcedureReview.tsx` — replace the Phase 4 placeholder with the real review screen (video left, tools right per D-10).
- `src/renderer/src/components/Scrubber.tsx` (new) — scrubber + pause markers + trim handles + screenshot clickable timeline. Single component, multiple modes (idle / trim).
- `src/renderer/src/components/ScreenshotTimeline.tsx` (new, optional) — separated from Scrubber if the timeline grows complex.

## Specific Ideas

- **Drag handles on scrubber + cut region highlighted in red** — the recommended trim UX. Doctor drags, sees cut region shaded red, plays inline to preview, clicks Apply. Same scrubber they already use for seek.
- **Pause markers visible on scrubber** — Phase 4 D-11 segments queried for `(started_at, ended_at)`. Subtle gray ticks with tooltips ("Pause 1: 02:34–04:12"). Informational, don't gate seek or trim.
- **Hotkey `S` for mid-procedure screenshot** — matches Phase 4's `Space`/`Esc`/`R` pattern. Suppressed when typing in the notes textarea.
- **Trim accuracy ±500ms** — accepted per `research/PITFALLS.md §Pitfall 1`; doctor can fine-tune with the trim handles.
- **Restore from `video_path_original`** — single-click Restore in the right rail. Restores the original recording (segments, timer, notes, screenshots stay). `video_path_original` is populated on first trim and never overwritten.
- **Layout matches Phase 4 ProcedureRoom** — video left, tools right. Same visual language (slate-100 background, max-w-7xl container, lucide-react icons, shadcn primitives).
- **`video_path_original` semantics** — populated once on first trim; never overwritten. `procedures.video_path` updates to the latest trimmed file.
- **Pause markers from D-11** — the `procedure_segments` table is the source for scrubber tick marks (segment boundaries = pause boundaries). Default case (no pauses) = no tick marks.

## Deferred Ideas

- **Trim undo history** — D-09 is a single Restore button to the original. A full undo history (every trim snapshot) is out of scope for Phase 5; can ship in v1.1 if needed.
- **Audio playback in review** — Phase 3 D-08 locks recording as `audio:false`; review plays silent video. Adding audio playback in review would require recording audio first, which Phase 5 doesn't ship.
- **Screenshot annotations UX** — the `annotation` column is nullable and the schema supports inline-edit, modal-edit, or panel-edit. The agent picks the simplest that doesn't crowd the timeline (per "agent's Discretion" in D-05).
- **Bulk screenshot selection for PDF report** — Phase 6 owns the report editor + PDF; Phase 5 ships the screenshot list + a per-screenshot delete button. Bulk selection (Phase 6 PDF attach-list) ships then.
- **Screenshot from review at exact timestamp vs nearest keyframe** — both flows work via `videoRef.current.currentTime` + canvas snapshot. Edge case: video element reports `currentTime` in seconds, schema stores milliseconds. Convert with `Math.floor(currentTime * 1000)`.
- **Trim across pause boundaries** — the canonical mp4 has pauses flattened via Phase 4 concat. Trim handles operate on the canonical timeline (post-concat). The pause markers on the scrubber are still visible to the doctor but don't affect trim handles.
- **Trim with re-encode (exact cuts)** — Phase 5 ships `-ss before -i -c copy` (fast, ±500ms). Exact-cut re-encode is a future Phase.
- **Per-procedure screenshots export** — out of v1 scope; can ship as a "Generate ZIP" button in v1.1.

---

*Phase: 5-screenshots-procedure-review-trim*
*Context gathered: 2026-08-06*