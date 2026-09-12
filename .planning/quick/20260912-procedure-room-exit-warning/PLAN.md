---
slug: procedure-room-exit-warning
created: 2026-09-12
type: polish
source: ad-hoc user report (procedure room → "back to preview" during recording silently navigates away + no warning on app close while recording)
---

# Quick Task: procedure room exit warning during recording

## Issues

1. **"Back to Preview" silently navigates away during recording.**
   When the doctor has started recording in the procedure room and
   clicks the header "Back to Preview" button, they currently jump
   straight to the procedure-preview page with no confirmation. The
   recorder is still running in the background, but the UI has left
   the live-recording context — confusing + easy to lose track of an
   in-flight recording. The doctor wants a warning dialog with
   "Continue recording" (stay) / "Stop recording & finalize" (yes,
   stop).

   Currently the button is also hidden while recording (replaced by
   the keyboard-shortcuts hint). The doctor wants the button visible
   at all times so they can leave the room deliberately when they
   want.

2. **No app-close guard while recording.** If the doctor closes the
   app window during a recording, the recorder finalizes as
   'partial' (per D-03) without any prompt. The doctor wants the
   same "Continue recording" / "Stop recording & finalize" choice on
   app close so the recording only ends when they say so.

## Approach

### Renderer side (`src/renderer/src/pages/ProcedureRoom.tsx`)

- Drop the `!isRecording ? <Button>Back to Preview : <ShortcutsHint>`
  branch — show the "Back to Preview" button at all times AND keep
  the keyboard-shortcuts hint as a separate sibling (currently the
  shortcuts replace it; move them to a sidebar/footer or just keep
  them as a secondary line).
- When the button is clicked and `isRecording` is true, open a
  `ConfirmDialog` (existing component) instead of navigating.
  Dialog options:
    - "Continue recording" → `onCancel` (close dialog, stay).
    - "Stop recording & finalize" → call the existing
      `handleRecordToggle()` (which already calls
      `window.api.recording.stop`). The existing
      `useEffect` on `recordingState.status === 'stopped'` already
      navigates to `procedure-review`, so the "stop & exit" path
      lands the doctor on the review screen with the recording
      finalized cleanly.
- When the button is clicked and NOT recording, navigate as today.
- Add a `beforeunload` listener on `window` while the component is
  mounted and a recording is active. The browser's native prompt
  blocks the close; if the user confirms, we let the close proceed
  (main process handles the finalization).

### Main process side (`src/main/index.ts`)

- Hook `mainWindow.on('close', ...)` to intercept the close.
- Look up `recorderRegistry` for any active recorder whose state is
  `'recording' | 'paused' | 'lost' | 'starting' | 'stopping'`.
- If any active recorder exists, `event.preventDefault()` and
  `dialog.showMessageBox` with the same wording as the renderer
  dialog ("Continue recording" / "Stop recording & finalize"). On
  "Stop recording & finalize", call `recorder.stop()` for each
  active recorder, then `mainWindow.destroy()` (or
  `mainWindow.close()` with a re-entrancy guard so the close
  handler doesn't loop). On "Continue recording", do nothing — the
  window stays open.
- If NO active recorder, let the close proceed normally (existing
  `app.on('window-all-closed')` path).

## Files

- `src/renderer/src/pages/ProcedureRoom.tsx` — keep the
  "Back to Preview" button visible while recording; wire
  `ConfirmDialog` + `beforeunload` listener.
- `src/main/index.ts` — `mainWindow.on('close')` interceptor +
  `dialog.showMessageBox` + active-recorder stop.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `npx vitest run tests/renderer/pages/procedure-room.test.tsx
  tests/renderer/pages/procedure-room-timer.test.tsx
  tests/main/ipc/recording.test.ts` → all green.
- Manual:
  - Procedure Room → click Start recording → recording starts →
    click "Back to Preview" → ConfirmDialog opens with the two
    options.
  - Click "Continue recording" → dialog closes, still in Procedure
    Room, timer keeps ticking.
  - Click "Back to Preview" again → click "Stop recording &
    finalize" → recording stops, navigates to ProcedureReview.
  - Procedure Room → start recording → close the app window →
    native dialog asks "Continue recording" / "Stop recording &
    finalize". Pick Continue → recording keeps running, window
    stays. Pick Stop → recording finalizes cleanly, window closes.

## Out of scope

- Sidebar navigation guard (Patients / Settings / etc. links
  during recording). The doctor specifically called out
  "Back to Preview" + app close. A full nav-guard is a separate
  task if needed.
- Auto-save / unsaved-changes-style warning for the
  procedure notes textarea.