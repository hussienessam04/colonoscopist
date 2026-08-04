# Phase 4: Recording - Context

**Gathered:** 2026-08-04
**Status:** Ready for planning

## Phase Boundary

Doctor presses Record in Procedure Room → `src/main/recorder/` spawns `ffmpeg-static` as a child process writing to `<userData>/data/media/patients/<id>/<procedureId>/video.mp4` → Stop produces a playable mp4 with a valid moov atom. Phase 4 ships the `procedures` table migration (Phase 2 only shipped `users`, `patients`, `audit_log`, `settings`), the `procedure_notes` migration, the recorder supervisor (one ffmpeg child per active procedure), the procedure timer (HH:MM:SS), Pause/Resume via seg+concat, the device-lost inline warning + `.partial.mp4` + sidecar JSON, and a Procedure Review placeholder screen that post-finalize navigation lands on (Phase 5 fills in the actual review UI).

## Implementation Decisions

### Stop semantics

- **D-01:** Stop click sends `q\n` on ffmpeg's stdin, waits 5s for graceful exit, escalates to SIGTERM/SIGKILL fallback; procedure row finalizes `status='completed'`, `ended_at = Date.now()`, `duration_seconds = floor((ended_at - started_at) / 1000)`. Audio/UI flow: Stop button is the only one that triggers finalize while recording — the same `q` + grace + SIGTERM pattern from the electron-ffmpeg skill SKILL §4. — **Reversibility:** **one-way** — `procedures.status='completed'` finalization is durable; downstream phases (Phase 5 review, Phase 6 PDF) treat completed procedures as immutable input. Changing the contract requires a migration.
- **D-02:** Finish is identical to Stop while a recording is active. Per Phase 3 D-07 Finish is "always visible" — during recording it is the stop path, not a navigation action. No two-button ambiguity; the renderer treats `finish()` as `stop()` then navigate once `closed` event arrives. When no recording is active, Finish keeps its Phase 3 navigation behavior. — **Reversibility:** **reversible** — UI state alias on the existing Finish handler.
- **D-03:** Device-lost = inline warning banner (NOT a modal — per UX-Pitfalls table): "Capture device disconnected — recording preserved up to <last frame>". The mp4 is renamed to `<basename>.partial.mp4`; a sidecar JSON `<basename>.partial.json` is written next to it with `{ procedureId, lastKnownTimestampMs, deviceLostAt, deviceName }`. Procedure row stays `status='recording'` while waiting for the doctor's choice — Stop finalizes as `status='partial'` (Stop click = finalize at the last known timestamp). Future "Resume to same procedure" is parked. — **Reversibility:** **costly** — the `.partial.mp4` + sidecar naming convention is referenced by Phase 5 review (the partial mp4 is what gets shown as a degraded result) and Phase 7 backup (the convention must be preserved on zip). Renaming later requires updating both.
- **D-04:** Crash recovery on next launch: main scans `<userData>/data/media/patients/*/*/video.mp4.partial` (and partial sidecar JSON files) and appends `audit_log` rows with `action='recording.crash_partial'`, `entityId=<orphan procedureId>`, `metadata={ lastKnownTimestampMs, deviceName, sidecarPath }`. Doctor discovers via Audit (Phase 7 audit UI) and resolves manually. The orphan file is left on disk — Phase 7 cleanup flow will own deletion. — **Reversibility:** **reversible** — launch-time scanner only; no schema impact; can be removed if a different UX ships.
- **D-05:** Post-finalize navigation lands on a Procedure Review placeholder screen — Route `'procedure-review'; procedureId: string`. The Phase 4 placeholder shows procedure metadata + a notice "Review + trim land in Phase 5"; for `status='partial'` it shows the partial banner too. The doctor can navigate back to Patient Detail or Patient List from there. Phase 5 replaces the placeholder with the real review screen; the route name is final. — **Reversibility:** **reversible** — router addition, no schema.

### Mid-procedure notes

