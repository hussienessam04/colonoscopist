# Phase 4: Recording - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-04
**Phase:** 4-recording-timer-device-lost
**Areas discussed:** Stop semantics, Mid-procedure notes model, Procedure timer source & pause behavior

---

## Stop semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Soft pause — note appended, keep recording | Stop sends 'q' to ffmpeg stdin (5s grace, then SIGTERM); procedure row finalized ended_at=duration=fixed, status='completed'. UI moves to 'review screen or close'. Matches CAPT-05/06 ('On Stop, ffmpeg receives SIGTERM'). | (initial — label/description conflicted) |
| Hard stop — finalize + delete partial | Stop sends SIGTERM (no graceful 'q'). Faster but risks moov atom corruption. Per Pitfall 1, trades patient safety for slightly faster UI roundtrip. | |
| Two-button: Stop vs. Finish & Discard | Stop is a primary action; doctor may also have 'Finish & discard' secondary. v2 feature. | |
| (clarification) Stop = finalize the procedure | Stop = end of procedure. Procedure row state: ended_at = now, duration = fixed, status = completed. Matches CAPT-05/06 ('On Stop, ffmpeg receives SIGTERM'). | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Inline warning + .partial.mp4 + doctor chooses | ffmpeg exits non-zero. UI shows inline banner over preview: 'Capture device disconnected — recording saved up to <last frame>'. mp4 renamed to .partial.mp4 and sidecar JSON written. Procedure row stays status='recording' — doctor chooses to Stop (=status='partial') or attempt to resume (v1.1). Per CAPT-09. | ✓ |
| Auto-finalize the row as 'partial' | ffmpeg dies → app immediately finalizes procedure row as status='partial'. No doctor choice. .partial.mp4 preserved per CAPT-09. | |
| Banner + automatic re-enumerate + auto-swap | App tries to keep recording: re-enumerate, find matching device name, swap ffmpeg target. .partial.mp4 rotated every 30s. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Finish IS the stop path during recording | During recording, Finish identical to Stop: 'q' to ffmpeg, finalize procedure status='completed', close the room. Per CAPT-05/06. | ✓ |
| Disable Finish while recording | While recording is active, Finish is disabled (greyed). Doctor must hit Stop first. | |
| Inline warning banner before Finish finalizes | Inline banner: 'Recording in progress — Finish will end it'. Stays inline (no modals). | |

| Option | Description | Selected |
|--------|-------------|----------|
| Inline audit row; doctor decides in audit | On launch, scan `<userData>/data/media/patients/*/*/video.mp4.partial` and append audit_log row 'recording.crash_partial' with procedure_id + last_known_timestamp (from sidecar). Doctor opens Audit (Phase 7) to resolve. | ✓ |
| Surface a banner on SettingsHub pointing to orphans | One-time banner on SettingsHub listing orphan partials. More proactive but adds new UI surface in Phase 4. | |
| Auto-finalize on next launch | On launch, automatically finalize procedure row as status='crashed' (or 'partial'). Doctor never sees a 'what happened' message. | |

**User's choice (Stop semantics):**
- Stop = finalize the procedure (status='completed')
- Device-lost = inline warning + .partial.mp4 + sidecar JSON, doctor chooses
- Finish = Stop path during recording
- Crash recovery = inline audit row, doctor decides in audit (Phase 7)

---

## Mid-procedure notes model

| Option | Description | Selected |
|--------|-------------|----------|
| Single rolling note field on procedures table | One column procedures.notes (TEXT, nullable). Doctor edits a single field that auto-saves. Each Save overwrites. Matches CAPT-08 'quick note' (singular). | |
| Append-only log table with timestamps | Separate procedure_notes table (id, procedure_id, body, created_at). Each Save creates a new row. Doctor sees chronological list when reviewing. | ✓ |
| One notes field + auto-timestamp markers | Both: single notes field PLUS auto-stamped markers appended each time Save fires. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit Save button per note | Note editor has a 'Save note' button. Empty input + click does nothing. Each Save = one new procedure_notes row. Predictable audit trail. | ✓ |
| Auto-save on blur (debounced) | Notes auto-save on blur or after 2s of input idle. Each change appends a new row. | |
| Auto-save but de-dup identical consecutive entries | Notes auto-save on blur + de-dup identical consecutive rows. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Side-rail panel, always visible, no input lock | Notes panel sits in a collapsible right rail. Edit + Save available the whole time the room is open, regardless of whether recording is active. Doctor can pre-write or post-write. | ✓ |
| Below preview, only active during recording | Notes input below preview, only enabled while recording is active. Disabled when not recording. | |
| Modal-with-input next to Record | Notes typed into a small inline box right next to Record button. Saves on Enter. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Full scrollable list, chronological order | All notes for this procedure listed chronologically in the side-rail, most recent on bottom (next to Save). Scrollable. No pagination in Phase 4. | ✓ |
| Most-recent 5, 'Show all' toggle | Side-rail shows only the most recent N (e.g., 5) notes with a 'Show all' toggle. | |
| Single textarea + Save; flatten view | Notes don't appear in the side-rail at all (just input + Save). Notes only visible in Phase 5 review or audit log. | |

