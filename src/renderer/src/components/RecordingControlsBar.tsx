// RecordingControlsBar — floating overlay shown over the live preview during
// a recording. Composes the timer, the primary Record/Stop button, and the
// Pause/Resume button. Designed so the doctor's eyes stay on the screen —
// the controls live inside the preview pane, not below it.
//
// Extracted from ProcedureRoom so both pages (preview + recording) can share
// the same visual language. Renders absolutely-positioned at the bottom of
// its parent; parent must be `relative`.
//
// Quick task 20260912-procedure-room-ui-enhance — retinted from the
// slate-950/60 frosted glass to a clinical ivory card so the bar
// reads as part of the app's design system (teal accents on warm
// ivory) rather than fighting the live preview. The duration + pause
// stack stays mono for the clinical-instrument feel.

import { Camera, CircleStop, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type RecordingControlsBarProps = {
  isRecording: boolean;
  recordingBusy: boolean;
  isPaused: boolean;
  canRecord: boolean;
  startInFlight: boolean;
  timerLabel: string;
  pauseCount: number;
  startError: string | null;
  onRecordToggle: () => void;
  onPauseResumeToggle: () => void;
  // Phase 5 / Plan 01 — Camera (screenshot) button. Wired only while
  // isRecording is true; the parent owns the state for the disabled
  // gating so the bar stays presentational.
  onCapture?: () => void;
};

export function RecordingControlsBar({
  isRecording,
  recordingBusy,
  isPaused,
  canRecord,
  startInFlight,
  timerLabel,
  pauseCount,
  startError,
  onRecordToggle,
  onPauseResumeToggle,
  onCapture,
}: RecordingControlsBarProps): JSX.Element {
  return (
    <div
      // ponytail: sit at the bottom of the preview pane. ivory card
      // with hairline border + a soft teal shadow so the buttons
      // stay readable over the dark video without competing with
      // the new instrument status strip on top.
      className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[#E0D9C6] bg-[#FBF7EE]/95 px-4 py-3 text-[#13202E] shadow-[0_12px_28px_-16px_rgba(14,58,71,0.45)] backdrop-blur"
      data-testid="recording-controls-bar"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]">
          Duration
        </p>
        <p
          aria-label="Procedure duration"
          className="font-mono text-2xl tabular-nums leading-none text-[#0E3A47]"
          data-testid="procedure-duration"
        >
          {timerLabel}
        </p>
        {pauseCount > 0 && isRecording ? (
          <p
            className="text-[10px] text-[#8C8478]"
            data-testid="pause-count"
            aria-label={`Pause count: ${pauseCount}`}
          >
            Pause #{pauseCount}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isRecording ? (
          <Button
            // Quick task 20260912-procedure-room-ui-enhance —
            // stop uses the app's coral primary action color
            // (matches the report editor's Finalize button) so
            // it's recognizable as a "stop & finalize" action
            // without being a generic Tailwind destructive red.
            className="bg-[#C66B4D] text-white hover:bg-[#B25A3D] focus-visible:ring-[#C66B4D]/40"
            onClick={onRecordToggle}
            disabled={recordingBusy}
            data-testid="stop-recording-button"
            aria-label="Stop recording (Esc)"
            aria-keyshortcuts="Escape"
          >
            <CircleStop aria-hidden="true" />
            Stop Recording
          </Button>
        ) : (
          <Button
            // ponytail: deep teal primary action — same color as
            // every other primary CTA across the app (Save,
            // Finalize, Apply, etc.). Visual consistency with
            // the rest of the product.
            className="bg-[#0E3A47] text-white hover:bg-[#0a2d38] focus-visible:ring-[#0E3A47]/40"
            onClick={onRecordToggle}
            disabled={!canRecord || recordingBusy || startInFlight}
            data-testid="record-button"
            aria-label="Start recording (R)"
            aria-keyshortcuts="R"
          >
            <CircleStop aria-hidden="true" />
            Start Recording
          </Button>
        )}
        {isRecording && !isPaused ? (
          <Button
            variant="outline"
            onClick={onPauseResumeToggle}
            disabled={recordingBusy}
            data-testid="pause-button"
            aria-label="Pause (Space)"
            aria-keyshortcuts="Space"
            className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
          >
            <Pause aria-hidden="true" />
            Pause
          </Button>
        ) : isPaused ? (
          <Button
            variant="outline"
            onClick={onPauseResumeToggle}
            disabled={recordingBusy}
            data-testid="resume-button"
            aria-label="Resume (Space)"
            aria-keyshortcuts="Space"
            className="border-[#0E3A47] bg-[#E6EFF1] text-[#0E3A47] hover:border-[#0E3A47] hover:bg-[#dbe7e9]"
          >
            <Play aria-hidden="true" />
            Resume
          </Button>
        ) : null}
        {isRecording && onCapture ? (
          <Button
            variant="outline"
            onClick={onCapture}
            disabled={recordingBusy}
            data-testid="capture-screenshot-button"
            aria-label="Capture screenshot (S)"
            aria-keyshortcuts="S"
            className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
          >
            <Camera aria-hidden="true" />
            Capture
          </Button>
        ) : null}
      </div>

      {startError ? (
        <p
          role="alert"
          className={cn('basis-full text-xs text-[#C66B4D]')}
          data-testid="start-error"
        >
          {startError}
        </p>
      ) : null}
    </div>
  );
}