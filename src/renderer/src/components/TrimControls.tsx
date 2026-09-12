// TrimControls — right-rail action panel for the Procedure Review screen.
// Per D-06 + D-09 + D-13 + Plan 04 — toggles Trim mode, exposes Apply +
// Restore buttons, and shows the live in/out range as HH:MM:SS labels.
//
// Status partial gate: Apply is disabled when `status === 'partial'` so
// the IPC layer's `Cannot trim a partial recording` rejection never
// surfaces (UX-Pitfalls: prevent the failure mode rather than toasting
// about it). Restore is disabled when `videoPathOriginal` is null
// (never been trimmed). Plan 04 also disables Apply when the procedure
// is longer than 30 minutes — the browser's <video> seek-by-keyframe
// is unreliable past that duration; v1.1 can revisit with a re-encode
// path.
//
// Inline status (not a modal) per UX-Pitfalls: Apply + Restore buttons
// show a `Loader2` spinner during the IPC round-trip.
//
// Plan 09 / G-05-12 — adds optional `screenshots`, `videoRef`, and
// `captureFrame` props so the right rail can show in-frame + out-frame
// JPEG previews sourced via `captureScreenshot(videoRef.current)` at the
// current inMs/outMs handles. The `captureFrame` seam lets the test
// substitute a stub returning a fixed base64 string without spinning a
// real <video> decode. All three props are OPTIONAL — the existing
// 9 TrimControls tests don't supply them, and making them required
// would break the suite compilation.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { ProcedureStatus, Screenshot } from '@shared/ipc-contract';

// ponytail: 30 minutes is the cap we set for browser-side seek-by-keyframe
// reliability. Above this, the trim handles drift and the doctor's cuts land
// on the wrong frame. Future phases can offer a re-encode path that lifts
// this ceiling.
const MAX_TRIM_DURATION_MS = 30 * 60 * 1000;

export type TrimControlsProps = {
  status: ProcedureStatus;
  videoPathOriginal: string | null;
  inMs: number;
  outMs: number;
  durationMs: number;
  trimMode: boolean;
  setTrimMode: (on: boolean) => void;
  applying: boolean;
  restoring: boolean;
  apply: () => Promise<void>;
  restore: () => Promise<void>;
  // Plan 09 / G-05-12 — optional preview props. When omitted (the
  // existing test surface never supplies them) the preview block is
  // not rendered and the component degrades to its pre-Plan-09 form.
  screenshots?: Screenshot[];
  videoRef?: RefObject<HTMLVideoElement | null>;
  captureFrame?: (video: HTMLVideoElement, atMs: number) => Promise<string | null>;
};