**User's choice (Mid-procedure notes):**
- Append-only procedure_notes log table (id, procedure_id, body, created_at)
- Explicit Save button per note; empty Save = no-op
- Side-rail panel always visible (no input lock)
- Full chronological scrollable list

---

## Procedure timer source & pause behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Main owns wall-clock; renderer ticks from start event | Main records started_at (Date.now() at ffmpeg spawn). On finalize, main sets ended_at, duration_seconds. Renderer subscribes to recording:status event and ticks setInterval(1000). Authoritative values live in the DB row. | ✓ |
| Renderer owns timer; main only at finalize | Renderer owns clock entirely, captures started_at = Date.now() and pushes to main on finalize. Simpler IPC but lets renderer-side clock drift affect stored value. | |
| ffmpeg-reported duration only | ffmpeg reports duration to stderr (time=00:01:23.45). Main parses those lines and writes the latest. Most accurate but adds parsing complexity. | |

| Option | Description | Selected |
|--------|-------------|----------|
| No pause — one continuous span | Recording is one continuous span. No Pause/Resume button in Phase 4. Doctor stops + starts new procedure (or attaches a note saying 'operator break'). Matches CAPT-07. v1.1 TRIM-02 multi-segment territory. | |
| Pause/Resume button in side-rail | Recording can be paused and resumed. Timer pauses with it. Adds state machine complexity. | ✓ |
| Pause only on device-lost, no manual pause | No manual pause button, but on device-lost the timer auto-pauses. Manual pause still out of scope. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Segments + ffmpeg-concat at finalize | Pause click kills current ffmpeg child cleanly ('q' stdin), increments counter, on Resume spawns new ffmpeg writing to <basename>-seg<N>.mp4. Procedure finalization runs `ffmpeg -f concat -i list.txt -c copy final.mp4`. Output is one .mp4. Cost: Phase 4 owns a second ffmpeg invocation at finalize time. | ✓ |
| Pause = freeze timer + short ffmpeg pause | Pause click sends a 'pause' marker to ffmpeg via stdin and freezes timer. ffmpeg keeps mp4 open with frozen last frame. The mp4 contains a frozen interval the doctor can trim in Phase 5. | |
| No pause — multiproccedure | Keep ffmpeg running while paused; the timer pauses but mp4 keeps recording. Equivalent to 'no pause' visually for the mp4 file. | |

**User's choice (Procedure timer):**
- Main owns wall-clock (started_at + ended_at + duration_seconds on procedures row); renderer ticks for display
- Pause/Resume button in side-rail — Pause kills current ffmpeg + Resume starts new ffmpeg writing to <basename>-seg<N>.mp4; finalize runs `ffmpeg -f concat -safe 0 -i list.txt -c copy final.mp4`

---

## Post-finalize navigation (bonus question during notes area)

User free-formed a flow intent: "in the procedure room start recording the video can take multiple screenshots can add notes when he click finsh or stop recording we navigate him to type the pdf report".

| Option | Description | Selected |
|--------|-------------|----------|
| Navigate to Procedure Review placeholder (Phase 5 builds full UI) | Stop / Finish navigates to 'Procedure Review' placeholder screen (Phase 5 builds actual review UI; Phase 4 ships stub with procedure metadata + 'Report draft coming in Phase 6' notice). Aligns with user's described flow. | ✓ |
| Back to Patient Detail (matches Finish's 'previousRoute') | Stop / Finish navigates back to Patient Detail (matches Phase 3 'previousRoute' Finish behavior). | |
| Back to Patient List | Stop / Finish navigates to Patient List. | |

**User's choice:** Navigate to Procedure Review placeholder.

---

## the agent's Discretion

- Device-lost banner exact copy
- ffmpeg stderr error-pattern regex (acceptable substring match is the simpler)
- Segment file naming convention (`<basename>-seg<N>.mp4` vs `<basename>.seg<N>.mp4`)
- Empty side-rail copy
- Procedure Review placeholder layout details (status display confirmed; everything else flexible)
- Pause/Resume button labels
- Side-rail position relative to existing Recording controls
- Whether `recording:status` events coalesce or fire per state change (default: per state change)
- Audit metadata fields for `recording.*` events
- ffmpeg Concat list file path naming

## Deferred Ideas

- **Audio in recording** (Phase 3 D-08 locks preview as `audio:false`; Phase 4 inherits; future v1.1 could add doctor-side mic capture)
- **Resume recording to a partial procedure** (Phase 4 leaves `status='recording'` after device-lost for the doctor to wait; the real "Resume" capability is v1.1)
- **Procedure audio transcription** (out of v1 scope per REQUIREMENTS Out-of-Scope list — speech-to-text dictation deferred)
- **Trim during recording** (TRIM-02 multi-segment trim is v1.1; Phase 4's pause segments are the seed)
- **Camera-side overlay / picture-in-picture** (out of v1 scope; would need MediaRecorder / getDisplayMedia + composite)
- **Per-procedure audio device pairing** (endoscopes are silent; webcams have mics — Phase 3 D-08 locks no audio source; future Phase could add audio-source selection in Settings)
- **Procedure Review screen full implementation** (Phase 5 owns)
- **PDF report generation flow** (Phase 6 owns the report editor + PDF; Phase 4 only lands on the Phase 5 review placeholder; Phase 6 PDF editor sits one click downstream of the user's described flow)