- **D-06:** Notes persist as a separate `procedure_notes` table (append-only log): `id INTEGER PRIMARY KEY AUTOINCREMENT, procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK(length(body) > 0 AND length(body) <= 1000), created_at INTEGER NOT NULL`. Indexed on `(procedure_id, created_at DESC)`. The CAPT-08 singular "quick note" wording is enriched into a log because the user explicitly chose this model — the doctor benefits from a chronological record when reviewing later. Phase 6 PDF report reads these rows for the report body if relevant. — **Reversibility:** **one-way** — schema migration; refactoring the notes shape later means a second migration and either rewriting or merging rows.
- **D-07:** Notes save via explicit "Save note" button — `window.api.procedure_notes.create({ procedureId, body })`. Empty input + click does nothing (filtered at the form layer; no zero-length rows ever written). Each click = one new row + one `audit_log` row `action='procedure.note_added'`. No auto-save, no debounce, no de-dup — predictable audit trail. — **Reversibility:** **reversible** — interaction semantics only; no schema impact beyond the audit rows themselves.
- **D-08:** Notes side-rail sits in the Procedure Room layout, in the right-hand column alongside the existing device/preset/record section (currently `ProcedureRoom.tsx:137-188` left-of-preview in the desktop layout; Phase 4 adds a notes panel below it). The panel is always visible regardless of recording state — doctors can pre-write notes before pressing Record or post-write after Stop. The input is disabled (`disabled={!procedureId}`) only when no procedure row exists yet. — **Reversibility:** **reversible** — UI placement and disabled-state logic; no schema.
- **D-09:** The notes list renders full chronological order (oldest → newest OR newest → oldest, locked to **newest at bottom** so the most recent note sits next to the input — same affordance as chat apps). Scrollable vertically. No pagination in Phase 4 — doctors writing 30+ notes in one procedure is unusual, and the side-rail can scroll; Phase 5 review screen may add pagination if a procedure genuinely needs it. — **Reversibility:** **reversible** — display-only; query is `(procedure_id, created_at ASC)` either way.

### Procedure timer

- **D-10:** Canonical timer values live in main: `procedures.started_at INTEGER NOT NULL` (set on ffmpeg spawn success, not at click-time), `ended_at INTEGER` (set on ffmpeg close), `duration_seconds INTEGER` (computed at finalize). The renderer receives the same `started_at` via `recording:status` IPC event + ticks its own display via `setInterval(1000)` purely for UI — values are derived locally from the received timestamp, not authoritative. The DB row wins on review/audit/PDF. `recording:status` is the canonical event channel; events are `{ status: 'started'|'paused'|'resumed'|'stopped'|'lost', startedAt, currentSegmentIndex? }`. — **Reversibility:** **one-way** — schema migration; `started_at` is referenced by Phase 5 trim (in/out points relative to `started_at`) and Phase 6 PDF (procedure date header). Changing semantics means rewriting those calculations.
- **D-11:** Pause/Resume ships in Phase 4 as a side-rail button. Model: **segments + ffmpeg-concat at finalize**. Pause click sends `q\n` to ffmpeg's stdin, kills the segment cleanly, increments a `segments` table; on Resume, main spawns a new ffmpeg writing to `<basename>-seg<N>.mp4`. At finalize, main runs `ffmpeg -f concat -safe 0 -i <list>.txt -c copy <basename>.mp4` to stitch segments into the canonical mp4, then deletes the segment files and writes the canonical `video_path`. During pause, the timer freezes (renderer-side) — the procedure is technically still `status='recording'` until finalize. Schema: a `procedure_segments` table `(id, procedure_id, segment_index INTEGER, file_path TEXT, started_at INTEGER, ended_at INTEGER)` — keeps the segment timeline queryable for Phase 5 review's scrubber timeline (segment boundaries = pause points). Default case (never paused) = zero rows, single mp4. — **Reversibility:** **one-way** — pause mechanism baked into the supervisor state machine and `procedure_segments` table; the segments table is referenced by Phase 5 review to render pause markers on the timeline. Removing later means deleting the table and rewriting the finalize path.

### ffmpeg encoding defaults

- **D-12:** All presets (SD analog, HD digital, Custom) use `-c:v libx264 -preset veryfast -crf 23 -movflags +faststart` per REQUIREMENTS CAPT-05 verbatim. Bitrate and pixel-format are NOT exposed in Custom preset UI (Phase 3 D-05 left them as Phase-4 agent-discretion); they remain internal constants (`-pix_fmt yuv420p` for player compatibility, `-b:v` per-preset: SD=4M, HD=10M, Custom=5M as Phase 4 default). Resolution and framerate still come from the per-(doctor, device) preset matrix (Phase 3 D-04) via `-s` and `-r`. — **Reversibility:** **reversible** — preset value shape is unchanged; the constants live in `src/main/recorder/ffmpeg-args.ts`.

### the agent's Discretion

