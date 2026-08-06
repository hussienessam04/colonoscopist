// RecordingControlsBar — floating overlay shown over the live preview during
// a recording. Composes the timer, the primary Record/Stop button, and the
// Pause/Resume button. Designed so the doctor's eyes stay on the screen —
// the controls live inside the preview pane, not below it.
//
// Extracted from ProcedureRoom so both pages (preview + recording) can share
// the same visual language. Renders absolutely-positioned at the bottom of
// its parent; parent must be `relative`.

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
      // ponytail: sit at the bottom of the preview pane. backdrop-blur
      // keeps the buttons readable over the dark video without a solid
      // rectangle that would compete with the preview for attention.
      className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-3 rounded-xl bg-slate-950/60 px-4 py-3 text-white shadow-lg backdrop-blur"
      data-testid="recording-controls-bar"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/80">
          Duration
        </p>
        <p
          aria-label="Procedure duration"
          className="font-mono text-2xl tabular-nums leading-none"
          data-testid="procedure-duration"
        >
          {timerLabel}
        </p>
        {pauseCount > 0 && isRecording ? (
          <p
            className="text-[10px] text-slate-300/80"
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
            variant="destructive"
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
            className="bg-white/10 text-white hover:bg-white/20 border-white/20"
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
            className="bg-white/10 text-white hover:bg-white/20 border-white/20"
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
            className="bg-white/10 text-white hover:bg-white/20 border-white/20"
          >
            <Camera aria-hidden="true" />
            Capture
          </Button>
        ) : null}
      </div>

      {startError ? (
        <p
          role="alert"
          className={cn('basis-full text-xs text-rose-300')}
          data-testid="start-error"
        >
          {startError}
        </p>
      ) : null}
    </div>
  );
}