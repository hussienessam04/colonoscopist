// Per-thumbnail annotation input. Click the caption area to open an inline
// `<input>`. Enter saves; Escape cancels; blur saves if the value changed.
// The `e.stopPropagation()` calls prevent the parent thumbnail's click
// handler (which seeks the video) from firing when the annotation UI is
// touched.
//
// The onSave callback is supplied by the parent — ProcedureReview wires it
// to `useProcedures.updateAnnotation` (or the legacy useScreenshotIntake
// IPC route) which round-trips through `screenshots.updateAnnotation`.
//
// PITFALLS §7 — timestamps round to nearest ms on save so click-to-seek
// from a thumbnail lands within 1ms of the original capture point.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Screenshot } from '@shared/ipc-contract';

export type ScreenshotAnnotationProps = {
  screenshot: Screenshot;
  onSave: (annotation: string | null) => Promise<void>;
  testId?: string;
};

const MAX_LEN = 1000;

export function ScreenshotAnnotation({
  screenshot,
  onSave,
  testId,
}: ScreenshotAnnotationProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(screenshot.annotation ?? '');
  const lastSavedRef = useRef<string>(screenshot.annotation ?? '');

  useEffect(() => {
    // Keep local state in sync when the screenshot row updates from outside
    // (e.g. an undo restore or a parent refetch).
    if (!editing) {
      setValue(screenshot.annotation ?? '');
      lastSavedRef.current = screenshot.annotation ?? '';
    }
  }, [screenshot.annotation, editing]);

  async function handleSave(next: string): Promise<void> {
    const trimmed = next.trim();
    const nextValue: string | null = trimmed.length === 0 ? null : trimmed.slice(0, MAX_LEN);
    if (nextValue === lastSavedRef.current) {
      setEditing(false);
      return;
    }
    try {
      await onSave(nextValue);
      lastSavedRef.current = nextValue ?? '';
    } finally {
      setEditing(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSave(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setValue(lastSavedRef.current);
      setEditing(false);
    }
  }

  function handleBlur(): void {
    void handleSave(value);
  }

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        maxLength={MAX_LEN}
        aria-label="Annotate screenshot"
        data-testid={testId ?? 'screenshot-annotation-input'}
        className="text-xs w-full border border-slate-300 rounded px-1 py-0.5 bg-white text-slate-900"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      aria-label="Annotate screenshot"
      data-testid={testId ?? 'screenshot-annotation-caption'}
      className="block w-full truncate text-left text-[10px] text-slate-600 hover:text-slate-900"
    >
      {screenshot.annotation ? screenshot.annotation : 'Add annotation…'}
    </button>
  );
}