export function TrimControls({
  status,
  videoPathOriginal,
  inMs,
  outMs,
  durationMs,
  trimMode,
  setTrimMode,
  applying,
  restoring,
  apply,
  restore,
  screenshots: _screenshots,
  videoRef,
  captureFrame,
}: TrimControlsProps): JSX.Element {
  const { t } = useTranslation();
  const overDurationCap = durationMs > MAX_TRIM_DURATION_MS;
  // D-13 — partial recordings disable Apply at the renderer so the
  // IPC's `Cannot trim a partial recording` rejection never surfaces.
  const applyDisabled =
    applying ||
    status === 'partial' ||
    inMs >= outMs ||
    status === 'recording' ||
    status === 'crashed' ||
    overDurationCap;
  // D-09 — Restore only meaningful after a prior trim. The column is
  // null until the first trim lands (COALESCE'd on first trim).
  const restoreDisabled = restoring || videoPathOriginal === null;

  // Plan 09 / G-05-12 — in-frame / out-frame JPEG data URLs. The previews
  // render above the existing In/Out labels so the doctor sees the frame
  // first, then the HH:MM:SS timestamp confirms.
  const [inFrameDataUrl, setInFrameDataUrl] = useState<string | null>(null);
  const [outFrameDataUrl, setOutFrameDataUrl] = useState<string | null>(null);
  // ponytail: per-handle in-flight guard. Concurrent captures for the
  // same handle are skipped until the prior Promise settles — the next
  // effect run after settle picks up the latest inMs/outMs.
  const captureInFlightRef = useRef<{ in: boolean; out: boolean }>({ in: false, out: false });

  useEffect(() => {
    if (!trimMode) {
      setInFrameDataUrl(null);
      setOutFrameDataUrl(null);
      return;
    }
    const video = videoRef?.current;
    if (!video || !captureFrame) return;
    if (!captureInFlightRef.current.in) {
      captureInFlightRef.current.in = true;
      captureFrame(video, inMs)
        .then((data) => {
          captureInFlightRef.current.in = false;
          if (data) setInFrameDataUrl(`data:image/jpeg;base64,${data}`);
        })
        .catch(() => {
          captureInFlightRef.current.in = false;
        });
    }
    if (!captureInFlightRef.current.out) {
      captureInFlightRef.current.out = true;
      captureFrame(video, outMs)
        .then((data) => {
          captureInFlightRef.current.out = false;
          if (data) setOutFrameDataUrl(`data:image/jpeg;base64,${data}`);
        })
        .catch(() => {
          captureInFlightRef.current.out = false;
        });
    }
  }, [trimMode, inMs, outMs, videoRef, captureFrame]);

  return (
    <Card data-testid="trim-controls">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-medium">{t('procedure.trimTitle')}</CardTitle>
        <Button
          variant={trimMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTrimMode(!trimMode)}
          aria-pressed={trimMode}
          data-testid="trim-mode-toggle"
        >
          <Scissors aria-hidden="true" />
          {trimMode ? t('trim.done') : t('procedure.trimTitle')}
        </Button>
      </CardHeader>
      {trimMode ? (
        <CardContent className="flex flex-col gap-2 text-sm">
          {trimMode && (inFrameDataUrl || outFrameDataUrl) ? (
            <div className="flex gap-2" data-testid="trim-previews">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {t('trim.inFrame')}
                </span>
                {inFrameDataUrl ? (
                  <img
                    src={inFrameDataUrl}
                    alt={t('trim.inFrameAlt')}
                    data-testid="trim-in-preview"
                    className="h-16 w-24 rounded border border-slate-300 object-cover"
                  />
                ) : (
                  <div
                    data-testid="trim-in-preview-placeholder"
                    className="h-16 w-24 rounded border border-dashed border-slate-300"
                  />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {t('trim.outFrame')}
                </span>
                {outFrameDataUrl ? (
                  <img
                    src={outFrameDataUrl}
                    alt={t('trim.outFrameAlt')}
                    data-testid="trim-out-preview"
                    className="h-16 w-24 rounded border border-slate-300 object-cover"
                  />
                ) : (
                  <div
                    data-testid="trim-out-preview-placeholder"
                    className="h-16 w-24 rounded border border-dashed border-slate-300"
                  />
                )}
              </div>
            </div>
          ) : null}
          <div className="text-xs text-slate-600" data-testid="trim-range-labels">
            {t('trim.inLabel')}{' '}
            <span className="font-mono" data-testid="trim-in-label">
              {formatDurationHHMMSS(inMs)}
            </span>{' '}
            {t('trim.outLabel')}{' '}
            <span className="font-mono" data-testid="trim-out-label">
              {formatDurationHHMMSS(outMs)}
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void apply();
            }}
            disabled={applyDisabled}
            data-testid="trim-apply"
          >
            {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {t('common.apply')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void restore();
            }}
            disabled={restoreDisabled}
            data-testid="trim-restore"
          >
            {restoring ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {t('procedure.trimRestore')}
          </Button>
          {status === 'partial' ? (
            <p className="text-xs text-muted-foreground">
              {t('trim.unavailableOnPartial')}
            </p>
          ) : null}
          {overDurationCap ? (
            <p className="text-xs text-muted-foreground" data-testid="trim-overduration-note">
              {t('trim.overCapPrefix', { cap: formatDurationHHMMSS(MAX_TRIM_DURATION_MS) })}{' '}
              {t('trim.overCapSuffix')}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
