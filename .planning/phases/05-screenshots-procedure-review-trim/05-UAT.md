# Phase 5 — Windows Hardware Smoke (Plan 04 acceptance)

> Manual verification checklist for the Phase 5 end-to-end flow on a real Windows workstation.
>
> Status: **pending** — this checklist must be run by the doctor on a real webcam + Windows machine before `phase_status: complete` is final.
>
> The plan's task 2 acceptance criteria explicitly require this hardware smoke as the integration sign-off; the automated test suite (484 tests, all passing) covers the deterministic unit/integration layer, but the live USB-capture-hardware → localhost-HTTP-bridge → `<video>`-element seek-via-Range path only verifies under real device I/O.

## Pre-flight

1. Plug a real USB capture device into the workstation (EasyCap / HDMI capture card / webcam — anything that the Phase 3 `enumerateDshowDevices` enumerates).
2. `npm install` (if not already) and `npm run dev`. The Electron app opens with a login screen.
3. Wizard-bootstrap the first admin if the DB is fresh; otherwise sign in.
4. Navigate to Settings → Capture. Confirm the new device is in the device picker. Save it as the default device.

## Six-Step Procedure

### Step 1 — Record a 30-second procedure

- Open any patient detail page, click **New procedure** (or **Open Procedure Room** if the row already has a procedure in flight).
- On the Procedure Room screen, click **Record**.
- The MJPEG live preview should appear within ~1s (the new `recording.start` IPC returns the `previewUrl`).
- Wait 30 seconds. The timer ticks `00:00:01` → `00:00:30`.
- Click **Stop**. The screen navigates to **Procedure Review** within ~2s.

  > **Expected:** No error toast. The post-stop transition is `<-` Back to Patient or the Review screen renders directly. The review screen renders the recorded mp4 in the `<video>` pane on the left.

### Step 2 — Capture 2 screenshots from playback

- The `<video>` element is paused initially (autoplay never enabled by default — Plan 04 hardening). Click the `Play` button.
- While the video is playing, click the **`+ Capture`** button at the end of the screenshot timeline twice:
  - Once at ~10 s into the playback.
  - Once at ~20 s into the playback.
- Confirm both thumbnails appear in the screenshot timeline row.

  > **Expected:** Two `<img>` thumbnails render below the scrubber. Each carries a hover tooltip with the `HH:MM:SS.mmm` capture timestamp. A `+ Capture` button is the last child of the timeline row.

### Step 3 — Click a thumbnail to seek

- Click the first thumbnail (at ~10 s).
- The `<video>` element seeks to ~10 s — the progress fill jumps to ~33 % of the track width, the `playhead timestamp label` updates, and the visual frame freezes on the captured screenshot frame.

  > **Expected:** Click-to-seek is one-way; the video is NOT restarted automatically. To resume playback the doctor clicks the `<video>`'s native `Play` button.

### Step 4 — Trim 5 s – 25 s

- Click the **`Trim`** button (scissors icon) in the right rail to toggle Trim mode ON. Two handles + a red-shaded cut region appear on the scrubber.
- Drag the in-handle to the 5 s position. Drag the out-handle to the 25 s position.
- The in/out labels in the right rail update: `In: 00:00:05 · Out: 00:00:25`. The cut region is shaded red between the two handles.
- Click **Apply**.

  > **Expected:** A spinner replaces the Apply button for ~1–5 s while ffmpeg runs (the 30-minute cap is not a factor here). On completion, the toast `Trim applied` (or equivalent) appears. The `<video>` element reloads to the trimmed clip (Reload-via-`videoRef.load()` from Plan 04's effect). The trimmed clip plays ~20 s long. The procedure's `videoPath` now points to the trimmed sibling file; `videoPathOriginal` is preserved (only populated on the first trim — Plan 03's `COALESCE` first-write-only guard).

### Step 5 — Verify the trimmed mp4 plays

- The right rail shows `Restore original` enabled (because `videoPathOriginal` is populated).
- Click Play on the `<video>` element.
- The video plays the trimmed 20-second segment (from 5 s to 25 s of the original recording — the cuts match the handles within ±500 ms per the `-ss before -i -c copy` stream-copy tradeoff).

  > **Expected:** No "mp4 won't play" error in the toast. The doctor sees the trimmed clip end before the original would have ended.

### Step 6 — Restore and verify the original

- Click **Restore original**. A spinner replaces the Restore button for a moment.
- The `<video>` element reloads to the original (untrimmed) recording at the procedure row's `videoPathOriginal` path.
- Click Play. The video plays the full 30-second original.

  > **Expected:** No errors. The `proceduresRepo.restoreFromOriginal` was idempotent — calling it again is a no-op. The `videoPathOriginal` column is preserved against future trims.

## Failure Recovery

If a step fails, consult:

| Symptom | Where to look |
|---------|---------------|
| `<video>` doesn't load the mp4 | `<userData>/logs/electron.log` — check for `/media/` route errors and the Range request log line. The new Plan 04 hardening logs every Range header the server receives. |
| Trim fails (IPC_VALIDATION) | Audit log `procedure.trimmed` rows (if the audit row is present, the IPC succeeded but `ffmpeg` returned non-zero — see next row). If absent, the IPC rejected input — re-check `inMs < outMs`, `status === 'completed'`, `durationMs <= 30 * 60 * 1000`. |
| Trim runs but the trimmed mp4 is corrupt | `<userData>/logs/electron.log` — the trim subprocess stderr is captured in the IPC error (`code=...signal=...: <last 3 stderr lines>`). The 5-minute SIGTERM timeout is the canonical PITFALLS §1 safety net. |
| Screenshots don't appear | Verify the migration `_migrations` table has row id=3 (`SELECT * FROM _migrations` in the SqliteBrowser dev tools or via `sqlite3 <userData>/data/colonoscopist.db "SELECT * FROM _migrations;"`). Migration 0003 is the SCRN-02 contract. |
| Media server returns 4xx instead of bytes | Check the local firewall / proxy — the MediaServer binds to `127.0.0.1:<random>` only. External origins cannot reach it. |
| Device disconnects mid-recording | A `.partial.mp4` is preserved at the procedure row's `videoPath`. The Review screen shows the **Partial recording** Alert (Plan 04 task 2 — the `<DestructivePartialAlert>` extracted from ProcedureReview). Trim is disabled for partial recordings (D-13 gate). |

## Test Script

```bash
# Boot the app
npm run dev

# then follow the six steps above with a real webcam plugged in.
```

After all six steps pass, mark this file's status to **`complete`** and update `.planning/VERIFICATION.md` to set `phase_status: complete` for Phase 5.
