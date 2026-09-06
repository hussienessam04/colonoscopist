---
task: procedure room ui need to polish and enhance for example make the taken screenshoots in the end of the page instead of in the right
task_count: 1
mode: quick
type: execute
files_modified:
  - src/renderer/src/pages/ProcedureRoom.tsx
autonomous: true
---

<objective>
Move the mid-procedure screenshot gallery from the right-hand sidebar to
the bottom of the ProcedureRoom page so it sits as a full-width strip
below the video preview + side-panel grid, instead of being crammed into
the narrow notes column.

Why: a gloved doctor wants the gallery wider than 20rem to read thumbnails
without leaning; and keeping the screenshots where the eye scans after the
preview matches how the ProcedureReview page already lays them out (full
width under the scrubber).
</objective>

<context>
@.planning/PROJECT.md
@AGENTS.md
@src/renderer/src/pages/ProcedureRoom.tsx
@src/renderer/src/components/ScreenshotTimeline.tsx
@src/renderer/src/components/procedure-notes-panel.tsx
@tests/renderer/pages/procedure-room-timer.test.tsx
</context>

<must_haves>
- Screenshot gallery renders as a full-width strip below the main video + side-panel grid, NOT inside the right-hand `<aside>`.
- Gallery mount gate unchanged: only mounts when `isRecording || screenshotIntake.screenshots.length > 0` (so the empty-state stays clean).
- Gallery test seams stay intact: `data-testid="procedure-room-gallery"` (on `<ScreenshotTimeline>`) + `data-testid="procedure-room-gallery-section"` (on the new wrapper `<section>`).
- Notes panel + device-lost banner stay in the right-hand `<aside>`; the collapse toggle behavior is unchanged.
- Layout responsive: at `lg`+ the grid is still two columns; at smaller widths it stacks. The new gallery strip spans full width at every breakpoint.
- Existing tests still pass (gallery testid still finds the timeline).
</must_haves>

<tasks>

<task type="auto">
  <name>Move screenshot gallery from sidebar to bottom strip</name>

<files>
- src/renderer/src/pages/ProcedureRoom.tsx
</files>

<action>

Current layout (lines 326–459 of `ProcedureRoom.tsx`):

```tsx
<section className={`grid ... ${notesCollapsed ? '1fr' : '1fr 20rem'}`}>
  <div className="overflow-hidden rounded-xl border border-slate-800 bg-black shadow-2xl">
    {/* video + controls */}
  </div>

  {!notesCollapsed ? (
    <aside className="flex flex-col gap-5 ...">
      <div>Side panel header + Hide button</div>
      <ProcedureNotesPanel procedureId={procedureId} />
      <DeviceLostBanner ... />
      {isRecording || screenshotIntake.screenshots.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="procedure-room-gallery-section">
          <h3>Captured screenshots</h3>
          <ScreenshotTimeline testId="procedure-room-gallery" ... />
        </div>
      ) : null}
    </aside>
  ) : (
    <div>Show notes button</div>
  )}
</section>
```

New layout:

1. **Strip the gallery out of the `<aside>`.** The aside now contains only the side-panel header, the notes panel, and the device-lost banner — same as before minus the gallery block. The collapse-button copy stays "Hide notes" / "Show notes" (it's about the notes panel; the gallery is its own thing now).

2. **Add a new `<section>` AFTER the existing grid section, inside the outer `<div className="mx-auto flex max-w-7xl flex-col gap-5">`.** The new section:

```tsx
{isRecording || screenshotIntake.screenshots.length > 0 ? (
  <section
    className="rounded-xl border bg-card p-5 shadow-sm"
    data-testid="procedure-room-gallery-section"
  >
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Captured screenshots
      </h2>
      <span className="text-xs text-muted-foreground" data-testid="procedure-room-gallery-count">
        {screenshotIntake.screenshots.length} capture{screenshotIntake.screenshots.length === 1 ? '' : 's'}
      </span>
    </div>
    <ScreenshotTimeline
      procedureId={procedureId ?? ''}
      patientId={patientIdFromRoute}
      mediaBaseUrl={mediaUrl.url}
      status={isRecording ? 'recording' : 'completed'}
      screenshots={screenshotIntake.screenshots}
      onSeek={() => undefined}
      onCapture={() => { void handleScreenshotCapture(); }}
      onDelete={handleScreenshotDelete}
      testId="procedure-room-gallery"
    />
  </section>
) : null}
```

Notes on the section:

- `data-testid="procedure-room-gallery-section"` stays on the wrapping element so the test seam doesn't change. The screenshot-thumbnail contract-guard test (`procedure-room-timer.test.tsx:606`) calls `screen.findByTestId('procedure-room-gallery')` which is on the inner `<ScreenshotTimeline>` (testId prop, line 190 of ScreenshotTimeline.tsx) — unchanged.
- The `<h2>` is bumped from `<h3>` (it was a third-level heading under the aside's "Side panel" label; now it's a top-level section under the page heading).
- Adding a small `{count} capture(s)` badge on the right makes the strip feel intentional (vs. accidentally orphaned). Reads from `screenshotIntake.screenshots.length`.
- `mediaUrl.url` is already in scope (line 159 of current file); no new hooks.

3. **Polish the page header — small.** While we're here, add `data-testid="procedure-room-shortcuts"` to the shortcuts `<span>` so a future contract-guard test can target it (optional; skip if it bloats the diff).

4. **No other file changes.** The ScreenshotTimeline component itself is fine; the change is purely layout. ProcedureNotesPanel / DeviceLostBanner unchanged. Sidebar collapse logic unchanged.

</action>

<verify>
<automated>npm run test:unit -- --run tests/renderer/pages/procedure-room-timer.test.tsx tests/renderer/pages/procedure-room.test.tsx && npx tsc -p tsconfig.web.json --noEmit</automated>
</verify>

<done>
- `src/renderer/src/pages/ProcedureRoom.tsx` renders the gallery as a full-width `<section>` after the main grid; the aside contains only notes + device-lost banner.
- `data-testid="procedure-room-gallery-section"` + `data-testid="procedure-room-gallery"` test seams preserved.
- `npm run test:unit` for the procedure-room tests passes; `tsc -p tsconfig.web.json` exits 0.
</done>

<commit>feat(procedure-room): move mid-procedure screenshot gallery from sidebar to bottom strip</commit>
</task>

</tasks>

<verification>
- `npm run test:unit -- --run tests/renderer/pages/procedure-room-timer.test.tsx tests/renderer/pages/procedure-room.test.tsx` exits 0.
- `npx tsc -p tsconfig.web.json --noEmit` exits 0.
- Visual: open the app, start a recording, hit `S` twice. The gallery renders as a full-width strip below the video + notes grid, not inside the right column.
- Collapse the notes panel — the gallery stays visible (it no longer depends on `notesCollapsed`).
</verification>

<success_criteria>
- Gallery is full-width under the main grid, not crammed into the right column.
- Gallery mount gate unchanged (`isRecording || screenshots.length > 0`).
- Notes + device-lost banner stay in the right aside.
- All existing tests pass; no testid renames.
</success_criteria>

<output>
Single atomic commit + a SUMMARY.md update with the diff + a STATE.md row.
</output>