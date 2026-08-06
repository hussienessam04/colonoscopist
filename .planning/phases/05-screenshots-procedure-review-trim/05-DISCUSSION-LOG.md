# Phase 5: Screenshots + Procedure Review + Trim - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-06
**Phase:** 5-screenshots-procedure-review-trim
**Areas discussed:** Screenshot trigger, Trim UX model, Review screen layout

---

## Screenshot trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Both + hotkey | Screenshot button in ProcedureRoom (mid-recording) + in ProcedureReview (post-recording). Hotkey 'S' for mid-procedure (matches Phase 4's Space/Esc/R pattern). | ✓ |
| Review-only | Only in ProcedureReview. Doctor scrubs to find moments and clicks Capture. Simpler — no mid-procedure UI to manage. | |
| Mid-procedure only | Only mid-procedure (button + hotkey). Doctor must capture during recording. Misses moments the doctor didn't think to mark. | |

**User's choice:** Both + hotkey (Recommended)
**Notes:** Hotkey 'S' for mid-procedure, mirroring Phase 4's Space/Esc/R pattern. Both entry points cover "capture the moment" and "scrub back to find it later" workflows.

---

## Trim UX model

| Option | Description | Selected |
|--------|-------------|----------|
| Drag handles on scrubber | Trim handles (two draggable markers) on the scrubber in Trim mode. Cut region highlighted in red between them. Click Apply. Plays inline to preview. | ✓ |
| Modal with timecode inputs | Modal pops up with two HH:MM:SS inputs. Type boundaries, preview, apply. | |
| Separate Trim tab | Separate 'Trim' button toggles a different view (preview + dual range slider). | |

**User's choice:** Drag handles on scrubber (Recommended)
**Notes:** Same scrubber the doctor already uses for seek — no separate mode. Live preview of the trimmed range inline.

---

## Review screen layout

| Option | Description | Selected |
|--------|-------------|----------|
| Video left, tools right | Video pane (left, hero) + scrubber + screenshot timeline below. Right rail: Notes accordion + Trim action panel + procedure metadata + status badge. Mirrors Phase 4 ProcedureRoom layout. | ✓ |
| Vertical stack | Single column. Video, scrubber, timeline, notes, trim — stacked vertically. | |
| Tabs | Tabbed sections at the top: 'Review', 'Trim', 'Notes'. | |

**User's choice:** Video left, tools right (Recommended)
**Notes:** Visual consistency with ProcedureRoom. Same right-rail pattern (Notes + actions + metadata).

---

## Trim undo behavior

Not selected for discussion. Default per ROADMAP ("original never overwritten") and captured in CONTEXT.md as D-09: single Restore button from `video_path_original`, no full undo history.

---

## the agent's Discretion

- Screenshot annotation UX (inline / modal / panel) — agent picks the simplest that doesn't crowd the timeline
- Capture frame source implementation (canvas snapshot vs ffmpeg image2 muxer) — simpler wins
- Screenshot thumbnail size (~120×90 recommended)
- Screenshot deletion UX (confirm modal / Toast-with-undo / no-delete)
- Trim handle color and visual treatment
- Restore button placement
- Trim accuracy tradeoff (`-ss before -i` vs `-ss after -i`)
- Audit metadata field keys for screenshot/trim events
- Migration shape (one file vs split)

## Deferred Ideas

- Trim undo history (every trim snapshot) — v1.1 if needed
- Audio playback in review — out of v1 scope (no recording audio per Phase 3 D-08)
- Screenshot annotation UX — agent's call in this phase
- Bulk screenshot selection for PDF report — Phase 6
- Exact-cut trim re-encode — future Phase
- Per-procedure screenshots ZIP export — v1.1