- Device-lost banner copy — substance locked (D-03); exact wording agent's call.
- Error message format on stderr-parse-able ffmpeg errors (e.g. "I/O error", "DeviceLost", "EOF on input") — substring matching is acceptable; refined regexes agent's call.
- Segment file naming inside `mediaDir` — recommended `<basename>-seg<N>.mp4` but agent can pick `<basename>.seg<N>.mp4`.
- Empty side-rail message ("No notes yet") copy and styling.
- Procedure Review placeholder layout — must show procedure metadata + status; everything else is agent's call.
- Pause-button label exact text ("Pause" / "Hold" / "Break") and Resume counterpart.
- Side-rail position relative to existing Recording controls — D-08 says "below the record controls"; agent confirms.
- Whether `recording:status` events coalesce (rate-limited) or fire on every state change. Default: each state change, no coalescing.
- Audit metadata fields for `recording.started` / `recording.stopped` / `recording.paused` / `recording.resumed` / `recording.lost` / `recording.crash_partial` — agent picks keys; minimum is `{ deviceName, preset }` + relevant timestamps.
- ffmpeg Concat list file path — keep inside `mediaDir` for cleanup; agent picks name pattern.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements

- `.planning/ROADMAP.md` §Phase 4 — Goal, success criteria, pitfalls addressed, notes
- `.planning/REQUIREMENTS.md` §CAPT-04, §CAPT-05, §CAPT-06, §CAPT-07, §CAPT-08, §CAPT-09 (Traceability row)
- `.planning/PROJECT.md` §Key Decisions (ffmpeg-static vs MediaRecorder, generic DirectShow), §Constraints (Electron sandbox, no MediaRecorder for recording)
- `.planning/STATE.md` §Current Focus (Phase 4 next milestone), §Phase 3 decisions (carry-forward)

### Technical research (stack, pitfalls, architecture)

- `.planning/research/STACK.md` — Electron 32 + sandbox + contextIsolation (locked), ffmpeg-static v5 used as child process
- `.planning/research/PITFALLS.md` §Pitfall 1 (corrupt mp4 at end of long procedure — addressed by D-11 segment + concat + fsync-on-finalize), §Pitfall 2 (device-lost mid-recording — addressed by D-03 inline banner + partial preservation), §Pitfall 3 (device enumeration race — Phase 3 already sequences preview; Phase 4 takes the dshow device first via ffmpeg, then renderer opens getUserMedia via the same canonical name), §Pitfall 10 (USB path quoting — already handled by Phase 3 D-11 canonicalization, Phase 4 uses the canonical form in ffmpeg `-i video=...`), §Performance Traps (per-page React re-render at 10+ Hz — D-09 chrono list keeps re-renders local to the side-rail)
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities (recorder in `src/main/recorder/`), §Pattern 3 (ffmpeg child process with structured supervision — supervisor model with stdin 'q' + SIGTERM fallback), §Anti-Pattern 5 (no ffmpeg reuse across procedures — one child per procedure, matches Phase 4 D-01), §Anti-Pattern 2 (paths relative to userData — Phase 4 stores `media/patients/<id>/<procedureId>/video.mp4` relative form), §Data Flow §3 (Stop procedure flow — main updates procedure row with `ended_at`, `duration_seconds`, final `video_path`)
- `.planning/research/SUMMARY.md` §Phase 4 implications (one ffmpeg per procedure, no MediaRecorder fallback for long recordings)

### Phase 1, 2, 3 context (carry forward)

- `.planning/phases/01-scaffold/01-CONTEXT.md` — D-01..D-08 (app identity, security baseline, IPC contract pattern)
- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — D-01..D-08 (migrations runner, audit helper, settings table, soft-delete, IPC contract pattern)
- `.planning/phases/03-capture-enumeration-live-preview/03-CONTEXT.md` — D-01..D-11 (device picker UX, per-(doctor, device) preset matrix D-04, preview lifecycle D-07/D-08, Settings → Capture page D-09, device enumeration cadence D-10, canonical device-name D-11), Phase 3 decisions (Q-A matched-pattern metadata on first auto-detect, Q-B Finish previousRoute)

### Skills & procedures (how to ship Phase 4)

- `.opencode/skills/electron-ffmpeg/SKILL.md` §1 (two-path architecture — Phase 4 owns the recording half; preview already shipped in Phase 3), §2 (ffmpeg-static install + asarUnpack pattern — Phase 4 also rewrites `app.asar` → `app.asar.unpacked` in `defaultFfmpegPath()`), §4 (start a recording — Phase 4 uses this pattern, extended with segment files for pause), §5 (IPC wiring — `'capture:start'`, `'capture:stop'`, `'capture:status'` events forward via `webContents.send`), §7 (screenshot from preview — Phase 5 uses, defer screenshot IPC), §8 (device-lost handling — Phase 4 inherits the substring matching for ffmpeg stderr), §9 (quality presets — Phase 4 maps preset → ffmpeg args)
- `.opencode/skills/electron-vite/SKILL.md` — Three-process model; `asarUnpack` for ffmpeg-static binary
- `.opencode/skills/electron-sqlite/SKILL.md` — Migration runner; Phase 4 adds `procedures` + `procedure_notes` + `procedure_segments` migrations

