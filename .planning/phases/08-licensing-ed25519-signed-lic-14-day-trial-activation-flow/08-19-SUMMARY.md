# Phase 8 Plan 19: getBlob IPC ArrayBuffer Fix Summary

**One-liner:** Closes G-08-12 ("browser rejected blob") — main-side handler now returns a fresh `ArrayBuffer` instead of a Buffer-backed `Uint8Array` view, so the bytes survive IPC structured clone cleanly and the browser loads the JPEG.

## Files Touched

### Source (1 file modified, 1 contract, 2 components)
- `src/main/ipc/screenshots.ts` — getBlob handler copies bytes into a fresh `ArrayBuffer` (was `new Uint8Array(bytes)` over the Node `Buffer`); added comment explaining why the copy is required.
- `src/shared/ipc-contract.ts` — `ScreenshotGetBlobResult.bytes` is now `ArrayBuffer` (was `Uint8Array`); comment expanded with the G-08-12 root cause.
- `src/renderer/src/components/ScreenshotCropModal.tsx` — wraps `result.bytes` (ArrayBuffer) in `new Uint8Array(bytes)` for `Blob` construction; previous defensive copy pattern (`new Uint8Array(length)` + `.set()`) replaced with a plain view since the underlying buffer is now clean.
- `src/renderer/src/components/ScreenshotLightbox.tsx` — same change; comment updated.

### Tests (1 new file + 3 modified)
- `tests/main/screenshots/get-blob.test.ts` (new) — 3 cases:
  - **Happy path** — writes real JPEG bytes, asserts `result.bytes instanceof ArrayBuffer`, byte length matches, bytes round-trip byte-for-byte, mimeType === `'image/jpeg'`.
  - **Not found** — invalid id returns `{ok: false, code: 'IPC_SCREENSHOT_NOT_FOUND'}`.
  - **Corrupted** — file deleted between row insert + IPC call → throws (IPC error path).
- `tests/renderer/setup.ts` — default `getBlob` mock returns `bytes: new Uint8Array(...).buffer` (was `Uint8Array`).
- `tests/renderer/components/screenshot-crop-modal.test.tsx` — per-test mock `getBlob` returns ArrayBuffer; added new test for empty-bytes diagnostic ("browser rejected blob" via `<img onError>`).
- `tests/renderer/components/ScreenshotLightbox.test.tsx` — per-test mocks return ArrayBuffer.

## Verification

```
npm run typecheck:node  → pre-existing errors only (Report redesign WIP, unrelated)
npm run typecheck:web   → pre-existing errors only (Report redesign WIP, unrelated)

node scripts/run-vitest.cjs --run \
  tests/main/screenshots/ \
  tests/renderer/components/screenshot-crop-modal.test.tsx \
  tests/renderer/components/ScreenshotLightbox.test.tsx

Test Files  4 passed (4)
     Tests  43 passed (43)
  - tests/main/screenshots/get-blob.test.ts          3/3 pass
  - tests/main/screenshots/crop.test.ts              5/5 pass (no regression)
  - tests/renderer/components/screenshot-crop-modal.test.tsx  30/30 pass (29 prior + 1 new)
  - tests/renderer/components/ScreenshotLightbox.test.tsx       5/5 pass
```

The typecheck errors that surfaced are all pre-existing (verified by `git stash` + re-run on clean tree) — they reference the in-progress Report redesign (quick task `20260812-redesign-report-procedure-type`) which is being tracked separately and is out of scope for this plan.

## Deviations

**1. Plan: "renderer code uses `new Uint8Array(result.bytes)`". The previous renderer code already had a defensive pattern (`new Uint8Array(result.bytes.byteLength)` + `bytes.set(result.bytes)`) that was a workaround for a typing concern about `Uint8Array<ArrayBufferLike>` vs `BlobPart`. With the new ArrayBuffer contract the buffer is guaranteed clean, so the simpler `new Uint8Array(result.bytes)` (view) is sufficient — the defensive copy is dead weight. Used the plan's pattern.**

**2. Test approach: the plan suggested mocking via `createBlob({bytes: new ArrayBuffer(0)})` as part of an existing helper, but the renderer test file has no such helper — wrote the test inline using `mockResolvedValue({ok:true, bytes:new ArrayBuffer(0), ...})` and `fireEvent.error(img)` to trigger the `<img onError>` handler that surfaces the "browser rejected blob" diagnostic. happy-dom doesn't actually fetch the blob URL, so the manual `fireEvent.error` is required to drive the diagnostic code path.**

## What Was NOT Changed

- No security surface change. `ArrayBuffer` crosses the contextBridge identically to `Uint8Array` (per threat model in PLAN.md, T-08-19-T1 accept).
- No new IPC channels.
- No renderer-side architectural change.
- `src/renderer/src/pages/ReportEditor.tsx` continues to use `result.bytes as Uint8Array<ArrayBuffer>` for the separate `reports.getPdfBlob` channel (which is still Uint8Array — out of scope for this plan).
- STATE.md / ROADMAP.md — orchestrator owns these writes.

## Atomic Commits

| Commit  | Hash      | Message |
|---------|-----------|---------|
| 1       | `b451287` | fix(08-19): getBlob IPC returns fresh ArrayBuffer (fixes 'browser rejected blob') |
| 2       | `d7abe6f` | test(08-19): getBlob IPC round-trip test + crop modal ArrayBuffer mock update |
| 3       | `<this>`  | docs(08-19): complete Plan 19 - getBlob ArrayBuffer fix + SUMMARY |