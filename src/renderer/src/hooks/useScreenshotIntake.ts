// useScreenshotIntake — renderer-side hook for both screenshot entry points:
//   1. ProcedureRoom S hotkey + Camera button (mid-procedure) — captures
//      the live <img> preview frame. `isRecording=true`.
//   2. ProcedureReview +Capture button (post-recording) — captures the
//      current <video> playback frame. `isRecording=false`.
//
// timestampInVideoMs is computed differently per source:
//   * mid-procedure: Date.now() - startedAt (D-05 — ms since procedure start)
//   * playback:      Math.round(source.currentTime * 1000) (PITFALLS §7)
//
// ponytail: no setInterval / no event subscriptions — the parent owns
// the videoRef and is responsible for updating currentTime when playback
// advances. The hook is just a transport for the capture action.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Screenshot } from '@shared/ipc-contract';
import { captureScreenshot } from '@/lib/capture-screenshot';

export type ScreenshotIntakeOptions = {
  procedureId: string;
  sourceRef: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
  isRecording: boolean;
  startedAt: number | null;
};

export type ScreenshotIntakeResult = {
  screenshots: Screenshot[];
  capture: () => Promise<Screenshot | null>;
  remove: (screenshotId: number) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

export function useScreenshotIntake({
  procedureId,
  sourceRef,
  isRecording,
  startedAt,
}: ScreenshotIntakeOptions): ScreenshotIntakeResult {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Initial load + procedure id reset.
  useEffect(() => {
    if (!procedureId) return;
    let cancelled = false;
    setLoading(true);
    void window.api.screenshots
      .list({ procedureId })
      .then((rows) => {
        if (!cancelled) setScreenshots(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const capture = useCallback(async (): Promise<Screenshot | null> => {
    if (!procedureId) return null;
    if (inFlightRef.current) return null;
    const source = sourceRef.current;
    if (!source) return null;
    if (source instanceof HTMLVideoElement && source.readyState < 2) {
      // Video metadata not loaded yet — nothing meaningful to capture.
      return null;
    }
    inFlightRef.current = true;
    try {
      const { base64 } = await captureScreenshot(source);
      const timestampInVideoMs =
        isRecording && startedAt !== null
          ? Math.max(0, Date.now() - startedAt)
          : source instanceof HTMLVideoElement
            ? Math.max(0, Math.round(source.currentTime * 1000))
            : Math.max(0, Date.now() - (startedAt ?? Date.now()));
      const created = await window.api.screenshots.add({
        procedureId,
        timestampInVideoMs,
        jpegBase64: base64,
      });
      setScreenshots((prev) => [...prev, created]);
      return created;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Capture failed');
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [procedureId, sourceRef, isRecording, startedAt]);

  const remove = useCallback((screenshotId: number): void => {
    // ponytail: pure local-state mutation. The IPC delete is the
    // toast-store's job (after the 5s undo window). The page calls
    // remove() synchronously before enqueueDelete() so the thumbnail
    // disappears immediately (G-05-13).
    setScreenshots((prev) => prev.filter((s) => s.id !== screenshotId));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!procedureId) return;
    setLoading(true);
    try {
      const rows = await window.api.screenshots.list({ procedureId });
      setScreenshots(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [procedureId]);

  return { screenshots, capture, remove, refresh, loading, error };
}