### Audit log integration (Phase 2 already wired)

- `src/main/db/audit.ts:audit()` — Phase 4 reuses for all `recording.*` and `procedure.*` events with structured metadata

### Schema baseline (Phase 2)

- `src/main/db/migrations/0001_init.sql` — Phase 4 extends with `procedures`, `procedure_notes`, `procedure_segments` migrations (one combined or three sequential — agent's call)

## Existing Code Insights

### Reusable Assets

- `src/shared/ipc-contract.ts:IpcContract` — Phase 4 extends the `api` object with `procedures.*` and `recording.*` namespaces + adds `Procedure`, `RecordingStatus`, `ProcedureNote` types to the entities surface.
- `src/shared/ipc-contract.ts:IPC` — Phase 4 grows with `RECORDING_START`, `RECORDING_STOP`, `RECORDING_PAUSE`, `RECORDING_RESUME`, `PROCEDURES_CREATE`, `PROCEDURES_GET`, `PROCEDURES_LIST`, `PROCEDURES_FINALIZE`, `PROCEDURE_NOTES_LIST`, `PROCEDURE_NOTES_CREATE`.
- `src/main/paths.ts:dataDir()` + `mediaDir()` — already wraps userData; Phase 4 adds `procedureMediaDir(patientId, procedureId)` returning `<userData>/data/media/patients/<patientId>/<procedureId>`.
- `src/main/capture/devices.ts:enumerateDshowDevices()` — Phase 4 reuses for pre-record device enumeration (already canonicalizes via D-11).
- `src/main/capture/preset-repo.ts:presetRepo.getPreset()` — Phase 4 calls this at Record time to derive ffmpeg args (D-04 from Phase 3).
- `src/main/capture/canonicalize.ts:canonicalizeName()` / `canonicalizeOrThrow()` — Phase 4 pipes the canonical device name into ffmpeg `-i video=...`.
- `src/main/db/audit.ts:recordAudit()` — Phase 4 reuses for every recording.* and procedure.* event (D-01, D-04, D-07).
- `src/main/auth/session.ts:session.currentUserId` — Phase 4 derives `userId` from `requireSession()` per Phase 2 BLOCKER 4 (renderer cannot spoof).
- `src/preload/index.ts:api` — contextBridge exposure point; Phase 4 extends with `procedures` + `recording` namespaces + `recording.onStatus(cb)` for the push-status events.
- `src/renderer/src/store/route.ts:useRoute()` — Phase 4 adds `'procedure-review'; procedureId: string` to the `Route` union.
- `src/renderer/src/lib/router.ts:Route` — same union extension.
- `src/renderer/src/components/ui/{button,input,textarea,card,scroll-area,alert,badge}.tsx` — Phase 4 reuses for the notes panel + procedure-review placeholder; check shadcn registry for `textarea` + `scroll-area` + `alert` (if not present, the agent adds them).
- `src/renderer/src/hooks/useCaptureDeviceMap.ts` + `useVideoPreview.ts` — Phase 4 leaves untouched; recording layer sits on top.
- `src/renderer/src/pages/ProcedureRoom.tsx` — Phase 4 extends this page (side-rail + Pause/Resume + Record button enabled), does not rewrite.

### Established Patterns

- **Typed IPC contract via contextBridge** — every renderer-callable method is defined once in `src/shared/ipc-contract.ts`. Phase 4 extends, never invents.
- **One-way renderer → main for mutations, optimistic UI avoided** — renderer awaits IPC round-trip; recording status state lives in main.
- **Audit-on-every-mutation** — `recordAudit({ action: 'recording.started' | 'recording.stopped' | 'procedure.note_added' | ..., entityType: 'procedure', entityId, metadata: { ... } })` for every recording event.
- **No `any` in IPC contracts** — TS strict mode continues; per-method arg + return types on `IpcContract`.
- **Single child process per procedure** — Phase 4 owns at most one ffmpeg child per `procedureId`; the supervisor state machine lives in `src/main/recorder/`.
- **Settings/canonical-name thread-through** — Phase 3 canonicalizes on enumeration; Phase 4 never re-canonicalizes (the deviceId received in IPC is already canonical).
- **Inline status banner, no modal** — UX-Pitfalls table; device-lost banner is inline (D-03).

### Integration Points

- `src/main/index.ts` — Phase 4 wires `initRecorder()` (procedures-aware supervisor + event broker) → `registerProceduresIpc()` + `registerRecordingIpc()` after `registerCaptureIpc()` so device enumeration is ready when Record is clicked. Add `recording.scanForOrphans()` to the startup path so the crash-recovery audit fires before any procedure is opened.
- `src/preload/index.ts` — `api` object grows with `procedures` + `recording`.
- `src/main/window.ts` — no changes; security baseline already covers Phase 4's IPC.
- `src/main/db/migrations.ts` — Phase 4 adds migrations `0002_procedures.sql` (+ `0003_procedure_notes.sql` + `0004_procedure_segments.sql` if the agent prefers one migration per table).
- `src/shared/ipc-contract.ts` — extend `IPC` constants + `IpcContract` interface + entity types.
- `src/renderer/src/App.tsx` — add `'procedure-review'` route case, gated on `status.authenticated` and `route.procedureId`.
- `src/renderer/src/lib/router.ts` — `Route` union grows with `'procedure-review'; procedureId: string`.
- `src/renderer/src/pages/ProcedureRoom.tsx` — extend with notes panel, Pause/Resume + Record enabled, post-finalize navigation to procedure-review.
- `src/renderer/src/pages/ProcedureReview.tsx` (new) — Phase 4 placeholder; Phase 5 replaces.

## Specific Ideas

- **`<basename>.partial.mp4` + `<basename>.partial.json` sidecar convention** — keeps partial recovery discoverable in Phase 7 audit/backup by suffix-only matching; renameable in bulk with `fast-glob` glob.
- **Pause = seg + concat model = checkable end-of-procedure invariant:** after finalize, exactly one `video.mp4` (segments removed) OR a `video.mp4.partial` (with sidecar). Phase 7 backup/zips can assert this.
- **Procedure Notes free-text message length capped 1000 chars** — blocks silly input, matches the bounded-input pattern from Phase 2 patient notes.
- **Procedure Segments table is queried by Phase 5 review** for pause-marker timeline rendering — design that schema with Phase 5 use case in mind (segment_index = chronological order; started_at/ended_at for the segment, not the procedure).
- **`<video>.partial.mp4` is just the file rename** — Phase 4 doesn't re-encode or copy; only Sidecar JSON is written alongside. Phase 5 review will play the partial mp4 from the same path.
- **Stop click event flow for the renderer:** main sends `recording:status` `stopped` + `procedureId` → renderer awaits → navigates to `'procedure-review'; procedureId`. No optimistic navigation.
- **The user's described flow** — record → screenshots + notes → Finish/Stop → navigate to PDF report editor — spans Phase 4 (record + notes), Phase 5 (screenshots + review + trim), and Phase 6 (PDF report editor). Phase 4 only owns the procedure-finalize → procedure-review-placeholder navigation leg; Phases 5 and 6 will chain the rest of the flow.

## Deferred Ideas

- **Audio in recording** — Phase 3 D-08 locks preview as `audio:false`. Phase 4 inherits that for recording. A future Phase v1.1 could add a doctor-side mic capture (separate dshow audio device enumeration); out of Phase 4 scope and not in the v1 roadmap.
- **Resume recording to a partial procedure** — D-03 keeps `status='recording'` after device-lost for the doctor to wait; a real "Resume" capability is v1.1 territory (would need device re-enumeration + new ffmpeg child + segment continuation). Worth capturing the partial sidecar schema with room for this.
- **Procedure audio transcription** — out of v1 scope per REQUIREMENTS Out-of-Scope list (speech-to-text dictation deferred).
- **Trim during recording** — TRIM-02 (multi-segment trim + retroactive trimming from arbitrary points). Phase 5 ships the post-recording trim; Phase 4's pause segments are the seed for TRIM-02 in v1.1.
- **Camera-side overlay / picture-in-picture** — doctor wants to see themselves while recording (for vlog-style procedures) or wants the endoscope feed's PIP overlay. Out of v1 scope; would need MediaRecorder / getDisplayMedia + composite.
- **Per-procedure audio device pairing (separate audio dshow arg)** — endoscopes are silent, but webcams have mics. Phase 3 D-08 locks no audio source. Phase 4 does not expose `audio=<name>` to ffmpeg. A future Phase could add audio-source selection in Settings → Capture.
- **Procedure Review screen full implementation** — Phase 5 owns the full review UI; Phase 4 ships only the placeholder + status display.
- **PDF report generation flow** — Phase 6 owns the report editor + PDF; Phase 4 only navigates to a placeholder. The user's described "navigate to PDF report after Stop" lands on the Phase 5 review screen in Phase 4; Phase 6 PDF editor sits one click downstream.

---

*Phase: 4-recording-timer-device-lost*
*Context gathered: 2026-08-04*
