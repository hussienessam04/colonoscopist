# Phase 5: Screenshots + Procedure Review + Trim - Research

**Researched:** 2026-08-06
**Domain:** Electron desktop — ffmpeg trim subprocess, canvas-based screenshot capture, scrubber UI, schema migration
**Confidence:** HIGH (decisions locked in CONTEXT.md; canvas/ffmpeg/sqlite patterns verified against docs)

## Summary

Phase 5 ships three production layers on top of the Phase 4 recording foundation: (1) a `screenshots` table + JPEG pipeline (renderer canvas snapshot → IPC → main writes userData-relative file + DB row + audit), (2) a real Procedure Review screen replacing the Phase 4 placeholder (native `<video>` + scrubber with pause-marker ticks + screenshot timeline + drag-to-seek + delete with undo), and (3) a non-destructive trim flow (YouTube-style handles on the scrubber → `ffmpeg -ss in -i <orig> -t dur -c copy <trimmed>.mp4` → `procedures.video_path` updates; `video_path_original` set once on first trim; restore re-points to the original). Decisions are locked in `05-CONTEXT.md` D-01..D-13; no new npm deps; only `screenshots` table + `ALTER TABLE procedures ADD COLUMN video_path_original TEXT` migration.

**Primary recommendation:** Add the migration as a single `0003_screenshots_and_trim.sql` (one file, two DDL statements). Use the existing `PreviewServer` pattern to also serve the recorded mp4 to the review `<video>` (custom localhost HTTP, NOT `file://` — contextIsolation blocks that). Build the trim subprocess as a pure `buildTrimArgs()` + spawn wrapper mirroring `buildFfmpegArgs` / `buildConcatArgs`. Capture screenshots via `canvas.drawImage(<img>)` from the live preview `<img>` (D-03's simpler path — no per-screenshot ffmpeg image2 invocation).

## User Constraints (from 05-CONTEXT.md)

### Locked Decisions
- **D-01** Two screenshot entry points: mid-procedure (button + `S` hotkey in ProcedureRoom, while recording active) AND post-recording (button in ProcedureReview, captures current playback position).
- **D-02** Mid-procedure screenshot hotkey = `S`; suppressed when typing in textarea (`isTypingTarget` guard from Phase 4).
- **D-03** Frame source: mid-procedure = live `<img>` MJPEG from ffmpeg tee (canvas.drawImage works); post-recording = `<video>` element via canvas snapshot (`drawImage(videoRef.current, 0, 0, w, h)` → `canvas.toDataURL('image/jpeg', 0.85)`). Simpler implementation wins — agent chooses between (a) canvas snapshot or (b) ffmpeg image2 muxer write; pick (a).
- **D-04** JPEG quality = 0.85; max dimension = 1280 (long edge). Files persist at `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<timestampMs>.jpg`; DB stores `file_path` as userData-relative form.
- **D-05** `screenshots` schema: `id INTEGER PRIMARY KEY AUTOINCREMENT, procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE, timestamp_in_video INTEGER NOT NULL CHECK(timestamp_in_video >= 0), file_path TEXT NOT NULL, annotation TEXT, created_at INTEGER NOT NULL`. Indexed on `(procedure_id, timestamp_in_video ASC)`. **`timestamp_in_video` in milliseconds** since procedure start (matches `procedures.started_at` reference frame). `annotation` nullable per ROADMAP.
- **D-06** Trim UX: two draggable handles on the scrubber (YouTube-style). Trim mode toggle in right rail; cut region highlighted red; `<video>` clips to in/out; click Apply.
- **D-07** Trim non-destructive: `ffmpeg -ss <in_ms>/1000 -i <original.mp4> -t <(out_ms - in_ms)/1000> -c copy <trimmed>.mp4`. `procedures.video_path` updates to trimmed; `procedures.video_path_original` populated on first trim and never overwritten. Original mp4 never deleted.
- **D-08** Trim accuracy: `-ss` BEFORE `-i` (fast keyframe-aligned, ±500ms accepted per PITFALLS §1). Future Phase could add exact-cut via re-encode; out of Phase 5 scope.
- **D-09** Re-trim / restore: re-trim current `video_path` (handles move, new trimmed file, original preserved); OR restore from `video_path_original` (single-click; idempotent).
- **D-10** Review screen layout: video pane left + tools right (mirrors ProcedureRoom). Left: `<video>` + scrubber + screenshot timeline + pause markers. Right: Notes accordion + Trim action panel + procedure metadata.
- **D-11** Pause markers on scrubber: `procedure_segments` (Phase 4 D-11) queried for `(started_at, ended_at)`; vertical tick marks; tooltip "Pause 1: 02:34–04:12" on hover. Informational only — don't gate seek or trim.
- **D-12** Screenshot timeline: rows below scrubber; ~120×90px thumbnails; ordered by `timestamp_in_video ASC`; click seeks `<video>`; "+ Capture" button at end; hover shows timestamp + × delete (with Toast undo per shadcn pattern).
- **D-13** Partial procedures (`.partial.mp4`): review plays the partial from `video_path` (which already points to partial path per Phase 4 D-03); Destructive Alert stays at top; scrubber/timeline work normally; **trim is disabled on partial recordings**.

### the agent's Discretion
- Screenshot annotation UX — agent's call (inline `<input>` on thumbnail, modal "Edit annotation", or dedicated panel). Schema supports all three.
- Capture frame source implementation — agent picks (a) canvas snapshot from live `<img>` MJPEG or (b) one-shot ffmpeg `image2` muxer write. Simpler wins.
- Screenshot thumbnail size — `~120×90` is recommended; agent adjusts to taste.
- Screenshot deletion UX — confirm modal, Toast-with-undo, or no-delete (just hide). Schema has no `deleted_at`; hard `DELETE FROM screenshots WHERE id = ?`.
- Trim handle color and visual treatment — must indicate "drag me" + "cut region between me and the other handle". Red highlighted region is the default.
- Restore button placement — right rail next to Trim Apply, or in procedure metadata section.
- Audit metadata fields for `screenshot.captured` / `screenshot.deleted` / `procedure.trimmed` / `procedure.restored` — agent picks keys; minimum is `{ screenshotId, timestamp_in_video }` for screenshots + `{ in_ms, out_ms, original_video_path, trimmed_video_path }` for trim.
- Migration shape: `0003_screenshots_and_trim.sql` (one file with screenshots table + ALTER procedures) recommended; agent can split into `0003_screenshots.sql` + `0004_trim.sql`.

### Deferred Ideas (OUT OF SCOPE)
- **Trim undo history** — D-09 is single Restore to original; full undo history is v1.1 territory.
- **Audio playback in review** — Phase 3 D-08 locks `audio:false`; review plays silent video.
- **Bulk screenshot selection for PDF report** — Phase 6 owns PDF + bulk selection; Phase 5 ships per-screenshot delete.
- **Trim with re-encode (exact cuts)** — Phase 5 ships `-ss before -i -c copy` (fast, ±500ms); exact-cut re-encode is future Phase.
- **Per-procedure screenshots export** — out of v1 scope (zip export is v1.1).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SCRN-01** | Doctor can take a screenshot during a procedure; screenshot rendered from current `<video>` preview frame to JPEG. | Section 1 (D-03 canvas snapshot); Section 3 (PreviewServer → live `<img>`); Section 5 (canvas.toBlob pattern, MDN verified). |
| **SCRN-02** | Screenshots persisted under `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<timestamp>.jpg` and indexed in `screenshots` table. | Section 2 (D-04 + D-05 path + schema); Section 4 (Anti-Pattern 2 userData-relative storage); Section 7 (Repo pattern). |
| **REV-01** | Doctor can open a finished procedure and see the recorded video with a scrubber and play/pause controls. | Section 1 (D-10 layout); Section 3 (D-12 scrubber + screenshot timeline); Section 6 (localhost HTTP serves mp4 to `<video>`); Section 8 (scrubber pattern). |
| **REV-02** | Review screen shows a clickable screenshot timeline; clicking a thumbnail seeks the video to that screenshot's timestamp. | Section 3 (D-12 thumbnail row + click seek); Section 7 (screenshot list query). |
| **REV-03** | Doctor can take additional screenshots from playback (same path as in-procedure screenshots). | Section 1 (D-01 second entry point); Section 3 (Capture button at end of timeline); same `screenshots.add` IPC. |
| **REV-04** | Doctor can trim the procedure (set start + end points); trim produces a new mp4 (original never overwritten) via ffmpeg `-ss` / `-t` with stream copy. | Section 2 (D-06/D-07/D-08 trim subprocess); Section 6 (buildTrimArgs + spawn pattern); Section 9 (restore from `video_path_original`). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mid-procedure screenshot capture (canvas snapshot) | Renderer (canvas) | Main (write file + DB) | Canvas snapshot is renderer-only (browser-native); main persists bytes to userData. |
| Post-recording screenshot capture (canvas snapshot from `<video>`) | Renderer (canvas) | Main (write file + DB) | Same canvas path; `<video>` element is the source. |
| Screenshot storage at userData-relative path | Main (fs) | DB (row references it) | Anti-Pattern 2 — store rel, resolve at read. |
| `screenshots` table + IPC + audit | Main | — | DB + repo + IPC handlers per Phase 2 pattern. |
| Screenshot timeline render (thumbnails row) | Renderer | Main (DB query) | Renderer queries `screenshots.listByProcedure`, renders memoized `<ScreenshotThumbnail>` components. |
| Scrubber with pause-marker ticks + drag handles | Renderer | Main (DB query for procedure_segments) | Renderer fetches segments; pure UI state for handles. |
| `<video>` playback for review | Renderer | Main (localhost HTTP server serving mp4) | `file://` blocked under contextIsolation; extend PreviewServer pattern. |
| Trim ffmpeg invocation (`-ss in -i orig -t dur -c copy trimmed`) | Main | — | One-shot subprocess mirroring concat (Phase 4 §2); supervisor state. |
| Trim schema column + update | Main (DB) | — | Schema + repo + IPC handlers. |
| Restore from `video_path_original` | Main (DB + fs) | — | Re-point `video_path`; verify original exists; audit. |
| Audit on every mutation | Main | — | `recordAudit({ action: 'screenshot.captured' | 'screenshot.deleted' | 'procedure.trimmed' | 'procedure.restored', … })`. |

## Standard Stack

### Core (existing, locked — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ffmpeg-static` | ^5.2.0 | Bundled ffmpeg binary | Trim subprocess uses the same binary as recording. |
| `better-sqlite3` | 11.10.0 | WAL-mode SQLite | Screenshots table + ALTER procedures. |
| `safeStorage` | Electron built-in | Encrypt sensitive fields | No new encrypted columns in Phase 5. |
| `canvas` (browser-native) | Chromium | Screenshot rendering | Renderer-side `<canvas>` API; `toBlob('image/jpeg', 0.85)`. |
| HTML5 `<video>` | Chromium | Review playback | Native, no JS player library; `currentTime` + `onTimeUpdate` + `duration` cover scrubber + seek. |
| Pointer Events API | W3C | Scrubber + trim handle drag | Mouse + touch + pen unified; `setPointerCapture` keeps drag alive off-element. |

### Supporting (existing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|------------|
| Phase 4 `Recorder` | n/a | ffmpeg child supervisor | Trim spawn mirrors this; no reuse (Anti-Pattern 5). |
| Phase 4 `PreviewServer` | n/a | MJPEG-over-HTTP bridge | Extend with `/video` route serving the canonical mp4 to review `<video>`. |
| Phase 4 `concat.ts` | n/a | Segment concat pattern | Trim's spawn shape + concat-list pattern reused for trim file naming. |
| Phase 4 `proceduresRepo` | n/a | Procedures table | Extend with `updateVideoPath(id, newPath)` + `setOriginalVideoPath(id, orig)` + `restoreFromOriginal(id)` methods. |

### Alternatives Considered
| Recommended | Alternative | Tradeoff |
|-------------|-------------|----------|
| Canvas `drawImage` from live `<img>` preview (D-03 simpler path) | ffmpeg `image2` muxer one-shot subprocess per screenshot | Canvas is one render-frame, zero main-process spawn overhead; ffmpeg path requires extra args + child lifecycle. |
| `<video>` plays via custom localhost HTTP (extend PreviewServer) | `file://` URL on `<video>.src` | `file://` blocked under `contextIsolation: true`; custom HTTP mirrors the existing pattern. |
| Per-procedure localhost server (one route per procedure) | Single shared HTTP server (route by procedureId query param) | Single shared server — same port, less port churn. |
| `-ss before -i -c copy` (D-08 ±500ms) | `-ss after -i -c:v libx264 -preset veryfast` (re-encode, exact) | Phase 5 ships the fast path; re-encode is a future Phase if doctors complain about ±500ms drift. |
| Migration as single `0003_screenshots_and_trim.sql` | Split into `0003_screenshots.sql` + `0004_trim.sql` | One file — screenshots table + ALTER are tightly coupled (the column exists to support screenshots' parent procedure). |
| `ProceduresRepo` methods `trim(id, newPath)` + `restore(id)` | Separate `trimRepo.ts` module | Repo-per-table convention from Phase 2; trim is a procedure-level operation, lives in procedures-repo. |
| Screenshot delete via Toast-with-undo (D-12) | Confirm modal | Toast is lower-friction; 5-second undo window covers accidental deletes; the row is hard-deleted at expiry (no soft-delete column). |

### Installation
**No new dependencies.** Phase 5 ships entirely within the locked stack from Phase 1 (electron + electron-vite + React + TS + Tailwind + shadcn) + Phase 2 (better-sqlite3) + Phase 4 (ffmpeg-static + child_process). All required APIs are browser-native (canvas, video element, Pointer Events).

## Architecture Patterns

### System Architecture Diagram

```
[Doctor clicks S in ProcedureRoom while recording]
    │
    ▼
[renderer: handleScreenshotHotkey → captureScreenshot(previewImgEl)]
    │   canvas.drawImage(previewImgEl, 0, 0, w, h)
    │   canvas.toBlob(jpeg, 0.85) → blob → base64
    ▼
[preload: window.api.screenshots.add({ procedureId, timestampInVideoMs, jpegBase64 })]
    │
    ▼
[main: registerScreenshotsIpc → handler]
    │   • requireSession() → userId
    │   • Validate procedureId (UUID) + ts ≥ 0
    │   • mkdir procedureMediaDir/screenshots/ if missing
    │   • fs.writeFileSync(`${dir}/screenshots/${ts}.jpg`, Buffer.from(base64))
    │   • INSERT screenshots row
    │   • recordAudit({ action: 'screenshot.captured', entityType: 'procedure', entityId: procedureId, metadata: { screenshotId, timestampInVideoMs } })
    │   • return Screenshot entity
    ▼
[renderer: appends to local list; thumbnail renders from file:// via localhost HTTP]


[Doctor opens procedure-review route]
    │
    ▼
[renderer: ProcedureReview mounts]
    │   • useEffect → fetch procedure row + screenshots list + procedure_segments list
    │   • <video src={http://127.0.0.1:<port>/media/<patientId>/<procedureId>/video.mp4}>
    │   • Scrubber subscribes to onTimeUpdate; pause-marker ticks from segments
    │   • Screenshot timeline rows below
    ▼
[Doctor clicks thumbnail] → videoRef.currentTime = timestampMs / 1000
    │
    ▼
[Doctor enters Trim mode, drags handles, clicks Apply]
    │
    ▼
[preload: window.api.procedures.trim({ procedureId, inMs, outMs })]
    │
    ▼
[main: registerProceduresIpc → trim handler]
    │   • requireSession() → userId
    │   • Verify procedure exists, status='completed', has not been deleted
    │   • Resolve input/output paths: in=<orig>, out=<sibling>-trimmed.mp4
    │   • Spawn ffmpeg: -ss <in>/1000 -i <orig> -t <dur>/1000 -c copy -movflags +faststart <trimmed>
    │   • On exit code 0: fsync trimmed; UPDATE procedures SET video_path = trimmed, video_path_original = (COALESCE(orig, video_path)) WHERE id = ?
    │   • recordAudit({ action: 'procedure.trimmed', entityType: 'procedure', entityId, metadata: { inMs, outMs, originalVideoPath, trimmedVideoPath } })
    │   • return updated Procedure
    ▼
[renderer: re-fetches procedure; <video>.src reloads to trimmed path]


[Doctor clicks Restore]
    │
    ▼
[main: restore handler]
    │   • Verify video_path_original NOT NULL
    │   • fs.access(video_path_original) → exists
    │   • UPDATE procedures SET video_path = video_path_original WHERE id = ?
    │   • recordAudit({ action: 'procedure.restored', entityType: 'procedure', entityId, metadata: { restoredFrom: video_path_original } })
    │   • return updated Procedure
```

### Recommended Project Structure

```
src/
├── main/
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 0003_screenshots_and_trim.sql         (NEW)
│   │   ├── screenshots-repo.ts                       (NEW — listByProcedure, add, delete, updateAnnotation)
│   │   └── procedures-repo.ts                        (UPDATE — add updateVideoPath, setOriginalVideoPath, restoreFromOriginal)
│   ├── ipc/
│   │   ├── procedures.ts                             (UPDATE — add trim, restore handlers)
│   │   └── screenshots.ts                            (NEW — add, delete, updateAnnotation, list)
│   ├── recorder/
│   │   ├── ffmpeg-args.ts                            (UPDATE — add buildTrimArgs)
│   │   ├── trim.ts                                   (NEW — applyTrim one-shot spawn)
│   │   ├── preview-server.ts                         (UPDATE — add /media/<patientId>/<procedureId>/<file> route)
│   │   └── (recorder.ts unchanged)
│   ├── paths.ts                                      (UPDATE — add screenshotsDir helper)
│   └── index.ts                                      (UPDATE — register new IPCs + extend PreviewServer)
├── preload/
│   └── index.ts                                      (UPDATE — extend api.screenshots + api.procedures.trim/restore)
├── shared/
│   ├── ipc-contract.ts                               (UPDATE — Screenshot + TrimRequest/TrimResult + IPC constants)
│   └── validators.ts                                 (UPDATE — screenshot create/list/delete/annotation; proceduresTrim; proceduresRestore)
└── renderer/
    ├── src/
    │   ├── pages/
    │   │   ├── ProcedureRoom.tsx                     (UPDATE — add Screenshot button + S hotkey + captureScreenshot call)
    │   │   └── ProcedureReview.tsx                   (REWRITE — replaces Phase 4 placeholder)
    │   ├── components/
    │   │   ├── Scrubber.tsx                          (NEW — scrubber + pause markers + trim handles + click-seek)
    │   │   ├── ScreenshotTimeline.tsx                (NEW — thumbnail row + +Capture + delete-with-toast)
    │   │   ├── ScreenshotThumbnail.tsx               (NEW — memoized single thumbnail)
    │   │   ├── ProcedureNotesReview.tsx              (NEW — read-only notes accordion for review; or reuse ProcedureNotesPanel with disabled input)
    │   │   ├── TrimControls.tsx                      (NEW — Trim mode toggle + Apply/Restore buttons + handles inline)
    │   │   ├── VideoPlayer.tsx                       (NEW — controlled <video> with ref + onTimeUpdate bridge)
    │   │   └── (existing RecordingControlsBar, RecIndicator, etc. — unchanged)
    │   ├── lib/
    │   │   ├── capture-screenshot.ts                 (NEW — canvas.drawImage + toBlob + base64 conversion; single function, reused by mid-procedure + post-recording paths)
    │   │   └── (existing format-duration, format, utils — unchanged)
    │   └── store/
    │       └── (existing recording, route, session — unchanged)
```

### Pattern 1: Trim subprocess with the same supervisor conventions as recording
**What:** A pure `buildTrimArgs({ inputPath, inMs, outMs, outputPath })` function returns the ffmpeg argv array; an `applyTrim({ procedureId, inMs, outMs })` function orchestrates spawn + await + DB update + audit.
**Why:** Mirrors the Phase 4 concat pattern (`buildConcatArgs` + supervisor runConcat) — same `defaultFfmpegPath()` + `windowsVerbatimArguments: true` + `stdio` configuration.
**Example:**
```ts
// src/main/recorder/ffmpeg-args.ts (additive)
export type TrimArgsOptions = {
  inputPath: string;
  inMs: number;
  outMs: number;
  outputPath: string;
};

export function buildTrimArgs(opts: TrimArgsOptions): string[] {
  if (opts.outMs <= opts.inMs) {
    throw new EmptyFfmpegArgsError('outMs must be greater than inMs');
  }
  const inSec = opts.inMs / 1000;
  const durationSec = (opts.outMs - opts.inMs) / 1000;
  return [
    '-ss', inSec.toString(),                       // seek BEFORE -i (fast, ±500ms, requires -c copy)
    '-i', opts.inputPath,
    '-t', durationSec.toString(),
    '-c', 'copy',                                    // stream copy — no re-encode
    '-movflags', '+faststart',
    '-y', opts.outputPath,
  ];
}
```
```ts
// src/main/recorder/trim.ts (new)
import { spawn } from 'node:child_process';
import { defaultFfmpegPath } from './ffmpeg-path';
import { buildTrimArgs } from './ffmpeg-args';
import { audit } from '../db/audit';
import { proceduresRepo } from '../db/procedures-repo';

export type ApplyTrimInput = { procedureId: string; inMs: number; outMs: number };
export type ApplyTrimResult = { trimmedVideoPath: string };

export async function applyTrim(input: ApplyTrimInput): Promise<ApplyTrimResult> {
  const proc = proceduresRepo.get(input.procedureId);
  if (!proc) throw new Error('Procedure not found');
  if (proc.status === 'partial') throw new Error('Cannot trim a partial recording');
  if (input.outMs <= input.inMs) throw new Error('outMs must be greater than inMs');

  // Compute the canonical input/output paths.
  const inputAbs = path.join(app.getPath('userData'), proc.videoPath);
  const { dir, name } = path.parse(proc.videoPath);
  const outputPath = path.join(dir, `${name}-trimmed.mp4`);
  const outputRel = path.relative(app.getPath('userData'), outputPath);

  const args = buildTrimArgs({ inputPath: inputAbs, inMs: input.inMs, outMs: input.outMs, outputPath });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(defaultFfmpegPath(), args, {
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    child.on('error', reject);
  });

  // fsync the trimmed file (PITFALLS §1 recovery).
  const fd = openSync(outputPath, 'r');
  fsyncSync(fd);
  closeSync(fd);

  // Update the procedure row.
  proceduresRepo.updateVideoPath(input.procedureId, outputRel, /* originalPath */ proc.videoPath_original ?? proc.videoPath);

  audit({
    action: 'procedure.trimmed',
    entityType: 'procedure',
    entityId: input.procedureId,
    metadata: {
      inMs: input.inMs,
      outMs: input.outMs,
      originalVideoPath: proc.videoPath_original ?? proc.videoPath,
      trimmedVideoPath: outputRel,
    },
  });

  return { trimmedVideoPath: outputRel };
}
```

### Pattern 2: Screenshot capture via canvas snapshot from live preview
**What:** A single `captureScreenshot(sourceEl)` renderer function: clone to a canvas at the source's `naturalWidth/Height`, `drawImage` into it, `toBlob('image/jpeg', 0.85)`, return `{ blob, width, height }`. The renderer's preview `<img>` (mid-procedure, D-03 simpler path) and the review `<video>` (post-recording, D-03 same pattern) both expose a drawable surface to canvas.
**Why:** Zero main-process spawn overhead. The renderer's preview `<img>` is the SAME byte stream ffmpeg produces — the doctor sees what gets captured. Post-recording, the `<video>` element's `currentTime` + `drawImage(videoEl)` are the canonical HTML5 snapshot path (Phase 3 STACK.md §screenshots verbatim).
**Example:**
```ts
// src/renderer/src/lib/capture-screenshot.ts
export async function captureScreenshot(
  source: HTMLImageElement | HTMLVideoElement,
  opts: { maxLongEdge: number; quality: number } = { maxLongEdge: 1280, quality: 0.85 },
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  const intrinsicW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const intrinsicH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!intrinsicW || !intrinsicH) throw new Error('Source has no intrinsic dimensions');

  // Downscale to maxLongEdge preserving aspect ratio.
  const scale = opts.maxLongEdge / Math.max(intrinsicW, intrinsicH);
  const w = Math.round(intrinsicW * Math.min(1, scale));
  const h = Math.round(intrinsicH * Math.min(1, scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', opts.quality));
  if (!blob) throw new Error('canvas.toBlob returned null');
  return { blob, width: w, height: h };
}
```

### Pattern 3: Scrubber with Pointer Events for cross-platform drag
**What:** Single `<Scrubber>` component renders a track + progress fill + 2 trim handles (when trimMode). Uses `onPointerDown` to capture + identify which element was hit (progress / in-handle / out-handle / track); `setPointerCapture` ensures `onPointerMove` keeps firing even when the cursor leaves the element. `onPointerUp` releases.
**Why:** Mouse events fail on touch; Pointer Events unify mouse + touch + pen. `setPointerCapture` is the standard HTML5 way to keep a drag alive when the cursor leaves the element bounds (drags don't "drop" if you drag fast).
**Example:**
```tsx
// src/renderer/src/components/Scrubber.tsx (sketch)
function Scrubber({ durationMs, currentMs, inMs, outMs, trimMode, onSeek, onTrim }: ScrubberProps) {
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, mode: 'progress' | 'in' | 'out' | 'track') {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    function move(ev: PointerEvent) {
      const rect = target.getBoundingClientRect();
      const x = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
      const ms = Math.round((x / rect.width) * durationMs);
      if (mode === 'progress') onSeek(ms);
      else if (mode === 'in') onTrim({ inMs: Math.min(ms, outMs - 1000), outMs });
      else if (mode === 'out') onTrim({ inMs, outMs: Math.max(ms, inMs + 1000) });
      else if (mode === 'track') onSeek(ms);
    }
    function up(ev: PointerEvent) { target.releasePointerCapture(ev.pointerId); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); }
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
  // render: <div onPointerDown={(e) => handlePointerDown(e, 'track')}><div style={{ width: `${(currentMs/durationMs)*100}%` }} /><div style={{ left: `${(inMs/durationMs)*100}%` }} /></div>
}
```

### Pattern 4: Localhost HTTP serving userData media to the renderer's `<video>`
**What:** Extend the existing `PreviewServer` (which already serves MJPEG to the renderer's `<img>`) with a new `/media/<patientId>/<procedureId>/<file>` route that streams the canonical mp4 to the renderer. Same lifecycle as the MJPEG route — created in `Recorder.start()`, destroyed in `Recorder.stop() / forceCleanup()`.
**Why:** `file://` is blocked under `contextIsolation: true`; `protocol.handle()` requires additional plumbing; extending the existing localhost HTTP pattern is one line of `http.createServer` handler code.
**Example:**
```ts
// src/main/recorder/preview-server.ts (additive)
this.httpServer = createHttpServer((req, res) => {
  const url = req.url ?? '/';
  if (url.startsWith('/preview') || url === '/') { /* existing MJPEG route */ return; }
  const match = url.match(/^\/media\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/([\w.-]+)$/);
  if (!match) { res.statusCode = 404; res.end('Not Found'); return; }
  const [, patientId, procedureId, file] = match;
  const userData = app.getPath('userData');
  const filePath = path.join(userData, 'data', 'media', 'patients', patientId, procedureId, file);
  // Serve the file with Range support (Chromium <video> uses range requests for seeking).
  const stat = statSync(filePath);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', String(stat.size));
  // Stream a basic single-range response (Chromium handles the seek via Range header; partial support is OK for v1).
  res.statusCode = 200;
  createReadStream(filePath).pipe(res);
});
```

### Anti-Patterns to Avoid
- **Optimistic UI for trim/screenshot mutations** — doctor refreshes the review page, sees "trim applied", but main hasn't actually finalized the mp4. Always await IPC round-trip; show inline spinner (UX-Pitfalls table).
- **Reusing ffmpeg across procedures or trim calls** (ARCHITECTURE Anti-Pattern 5) — each trim spawns its own ffmpeg child, awaited, then closed. No persistent ffmpeg pool.
- **Storing absolute Windows paths in `screenshots.file_path`** — Anti-Pattern 2. Store userData-relative form; resolve at read time via `path.join(app.getPath('userData'), storedRelPath)`.
- **Per-row React re-render of the screenshot timeline** — PITFALLS Performance Traps. Wrap each thumbnail in `memo(ScreenshotThumbnail)` so deleting one doesn't re-render the other 50.
- **`file://` URLs on `<video>.src`** — contextIsolation blocks this in Electron renderer. Use the localhost HTTP pattern.
- **`-ss after -i` for trim** — incompatible with `-c copy` (you can't decode when copying); requires a re-encode (slow, out of Phase 5 scope). Phase 5 ships `-ss before -i` per D-08.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| H.264 mp4 stream-copy trim | Custom muxer + keyframe index | `ffmpeg -ss in -i orig -t dur -c copy` | Stream copy is the canonical ffmpeg path; concat demuxer (Phase 4) is verified for matched codec params. |
| Frame snapshot from MJPEG preview stream | ffmpeg `image2` muxer subprocess per screenshot | `canvas.drawImage(previewImg)` + `canvas.toBlob('image/jpeg', 0.85)` | Browser-native, zero spawn overhead, the preview IS the camera frame. |
| Range-request HTTP file server for `<video>` | Custom Node net server with seek support | Existing PreviewServer + one new route handler | Pattern already ships; the MP4 route is one extra `if` branch. |
| Drag handle UX | Custom mouse + touch + pen handlers | Pointer Events API + `setPointerCapture` | W3C standard; works on Win/Mac/Linux + touchscreens. |
| Foreign key enforcement on screenshots FK | Manual existence checks in the repo | `FOREIGN KEY (procedure_id) REFERENCES procedures(id) ON DELETE CASCADE` | Database-level invariant; no app-level drift. |
| Timestamp rounding for `timestamp_in_video` | Float seconds | `Math.floor(videoRef.current.currentTime * 1000)` | Schema stores INTEGER ms; video element reports seconds (float). |
| Range request partial content for `<video>` seek | Build full HTTP range parser | Default Chromium behavior — single full response + `Accept-Ranges: bytes` header; Chromium seeks by issuing a new request | The single-200-range strategy is enough for v1 (Chromium handles seek via re-request). Full multipart-range support is out of scope. |

**Key insight:** Both the canvas snapshot (D-03 simpler path) and the localhost-HTTP `<video>` reuse already-shipped patterns — Phase 5 has zero "exotic" work; the trim subprocess is the only genuinely-new piece, and it mirrors Phase 4's concat subprocess one-to-one.

## Runtime State Inventory

> Phase 5 ADDS a new table and a new column; nothing about existing tables or columns is renamed or repurposed. No grep audit of state is needed.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `screenshots` table (NEW); `procedures.video_path_original` column (NEW, nullable). No changes to existing rows. | Migration `0003_screenshots_and_trim.sql` runs idempotently on existing DBs (ALTER TABLE ADD COLUMN is non-destructive for nullable column). |
| Live service config | No changes — no service config touches the screenshots table. | None. |
| OS-registered state | No changes. | None. |
| Secrets and env vars | No changes. | None. |
| Build artifacts | No changes — no new npm deps; no rebuild of better-sqlite3 (still on Node 20 ABI). | None. |

**Nothing found in category:** State explicitly — Phase 5 is additive; existing `.partial.mp4` suffix from Phase 4 continues to apply to `procedures.video_path` (D-13 gate). The audit log grows new action strings (`screenshot.captured`, `screenshot.deleted`, `procedure.trimmed`, `procedure.restored`) but the table shape is unchanged.

## Common Pitfalls

### Pitfall 1: `file://` URL on `<video>.src` is blocked under contextIsolation
**What goes wrong:** Electron renderer with `contextIsolation: true / nodeIntegration: false / sandbox: true` refuses to load `<video src="file:///C:/Users/.../video.mp4">`; the `<video>` element shows "Failed to load resource" or empty.
**Why:** Sandbox-mode renderers can't read filesystem paths via the `file://` protocol.
**How to avoid:** Serve the mp4 over HTTP from a localhost port (Section 4 Pattern 4). The renderer uses `<video src="http://127.0.0.1:<port>/media/<patientId>/<procedureId>/video.mp4">`. The existing PreviewServer already binds a TCP + HTTP server — adding a new route is ~10 lines.
**Warning signs:** `<video>` reports `MEDIA_ERR_SRC_NOT_SUPPORTED` or stays blank; DevTools network tab shows no request for the mp4.
**Phase to address:** Phase 5.

### Pitfall 2: Trim with `-c copy` requires `-ss` BEFORE `-i`
**What goes wrong:** `ffmpeg -i orig -ss in -t dur -c copy out.mp4` produces a file that plays from frame 0 (the seek is ignored) or errors with "moov atom not found".
**Why:** `-c copy` means no decoding; you cannot seek without first demuxing to the target position. The `-ss` BEFORE `-i` flag is parsed at the demuxer level (keyframe-aligned, fast, ±500ms). The `-ss` AFTER `-i` flag is parsed at the decoder level (decode from start, frame-accurate, slow).
**How to avoid:** `buildTrimArgs()` always emits `-ss <in> -i <orig> -t <dur> -c copy -movflags +faststart <out>` (D-08). Accept the ±500ms accuracy; let the doctor fine-tune via the trim handles if a cut lands awkwardly.
**Warning signs:** Trimmed mp4 plays from the start instead of the cut point; or ffmpeg exits with "Invalid data found when processing input" when the cut lands before a keyframe.
**Phase to address:** Phase 5.

### Pitfall 3: Trim must never overwrite the original mp4
**What goes wrong:** Doctor clicks Apply → trim runs but accidentally overwrites the original. They wanted to undo; no backup.
**Why:** Coding error (writing to the same path), or schema confusion (forgetting to set `video_path_original` first).
**How to avoid:** `applyTrim()` always writes to `<basename>-trimmed.mp4` (a sibling file). `proceduresRepo.updateVideoPath()` always sets BOTH `video_path` (to the trimmed path) AND `video_path_original` (to the OLD `video_path`, only on first trim — subsequent trims leave `video_path_original` untouched). The original mp4 is never deleted. D-07 + D-09.
**Warning signs:** After trim, the doctor can't Restore to original; `video_path_original IS NULL` in DB.
**Phase to address:** Phase 5.

### Pitfall 4: Per-row React re-render of the screenshot timeline
**What goes wrong:** 30 screenshots captured during one procedure → timeline has 30 thumbnails. Doctor deletes one → all 30 re-render → noticeable jank on low-end clinic workstations.
**Why:** State-driven React re-renders the whole list when one item changes.
**How to avoid:** Wrap each `<ScreenshotThumbnail>` in `memo(...)` keyed on `screenshot.id`. The parent passes only the props each thumbnail needs; the child re-renders only when its own props change. PITFALLS Performance Traps.
**Warning signs:** React DevTools Profiler shows 30+ component updates on a single delete; UI feels sluggish on Win10 low-end hardware.
**Phase to address:** Phase 5.

### Pitfall 5: Trim enabled on `.partial.mp4` recordings (D-13 violation)
**What goes wrong:** Doctor loads a partial recording → review screen offers Trim → doctor drags handles + clicks Apply → ffmpeg runs with `video_path = video-seg0.mp4.partial.mp4` → trim either errors (corrupt moov from the device-lost rename) or produces a file that plays from the start of what was captured (no meaningful "salient portion" exists when the recording was cut off by device disconnect).
**Why:** D-13 says trim is disabled on partial recordings.
**How to avoid:** Review screen gates the Trim button on `procedure.status !== 'partial'`. The trim IPC handler also rejects with `IPC_VALIDATION` if status is partial. Belt-and-suspenders.
**Warning signs:** Audit log shows `procedure.trimmed` for a `status='partial'` procedure.
**Phase to address:** Phase 5.

### Pitfall 6: Trim handles can produce an invalid range (outMs <= inMs)
**What goes wrong:** Doctor drags the in-handle past the out-handle → `inMs > outMs` → `ffmpeg -t (outMs-inMs)/1000` with negative or zero duration → ffmpeg errors out.
**Why:** Drag handler doesn't clamp.
**How to avoid:** Renderer clamps: when in-handle is dragged, `inMs = Math.min(inMs, outMs - 1000)`; when out-handle is dragged, `outMs = Math.max(outMs, inMs + 1000)`. Main also validates in the IPC handler (`outMs > inMs`, `inMs >= 0`, `outMs <= procedure.durationSeconds * 1000`).
**Warning signs:** ffmpeg exit code 255 or "negative duration" stderr.
**Phase to address:** Phase 5.

### Pitfall 7: Screenshot timestamp conversion (seconds float → ms integer)
**What goes wrong:** Renderer reads `videoRef.current.currentTime = 12.345s` → converts to `timestampMs = 12345` correctly. But `videoRef.current.currentTime` is a float; `Math.floor(currentTime * 1000)` rounds DOWN. If doctor seeks to exactly 12.999s and captures, the screenshot row's `timestamp_in_video = 12999`, but `<video>.currentTime = 12.999`. Clicking the thumbnail later sets `videoRef.currentTime = 12999 / 1000 = 12.999` — fine. BUT if doctor seeks to 12.0001s and captures, `Math.floor(12.0001 * 1000) = 12000`, `videoRef.currentTime = 12.0001` — re-seeking lands at exactly 12.0001, not 12.000. Minor drift.
**Why:** Float math + floor.
**How to avoid:** Use `Math.round(currentTime * 1000)` (round to nearest ms) — same convention as the rest of the app. Acceptable drift; cosmetic.
**Warning signs:** Click-to-seek from a screenshot thumbnail lands 1ms before/after the original capture point.
**Phase to address:** Phase 5.

### Pitfall 8: Drag handlers drop on cursor exit (mouse events only)
**What goes wrong:** Doctor drags the in-handle fast → cursor leaves the element bounds → mouseup is never received on the drag handler → handle sticks to last pointermove position, but a subsequent click on the scrubber track fires a seek at the wrong time.
**Why:** HTML mouse events don't fire on the captured element once the cursor leaves it.
**How to avoid:** Use Pointer Events with `setPointerCapture`. The drag handler keeps receiving `pointermove` and `pointerup` regardless of where the cursor goes. The same handler releases on `pointerup`.
**Warning signs:** Handles "stick" mid-drag; scrubbing snaps to a wrong position after a fast drag.
**Phase to address:** Phase 5.

### Pitfall 9: `procedure.get()` returns undefined mid-IPC (race with finalize)
**What goes wrong:** Doctor clicks Restore → IPC handler calls `proceduresRepo.get(id)` → returns undefined because the procedure row was just soft-deleted or a concurrent finalize overwrote it → handler throws NPE.
**Why:** Multi-window potential; or a Phase 7 cleanup flow deleting the procedure between the review-screen mount and the Restore click.
**How to avoid:** IPC handler validates `proc` exists and has `status !== 'crashed'`; rejects with `IPC_NOT_FOUND`. UI is one-window so this race is theoretical, but the defensive check costs nothing.
**Warning signs:** App log shows `Cannot read properties of undefined` from `proceduresRepo`.
**Phase to address:** Phase 5.

### Pitfall 10: Audit metadata leaks procedure identifying info
**What goes wrong:** `audit({ metadata: { screenshotFile: 'C:/Users/.../data/media/patients/<p>/<proc>/screenshots/<ts>.jpg' } })` → audit log includes absolute path → log reviewer can recover procedure identifiers.
**Why:** Convenience copy-paste from existing log.
**How to avoid:** Audit metadata for screenshots is `{ screenshotId, timestampInVideoMs }`. For trim: `{ inMs, outMs, originalVideoPath, trimmedVideoPath }` — the path values are userData-RELATIVE (Anti-Pattern 2); the audit row already carries `entityId: procedureId`. Fix 6 convention (Phase 2).
**Warning signs:** Audit log row includes absolute Windows path.
**Phase to address:** Phase 5.

## Code Examples

### Screenshot IPC round-trip (renderer)
```ts
// src/renderer/src/lib/capture-screenshot.ts (sketch — see Pattern 2 above for full impl)

// Usage in ProcedureRoom (mid-procedure):
async function handleScreenshot() {
  if (!previewImgRef.current) return;
  const { blob } = await captureScreenshot(previewImgRef.current);
  const base64 = await blobToBase64(blob);                   // utility
  const tsMs = Math.round((Date.now() - recordingStartedAt) / 1);  // D-05 ms since procedure start
  await window.api.screenshots.add({ procedureId, timestampInVideoMs: tsMs, jpegBase64: base64 });
}

// Usage in ProcedureReview (post-recording):
async function handleCaptureFromPlayback() {
  if (!videoRef.current) return;
  const { blob } = await captureScreenshot(videoRef.current);
  const base64 = await blobToBase64(blob);
  const tsMs = Math.round(videoRef.current.currentTime * 1000);    // D-05 ms within the mp4
  await window.api.screenshots.add({ procedureId, timestampInVideoMs: tsMs, jpegBase64: base64 });
}
```

### Scrubber with pause markers + trim handles (renderer)
```tsx
// src/renderer/src/components/Scrubber.tsx (sketch)
export function Scrubber({ procedure, segments, screenshots, trimMode, onSeek, onApply, onRestore }: ScrubberProps) {
  const [inMs, setInMs] = useState(0);
  const [outMs, setOutMs] = useState(procedure.durationSeconds * 1000);
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div>
      <video ref={videoRef} src={getMediaUrl(procedure.videoPath, procedure.patientId)} controls preload="metadata" />
      <div className="scrubber-track relative h-8 bg-slate-200 rounded" onPointerDown={(e) => handleDrag(e, 'track', setSeek)}>
        {/* Progress fill */}
        <div className="absolute inset-y-0 left-0 bg-slate-500" style={{ width: `${(currentMs/durationMs)*100}%` }} />
        {/* Pause markers from procedure_segments */}
        {segments.map((seg, i) => (
          <div key={seg.id} className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${(seg.startedAt/durationMs)*100}%` }} title={`Pause ${i+1}: ${fmt(seg.startedAt)}–${fmt(seg.endedAt)}`} />
        ))}
        {/* Trim handles */}
        {trimMode ? (
          <>
            <div className="absolute inset-y-0 w-1 bg-red-500 cursor-ew-resize" style={{ left: `${(inMs/durationMs)*100}%` }} onPointerDown={(e) => handleDrag(e, 'in', ...)} />
            <div className="absolute inset-y-0 w-1 bg-red-500 cursor-ew-resize" style={{ left: `${(outMs/durationMs)*100}%` }} onPointerDown={(e) => handleDrag(e, 'out', ...)} />
            <div className="absolute inset-y-0 bg-red-300/50" style={{ left: `${(inMs/durationMs)*100}%`, width: `${((outMs-inMs)/durationMs)*100}%` }} />
          </>
        ) : null}
      </div>
      {/* Screenshot timeline */}
      <ScreenshotTimeline procedureId={procedure.id} onSeek={(ts) => videoRef.current && (videoRef.current.currentTime = ts / 1000)} />
      {/* Trim action panel */}
      {trimMode && !isPartial ? (
        <TrimControls
          inMs={inMs} outMs={outMs}
          onApply={() => onApply(inMs, outMs)}
          onRestore={onRestore}
          disabled={procedure.status === 'partial'}
        />
      ) : null}
    </div>
  );
}
```

### Trim IPC handler (main)
```ts
// src/main/ipc/procedures.ts (additive)
ipcMain.handle(IPC.PROCEDURES_TRIM, async (_e, raw) => {
  try {
    const parsed = safeParse(proceduresTrimInput, raw);
    const userId = requireSession();
    const result = await applyTrim({ procedureId: parsed.id, inMs: parsed.inMs, outMs: parsed.outMs });
    audit({
      action: 'procedure.trimmed',
      entityType: 'procedure',
      entityId: parsed.id,
      userId,
      metadata: { inMs: parsed.inMs, outMs: parsed.outMs, trimmedVideoPath: result.trimmedVideoPath },
    });
    return proceduresRepo.get(parsed.id);  // return updated row
  } catch (err) { throw asIpcError(err); }
});

ipcMain.handle(IPC.PROCEDURES_RESTORE, async (_e, raw) => {
  try {
    const parsed = safeParse(proceduresRestoreInput, raw);
    const userId = requireSession();
    const proc = proceduresRepo.get(parsed.id);
    if (!proc) throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Procedure not found'));
    if (!proc.videoPathOriginal) throw new IpcErrorException(ipcError('IPC_VALIDATION', 'No original recording to restore from'));
    const updated = proceduresRepo.restoreFromOriginal(parsed.id);
    audit({
      action: 'procedure.restored',
      entityType: 'procedure',
      entityId: parsed.id,
      userId,
      metadata: { restoredFrom: proc.videoPathOriginal },
    });
    return updated;
  } catch (err) { throw asIpcError(err); }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mouse events for drag UX | Pointer Events API + `setPointerCapture` | W3C 2018+ | Unified mouse + touch + pen; standard since 2018 in all evergreen browsers. |
| `MediaRecorder` for video | ffmpeg child_process | Phase 4 | Long-form procedure stability (>30 min). |
| `node-sqlite3` callback API | better-sqlite3 synchronous API | Phase 2 | Main-process simplicity; transaction support. |
| `file://` URLs on `<video>.src` (Electron renderer) | Localhost HTTP server from main | Electron contextIsolation sandbox default | Renderer can't read filesystem paths; HTTP route serves media safely. |
| Float seconds for `timestamp_in_video` | Integer milliseconds | Phase 5 D-05 | Schema consistency with `procedures.started_at` (ms). |
| Custom seek bar overlay on `<video>` | Native `<video controls>` + click-to-seek scrubber on a separate track | Phase 5 D-12 | Native controls + custom scrubber = best UX + simpler code. |

**Deprecated/outdated:**
- None for Phase 5 — all patterns are current as of 2026-08-06.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Renderer's preview `<img>` is the right frame source for mid-procedure screenshot (D-03 simpler path) — canvas.drawImage works on `<img>`. | Architecture Patterns §2 (captureScreenshot) | Low — `<img>` always has a decoded bitmap available; the preview IS what the doctor sees. The fallback (ffmpeg image2 muxer) is documented in CONTEXT.md D-03. |
| A2 | A single shared localhost HTTP server (extending PreviewServer) is the right way to serve the recorded mp4 to the review `<video>`. | Architecture Patterns §4 (PreviewServer extension) | Low — pattern already ships for MJPEG; adding one route is ~10 lines. Alternative `protocol.handle()` adds more wiring. |
| A3 | Screenshot timestamps use `Math.round(videoRef.current.currentTime * 1000)` — rounding to nearest ms. | Common Pitfalls §7 | Low — cosmetic drift on click-to-seek; covered in PITFALLS as acceptable. |
| A4 | Screenshot delete is a hard `DELETE FROM screenshots WHERE id = ?` (no soft-delete column). | Don't Hand-Roll / Architecture Patterns | Low — D-05 schema doesn't include `deleted_at`; matches CONTEXT decision. |
| A5 | Trim mode toggle hides the screenshot timeline's "+ Capture" button — single-purpose mode (the trim UI is its own surface). | Architecture Patterns §3 (Scrubber) | Low — UX micro-decision; the +Capture button stays visible when trimMode is off. |
| A6 | The 5-second Toast-with-undo window is long enough for accidental screenshot deletes. | Don't Hand-Roll | Low — shadcn Sonner toast; 5s is the standard timeout; doctor can re-capture if they miss it. |
| A7 | The `<video>` element's Range requests are served by a single full-file response with `Accept-Ranges: bytes` — Chromium re-issues on seek. | Common Pitfalls §1 + Pattern §4 | Low — Chromium handles seek by re-requesting; full multipart-range is not needed for v1. |
| A8 | Trim handles' color is red (#dc2626 / Tailwind `red-600`); cut region is red at 50% alpha. | Architecture Patterns §3 | Low — agent's discretion per CONTEXT.md; red is the recommended default per CONTEXT §Patterns. |

**If this table is empty:** Not applicable. The 8 assumptions above are noted; the planner should treat them as defaults — any change is a UI/UX tweak, not a schema or architecture change.

## Open Questions (RESOLVED)

1. **None blocking.** All decisions in CONTEXT.md D-01..D-13 are explicit; the agent's-discretion items (annotation UX, capture source, thumbnail size, delete UX, handle color, restore placement, audit metadata keys, migration split) are documented with reasonable defaults above.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ffmpeg-static` (asarUnpacked) | Trim subprocess + recording | ✓ | ^5.2.0 | — (Phase 4 already wired; same binary path rewrite via `defaultFfmpegPath()`) |
| `better-sqlite3` | screenshots table + ALTER procedures | ✓ | 11.10.0 | — (Phase 2 wired; Node 20 ABI rebuild via postinstall) |
| `<canvas>` API (Chromium) | Screenshot capture | ✓ | Electron 32 Chromium 128 | — (Electron renderer has canvas built in) |
| HTML5 `<video>` (Chromium) | Review playback | ✓ | Electron 32 Chromium 128 | — (native element, no library) |
| Pointer Events API | Scrubber + handle drag | ✓ | Electron 32 Chromium 128 | — (W3C standard since 2018) |
| `localStorage` / `sessionStorage` | n/a | n/a | n/a | — (Phase 5 doesn't need either) |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — Phase 5 ships entirely within the locked stack.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing; Phase 1 wired) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm run test:unit -- --run review-trim` |
| Full suite command | `npm run test:unit -- --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|---------------|
| SCRN-01 | Mid-procedure screenshot persists JPEG + DB row | unit | `npm run test:unit -- --run screenshots/add` | ❌ Wave 0 |
| SCRN-02 | Screenshot file written to userData-relative path; row indexed | unit | `npm run test:unit -- --run screenshots/listByProcedure` | ❌ Wave 0 |
| SCRN-02 | FK ON DELETE CASCADE removes screenshots when procedure deleted | unit | `npm run test:unit -- --run migrations/0003` | ❌ Wave 0 |
| REV-01 | Review `<video>` loads mp4 via localhost HTTP; scrubber subscribes to onTimeUpdate | unit (renderer) | `npm run test:unit -- --run renderer/Scrubber` | ❌ Wave 0 |
| REV-02 | Click on screenshot thumbnail seeks `<video>` to `timestamp_in_video / 1000` | unit (renderer) | `npm run test:unit -- --run renderer/ScreenshotTimeline click-seek` | ❌ Wave 0 |
| REV-03 | Post-recording screenshot via canvas snapshot from `<video>` | unit (renderer) | `npm run test:unit -- --run renderer/capture-screenshot` | ❌ Wave 0 |
| REV-04 | Trim ffmpeg subprocess with `-ss before -i -c copy` produces trimmed mp4 | unit | `npm run test:unit -- --run recorder/trim` | ❌ Wave 0 |
| REV-04 | `applyTrim` updates `procedures.video_path` + sets `video_path_original` (first trim only) | unit | `npm run test:unit -- --run db/procedures-repo trim` | ❌ Wave 0 |
| REV-04 | `restoreFromOriginal` re-points `video_path` to `video_path_original`; idempotent | unit | `npm run test:unit -- --run db/procedures-repo restore` | ❌ Wave 0 |
| D-13 | Trim IPC rejects when `procedure.status === 'partial'` | unit | `npm run test:unit -- --run ipc/procedures trim-partial` | ❌ Wave 0 |
| D-08 | Trim args emit `-ss BEFORE -i -c copy` (not `-ss after -i`) | unit | `npm run test:unit -- --run recorder/buildTrimArgs` | ❌ Wave 0 |
| Integration | Real ffmpeg trim produces a playable mp4 from a lavfi-generated source | integration | `npm run test:integration -- --run trim-smoke` | ❌ Wave 0 |
| Manual UAT | Real webcam → record → review → screenshot → trim → restore produces a valid mp4 | manual | Windows hardware smoke | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- --run review-trim`
- **Per wave merge:** `npm run test:unit -- --run`
- **Phase gate:** Full suite green + Windows hardware smoke UAT before `/gsd-verify-work 5`.

### Wave 0 Gaps
- [ ] `tests/main/db/migrations/0003_screenshots_and_trim.test.ts` — schema validation; CHECK constraints enforced; FK ON DELETE CASCADE verified.
- [ ] `tests/main/db/screenshots-repo.test.ts` — `add`, `listByProcedure`, `delete`, `updateAnnotation`.
- [ ] `tests/main/db/procedures-repo.test.ts` (extend) — `updateVideoPath(id, newPath, originalPath?)`, `restoreFromOriginal(id)`.
- [ ] `tests/main/recorder/ffmpeg-args.test.ts` (extend) — `buildTrimArgs` parameter matrix; rejects `outMs <= inMs`.
- [ ] `tests/main/recorder/trim.test.ts` — spawn fake ffmpeg child; assert exit-code-0 path updates row + audit; assert exit-code-non-zero throws.
- [ ] `tests/main/recorder/preview-server.test.ts` (extend) — `/media/<patientId>/<procedureId>/<file>` route serves the mp4 with `Accept-Ranges: bytes`; rejects paths outside the userData root (security).
- [ ] `tests/main/ipc/screenshots.test.ts` — IPC round-trip for `add / list / delete / updateAnnotation`; rejects oversized JPEG bytes; rejects bad procedureId.
- [ ] `tests/main/ipc/procedures.test.ts` (extend) — `trim` + `restore` round-trip; trim rejects partial; restore rejects missing `video_path_original`.
- [ ] `tests/renderer/lib/capture-screenshot.test.ts` — canvas snapshot from `<img>` and `<video>` mocks; max-edge downscale; toBlob quality=0.85.
- [ ] `tests/renderer/components/Scrubber.test.tsx` — drag handles clamp `inMs < outMs`; click-to-seek; pause markers render from `procedure_segments`.
- [ ] `tests/renderer/components/ScreenshotTimeline.test.tsx` — click thumbnail seeks video; delete-with-undo Toast appears; memoization prevents sibling re-renders (React DevTools Profiler or a render-counter).
- [ ] `tests/integration/trim-smoke.test.ts` — real ffmpeg: lavfi source → trim → ffprobe validates moov atom + duration.
- [ ] Framework: existing Vitest; no new dependencies.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireSession()` on every new IPC handler (`screenshots.add/list/delete/updateAnnotation`, `procedures.trim`, `procedures.restore`). |
| V3 Session Management | yes | Active session ends at app close (Phase 1). No reauth needed mid-procedure. |
| V4 Access Control | yes | `screenshots.add({ procedureId })` derives the procedure row via `proceduresRepo.get(id)`; renderer cannot spoof a cross-patient screenshot. Trim/restore similarly scoped. |
| V5 Input Validation | yes | Trim in/out validated: integers ≥ 0, `inMs < outMs`, `outMs <= procedure.durationSeconds * 1000`. Screenshot timestamp validated: integer ≥ 0. Screenshot JPEG byte size capped (e.g. 5 MB) in the IPC handler before write. |
| V6 Cryptography | no | No new encrypted columns. |
| V7 Error Handling | yes | Trim failure (ffmpeg exit != 0) throws structured `IpcError`; no partial DB update. Restore failure (missing original file) throws `IPC_NOT_FOUND`; no DB update. |
| V9 Communications | yes | No new network calls — localhost HTTP bound to 127.0.0.1 (existing PreviewServer pattern). |
| V10 Malicious Code | yes | Trim subprocess argv is built by `buildTrimArgs()` (pure function); renderer cannot inject extra ffmpeg flags. Screenshot file write goes through `path.join(app.getPath('userData'), procedureId, 'screenshots', tsMs + '.jpg')` — no user-supplied path components. |
| V11 Business Logic | yes | Trim disabled on `procedure.status === 'partial'` (D-13); restore requires non-null `video_path_original`; screenshot delete is hard `DELETE` with no soft-delete column. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer spoofs `timestamp_in_video` (writes a future ms beyond the procedure's actual duration) | Tampering | Main validates `ts >= 0` and (where applicable) `ts <= procedure.durationSeconds * 1000`; no upper bound on mid-procedure capture (Date.now() drift is acceptable). |
| Renderer deletes another doctor's screenshot | Tampering | `requireSession()` + `screenshotsRepo.delete` joins to `procedures` row → cross-patient screenshot delete requires the user to be in a session that owns the procedure (audit row carries `userId` + `entityId: procedureId`). |
| Renderer overwrites arbitrary `video_path` via trim | Tampering | `applyTrim()` always writes to `<basename>-trimmed.mp4` (server-controlled sibling path). Renderer cannot specify the output filename. |
| Renderer truncates the recording via negative trim range | Denial of Service | Trim rejects `inMs < 0`, `outMs <= inMs`, `outMs > duration`. |
| Renderer crashes the recording via screenshot delete storm | Denial of Service | Schema has no soft-delete column; per-screenshot delete is one prepared statement. Audit row + JPEG file unlink. No rate-limit needed for v1 (clinic-scale usage is low). |
| Drag handler injects code via crafted touch points | Tampering | Pointer Events fire on the same captured element; no `eval`, no `dangerouslySetInnerHTML`. |
| Range request attack on the PreviewServer `/media/` route | Information Disclosure | Route resolves the path via `path.join` and rejects paths that escape `<userData>/data/media/...` (validate resolved path is inside the allowed root). |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/05-screenshots-procedure-review-trim/05-CONTEXT.md` — locked D-01..D-13; agent's discretion + deferred ideas verbatim.
- `.planning/phases/04-recording-timer-device-lost/04-CONTEXT.md` — Phase 4 D-03 (partial.mp4 + sidecar), D-09 (notes), D-10 (canonical timer), D-11 (procedure_segments + concat) carry forward.
- `.planning/research/STACK.md` — locked stack; ffmpeg-static, better-sqlite3, @react-pdf/renderer, Ed25519.
- `.planning/research/PITFALLS.md` — Pitfall 1 (corrupt mp4 + trim ±500ms), Pitfall 6 (file:// in sandboxed renderer), Performance Traps (per-row re-render), Integration Gotchas (mp4 + Range).
- `.planning/research/ARCHITECTURE.md` — Pattern 3 (ffmpeg child supervision), Anti-Pattern 2 (userData-relative paths), Anti-Pattern 5 (no ffmpeg reuse), Anti-Pattern 4 (no optimistic UI), Data Flow §3 (procedure lifecycle).
- `.planning/research/SUMMARY.md` — Phase 5 implications: native `<video>` + canvas snapshots, no exotic deps.
- `.opencode/skills/electron-ffmpeg/SKILL.md` — §1 (two-path architecture), §4 (spawn + supervisor), §5 (IPC wiring), §7 (screenshot from preview — Phase 5 deferred-to-realized this).
- `.opencode/skills/electron-sqlite/SKILL.md` — Migration runner; Phase 5 adds `0003_screenshots_and_trim.sql`.
- `.opencode/skills/electron-vite/SKILL.md` — Three-process model; IPC contract via contextBridge; preload bridge surface.
- Existing codebase:
  - `src/main/recorder/recorder.ts` — Phase 4 supervisor; the trim subprocess inherits the same `defaultFfmpegPath()` + `windowsVerbatimArguments: true` + `stdio` config.
  - `src/main/recorder/preview-server.ts` — MJPEG-over-HTTP bridge; Phase 5 extends with a `/media/` route.
  - `src/main/recorder/concat.ts` — `buildConcatArgs` + `writeConcatList`; the trim subprocess reuses the same pure-function + spawn shape.
  - `src/main/recorder/ffmpeg-args.ts` — Phase 4 args builder; Phase 5 adds `buildTrimArgs`.
  - `src/main/recorder/device-lost.ts` — `parseLastKnownTimestampMs` (currently used for the partial mp4 heuristic); the trim path doesn't depend on this but the partial-gate does.
  - `src/main/db/migrations.ts` — append-only migration runner; Phase 5 adds `0003_screenshots_and_trim.sql`.
  - `src/main/db/procedures-repo.ts` — Phase 4 repo; Phase 5 extends with `updateVideoPath` + `setOriginalVideoPath` + `restoreFromOriginal`.
  - `src/main/ipc/procedures.ts` — Phase 4 IPC; Phase 5 extends with `trim` + `restore` handlers.
  - `src/main/ipc/recording.ts` — Phase 4 IPC; not changed by Phase 5 (recording surface is final).
  - `src/main/paths.ts` — `procedureMediaDir` helper; Phase 5 adds `screenshotsDir` returning the same dir + `/screenshots/`.
  - `src/shared/ipc-contract.ts` — typed IPC contract; Phase 5 extends with `Screenshot` + `TrimRequest/TrimResult` entity types and IPC constants.
  - `src/shared/validators.ts` — zod schemas; Phase 5 adds screenshot + trim + restore schemas.
  - `src/renderer/src/pages/ProcedureRoom.tsx` — Phase 4 recording UI; Phase 5 adds Screenshot button + S hotkey.
  - `src/renderer/src/pages/ProcedureReview.tsx` — Phase 4 placeholder; Phase 5 rewrites.
  - `src/renderer/src/components/RecordingControlsBar.tsx` — Phase 4 floating overlay; visual language for Phase 5 right rail.
  - `src/renderer/src/store/route.ts` + `src/renderer/src/lib/router.ts` — `'procedure-review'; procedureId` route already wired.

### Secondary (MEDIUM confidence)
- MDN HTMLCanvasElement.toBlob + drawImage docs (Context7 fetch) — `canvas.toBlob(callback, 'image/jpeg', quality)` signature; `drawImage(videoEl, 0, 0, w, h)` is the canonical snapshot pattern.
- better-sqlite3 docs/api.md + tips.md (Context7 fetch) — `db.exec()` for SQL strings; `INSERT OR IGNORE` pattern for `(procedure_id, segment_index)` UNIQUE (mirrors Phase 4's pattern for `procedure_segments`).
- ffmpeg-formats.html (webfetch) — `concat` demuxer; `-ss BEFORE -i` for stream copy + fast seek.
- Existing Phase 4 RESEARCH.md + SUMMARY.md — supervisor state machine, ffmpeg-static packaging, asarUnpack pattern.

### Tertiary (LOW confidence)
- W3C Pointer Events API spec (general knowledge; W3C Recommendation since 2018-2019; ubiquitous in modern browsers as of 2026). The `setPointerCapture` pattern is well-documented in the W3C Pointer Events Level 3 spec.
- Drag-handle UX patterns (general knowledge; YouTube-style scrubber + trim handles is a common pattern in video editors; no single canonical reference).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; locked by PROJECT.md + Phase 4.
- Architecture: HIGH — extends Phase 4 patterns one-to-one; trim subprocess is a thin wrapper over concat.
- Schema: HIGH — D-05 + ALTER; SQLite FK + nullable column rules verified.
- Canvas snapshot: HIGH — MDN verified; browser-native, zero deps.
- localhost HTTP for review `<video>`: HIGH — extends the existing PreviewServer; same lifecycle.
- Scrubber Pointer Events: MEDIUM — W3C standard, ubiquitous, but no single canonical reference for the exact trim-handle UX; the pattern is straightforward and well-understood.
- Trim `-ss before -i -c copy` accuracy: HIGH — ffmpeg docs verified; ±500ms accepted per PITFALLS §1.
- UAT test surface: HIGH — same Vitest + dependency-injection patterns as Phase 4; trim integration test runs a real ffmpeg against a lavfi source.

**Research date:** 2026-08-06
**Valid until:** 2026-09-06 (30 days; stable stack, no fast-moving deps)

---

*Phase: 5-screenshots-procedure-review-trim*