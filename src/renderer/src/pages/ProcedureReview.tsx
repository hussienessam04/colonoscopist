// Procedure Review — Phase 5 / Plan 03. Per D-10 + D-12 + D-13 — video left,
// scrubber + screenshot timeline below the video, right rail gains the
// read-only Notes accordion + the conditional `<DeviceLostBanner>` for
// partial recordings + the new `<TrimControls>` panel.
//
// Plan 03 wires:
//   - the `/media/` route on the long-lived MediaServer (via useMediaUrl)
//     to source the `<video>` element;
//   - the trim handles on the Scrubber (via useTrim);
//   - the right-rail Trim panel (via TrimControls + useTrim).
//
// D-11 — the Scrubber receives `segments` from `useProcedures` so pause
// markers render as tick marks. The default no-pause case (zero segments)
// renders a clean track.
//
// Quick task 20260907-procedure-review-ui-enhance — page chrome
// refactored to mirror the Report Editor's "clinical workstation"
// palette (warm ivory document card + teal accents + small-caps
// labels + serif h1 + mono date/duration). Only the surrounding
// chrome changes; the data flow + IPC contract + sub-component
// internals (Scrubber, ScreenshotTimeline, TrimControls,
// ProcedureNotesReview, ScreenshotLightbox) are untouched.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DeviceLostBanner from '@/components/device-lost-banner';
import { DestructivePartialAlert } from '@/components/DestructivePartialAlert';
import { Scrubber } from '@/components/Scrubber';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { ScreenshotLightbox } from '@/components/ScreenshotLightbox';
import { ProcedureNotesReview } from '@/components/ProcedureNotesReview';
import { StatusBadge } from '@/components/StatusBadge';
import { TrimControls } from '@/components/TrimControls';
import { useProcedures } from '@/hooks/useProcedures';
import { useReport } from '@/hooks/useReport';
import { useRoute } from '@/store/route';
import { useLastLost, recordingStore } from '@/store/recording';
import { useScreenshotToasts, screenshotToastStore } from '@/store/screenshot-toast';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useTrim } from '@/hooks/useTrim';
import { captureScreenshot } from '@/lib/capture-screenshot';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import { safeInvoke } from '@/lib/ipc-result';
import EmptyStateCard from '@/components/EmptyStateCard';
import type { Patient, Procedure, Screenshot } from '@shared/ipc-contract';

// ponytail: a couple of design tokens lifted verbatim from the
// ReportEditor surface so the two pages read as the same product
// (warm ivory + teal accent + small-caps labels). Kept inline
// rather than promoted to a shared constant — a future
// design-system pass would extract them, but the page surface
// is small enough that duplication beats indirection right now.
const CARD_CHROME =
  "rounded-lg border border-[#E0D9C6] bg-white shadow-sm";
const RAIL_CARD_CHROME =
  "rounded-lg border border-[#E0D9C6] bg-[#E6EFF1] p-4 shadow-sm";
const SMALL_CAPS_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]";
const SMALL_CAPS_FIELD =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]";
const SECONDARY_OUTLINE_BUTTON =
  "border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]";
const PRIMARY_TEAL_BUTTON =
  "bg-[#0E3A47] text-white hover:bg-[#0B2C36] shadow-inner";

function formatTimestamp(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

// Per D-13 — the doctor can play + capture on partial recordings, but Trim
// is disabled (no meaningful cut for a half-formed mp4). For Plan 02 we
// just expose the playback + capture; Trim ships in Plan 03.
function isInteractiveStatus(status: string): boolean {
  return status === 'recording' || status === 'completed' || status === 'partial';
}

// Plan 09 / G-05-12 — seek + capture helper for the TrimControls in/out
// previews. Module-scope so its identity is stable across renders (the
// TrimControls useEffect depends on it). Sets `video.currentTime`, waits
// for the browser to fire `seeked`, then captures via the existing
// `captureScreenshot` lib and returns the base64 bytes. Returns null on
// timeout (1 second) or error so the preview slot stays empty.
async function captureFrameForTrim(
  video: HTMLVideoElement,
  atMs: number,
): Promise<string | null> {
  if (video.readyState < 2) return null;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const onSeeked = (): void => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      void captureScreenshot(video).then(
        (r) => resolve(r.base64),
        () => resolve(null),
      );
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    // 1-second timeout: if seeked never fires (e.g. trim handle out of
    // bounds, video element mid-disposal), resolve null so the preview
    // slot stays empty rather than spinning forever.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      resolve(null);
    }, 1_000);
    video.currentTime = atMs / 1000;
  });
}

export default function ProcedureReview({
  procedureId: initialId,
}: {
  procedureId?: string;
} = {}): JSX.Element {
  const { navigate } = useRoute();
  // ponytail: visible strings flow through t() per Phase 7 i18n
  // contract. The Scrubber + ScreenshotTimeline sub-components own
  // their own labels — this hook only translates the page surface.
  const { t } = useTranslation();
  const route = useRoute().current;
  const routeProcedureId = route.name === 'procedure-review' ? route.procedureId : null;
  const procedureId = initialId ?? routeProcedureId ?? null;

  const {
    procedure,
    segments,
    screenshots,
    refresh,
    removeScreenshot,
    updateAnnotation,
    gated: proceduresGated,
  } = useProcedures(procedureId);
  const { report, refresh: refreshReport } = useReport({ procedureId });
  const lastLost = useLastLost();
  const mediaUrl = useMediaUrl();

  // Fetch the patient row separately so the metadata sidebar shows the
  // full name (procedure.patientId is a UUID, not human-readable).
  const [patient, setPatient] = useState<Patient | null>(null);
  // Plan 08-10 / G-08-4 — gate-rejected flag. Either the local
  // patients.get OR the useProcedures hook may flip it.
  const [patientGated, setPatientGated] = useState(false);
  const gated = patientGated || proceduresGated;
  useEffect(() => {
    if (!procedure?.patientId) {
      setPatient(null);
      setPatientGated(false);
      return;
    }
    let cancelled = false;
    // ponytail: optional-chain `.then` so a mid-render mutation of
    // `window.api` (cascade pollution from a prior test's stashed
    // microtask) cannot crash the render with "Cannot read properties
    // of undefined (reading 'then')". Production callers always seed
    // `window.api` before mount; the optional chain is a defensive
    // zero-cost guard for renderer tests + HMR edge cases.
    const promise = window.api.patients?.get?.(procedure.patientId);
    if (promise && typeof promise.then === 'function') {
      promise
        .then(async (raw) => {
          if (cancelled) return;
          const row = await safeInvoke(Promise.resolve(raw));
          if (cancelled) return;
          if (row === null) {
            setPatientGated(true);
            setPatient(null);
            return;
          }
          setPatient(row);
          setPatientGated(false);
        })
        .catch(() => {
          if (!cancelled) {
            setPatient(null);
            setPatientGated(true);
          }
        });
    } else if (!cancelled) {
      setPatient(null);
    }
    return () => {
      cancelled = true;
    };
  }, [procedure?.patientId]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const durationMs = useMemo(() => {
    if (!procedure) return 0;
    return procedure.durationSeconds * 1000;
  }, [procedure?.durationSeconds]);

  // Plan 03 — trim orchestration. The hook returns inMs/outMs local
  // state + IPC round-trip wiring; the parent passes the updated
  // procedure back to refresh the right-rail metadata.
  const trim = useTrim(procedureId ?? '', durationMs, useCallback((updated: Procedure) => {
    // Refresh procedure + everything else so the new videoPath + the
    // restored videoPath flow through.
    void refresh();
    // Reload the <video> element so the trimmed / restored mp4 plays.
    // The src recomposes below in the effect that depends on
    // procedure.videoPath.
    const v = videoRef.current;
    if (v) v.load();
    void updated;
  }, [refresh]));

  // Compose the media URL. The procedure's `videoPath` is the userData-
  // relative form (e.g. `data/media/patients/<p>/<proc>/video.mp4`);
  // we only want the leaf filename for the MediaServer's `/media/`
  // route.
  const videoSrc = useMemo(() => {
    if (!mediaUrl.url || !procedure?.videoPath) return null;
    const fileName = procedure.videoPath.replace(/^.*[\\/]/, '');
    return `${mediaUrl.url}/media/${procedure.patientId}/${procedure.id}/${fileName}`;
  }, [mediaUrl.url, procedure?.videoPath, procedure?.patientId, procedure?.id]);

  // Reload the <video> element when the src recomposes (post-trim or
  // post-restore). The `procedure.videoPath` dep is the trigger.
  useEffect(() => {
    const v = videoRef.current;
    if (v && videoSrc) {
      v.load();
    }
  }, [videoSrc]);

  // Track video time updates while playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = (): void => {
      setCurrentMs(Math.max(0, Math.round(video.currentTime * 1000)));
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [procedure?.id]);

  const handleSeek = useCallback((ms: number): void => {
    setCurrentMs(ms);
    const video = videoRef.current;
    if (video) {
      video.currentTime = ms / 1000;
    }
  }, []);

  const handleCapture = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video) {
      toast.error(t('procedure.captureFailed'));
      return;
    }
    if (video.readyState < 2) {
      toast.error(t('procedure.captureFailed'));
      return;
    }
    try {
      const { base64 } = await captureScreenshot(video);
      const timestampInVideoMs = Math.max(0, Math.round(video.currentTime * 1000));
      if (!procedure) return;
      await window.api.screenshots.add({
        procedureId: procedure.id,
        timestampInVideoMs,
        jpegBase64: base64,
      });
      toast.success(t('procedure.captureSuccess'));
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('procedure.captureFailed'));
    }
  }, [procedure, refresh, t]);

  const handleDelete = useCallback((s: Screenshot): void => {
    // G-05-13 — remove the thumbnail immediately. The toast store
    // schedules the actual IPC delete after 5s; its committed event
    // re-syncs this hook after the IPC settles.
    removeScreenshot(s.id);
    screenshotToastStore.enqueueDelete(s.id, s.procedureId);
    toast(`Screenshot deleted at ${formatDurationHHMMSS(s.timestampInVideoMs)}`, {
      duration: 5_000,
      action: {
        label: 'Undo',
        onClick: () => {
          screenshotToastStore.undoDelete(s.id);
          void refresh();
        },
      },
    });
  }, [removeScreenshot, refresh]);

  const handleAnnotate = useCallback(
    async (screenshot: Screenshot, annotation: string | null): Promise<void> => {
      try {
        await updateAnnotation(screenshot.id, annotation);
      } catch {
        // toast already fired inside updateAnnotation
      }
    },
    [updateAnnotation],
  );

  // Plan 07 / G-05-10 — lightbox state. `null` means closed; a row from
  // `screenshots[]` opens the modal. The lightbox lives in a Dialog
  // portal so its DOM position is independent of the page layout.
  const [lightboxScreenshot, setLightboxScreenshot] = useState<Screenshot | null>(null);

  // ponytail: shared cache-buster for ScreenshotTimeline thumbnails.
  // The lightbox already bumps its own internal cacheBuster for the
  // blob-URL preview (Plan 17), but the timeline thumbnails still
  // load via the MediaServer URL where the on-disk file change is
  // invisible to the browser cache. Bumping this on every crop
  // appends `?v=<value>` to each thumbnail URL so the browser
  // refetches. Initial value 0 keeps the no-crop case identical
  // (no `?v=` appended, no extra request).
  const [croppedAtMs, setCroppedAtMs] = useState(0);

  // Phase 6 / Plan 02 — Generate report / Edit report CTA. Disabled
  // while the procedure is still recording (no meaningful content).
  // Click: ensure the draft exists via getOrCreate, then navigate to
  // the report editor with the resolved id so the editor mounts
  // without a second round-trip.
  const handleOpenReport = useCallback(async (): Promise<void> => {
    if (!procedureId || procedure === null) return;
    if (procedure.status === 'recording') return;
    try {
      const row = report ?? (await window.api.reports.getOrCreate({ procedureId }));
      if (report === null) await refreshReport();
      navigate({ name: 'report-editor', procedureId, reportId: row.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open report';
      toast.error(msg);
    }
  }, [procedureId, procedure, report, refreshReport, navigate]);

  // ponytail: the PDF path is userData-relative; show only the leaf
  // filename so the doctor sees "1234.pdf" instead of the full path.
  // Plan 06-03 replaces this affordance with "Open PDF" + "Reveal in
  // Explorer"; for now a small line is enough to confirm the PDF
  // exists.
  const pdfLeafName = useMemo((): string | null => {
    if (report?.pdfPath === null || report?.pdfPath === undefined) return null;
    return report.pdfPath.replace(/^.*[\\/]/, '');
  }, [report?.pdfPath]);

  // ponytail: subscribe to the toast store so its listeners stay wired
  // (mirrors Plan 01). The subscription is otherwise unused.
  const toasts = useScreenshotToasts();
  void toasts;

  if (!procedureId) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl">
          <p className="text-sm text-slate-500">Missing procedure id.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E0D9C6] pb-3">
          <div>
            <p className={SMALL_CAPS_FIELD}>
              {t("procedure.pageKicker")}
            </p>
            <h1 className="mt-1 font-serif text-3xl font-medium tracking-tight text-[#13202E]">
              {t("procedure.reviewPageTitle")}
              {patient !== null ? (
                <span className="ml-2 font-sans text-base font-normal text-[#5C6770]">
                  · {patient.fullName}
                </span>
              ) : null}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {procedure !== null ? (
              <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-[#5C6770]">
                <span>
                  <span className={SMALL_CAPS_FIELD}>Started</span>{" "}
                  {formatTimestamp(procedure.startedAt)}
                </span>
                <span>
                  <span className={SMALL_CAPS_FIELD}>Duration</span>{" "}
                  {formatDurationHHMMSS(durationMs)}
                </span>
                <StatusBadge status={procedure.status} />
              </div>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                procedure
                  ? navigate({ name: 'patient-detail', id: procedure.patientId })
                  : navigate({ name: 'patients' })
              }
              data-testid="procedure-review-back"
              className={SECONDARY_OUTLINE_BUTTON}
            >
              <ArrowLeft aria-hidden="true" />
              {procedure ? 'Back to Patient' : 'Back'}
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div
            className={`flex flex-col gap-4 ${CARD_CHROME} p-4`}
            data-testid="procedure-review-left"
          >
            {gated ? <EmptyStateCard /> : null}
            <div className="overflow-hidden rounded-md border border-[#E0D9C6] bg-slate-900">
              {mediaUrl.url && videoSrc ? (
                <video
                  ref={videoRef}
                  controls
                  // G-05-3 + D-01 — crossOrigin=anonymous tells Chromium to
                  // issue a CORS-mode request. The server's
                  // Access-Control-Allow-Origin: * header (set as the
                  // first line of MediaServer.onHttpRequest) lets the
                  // load succeed, and the resulting HTMLVideoElement is
                  // not a tainted canvas source — ctx.drawImage + toBlob
                  // works without throwing.
                  crossOrigin="anonymous"
                  preload="metadata"
                  className="aspect-video w-full"
                  data-testid="procedure-review-video"
                  aria-label="Procedure recording playback"
                  src={videoSrc ?? undefined}
                />
              ) : null}
              {!mediaUrl.url ? (
                <Card
                  data-testid="procedure-review-video-unavailable"
                  className="border-slate-700 bg-slate-100"
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-700">
                      Video unavailable
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm text-slate-600">
                    <p data-testid="procedure-review-video-unavailable-message">
                      Media server not ready — the localhost HTTP bridge hasn&apos;t
                      accepted connections yet.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => mediaUrl.retry()}
                      data-testid="procedure-review-video-retry"
                      className="self-start"
                    >
                      Retry
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
              {procedure && !isInteractiveStatus(procedure.status) ? (
                <div className="bg-slate-100 p-6 text-center text-sm text-slate-500">
                  Playback unavailable — procedure status is {procedure.status}.
                </div>
              ) : null}
              {!procedure?.videoPath ? (
                <div className="bg-slate-100 p-6 text-center text-sm text-slate-500">
                  Video preview unavailable — record a procedure first.
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <p className={SMALL_CAPS_LABEL}>Timeline</p>
              <Scrubber
                durationMs={durationMs}
                currentMs={currentMs}
                onSeek={handleSeek}
                segments={segments}
                screenshots={screenshots}
                trimMode={trim.trimMode}
                inMs={trim.inMs}
                outMs={trim.outMs}
                onTrim={(range) => {
                  trim.setInMs(range.inMs);
                  trim.setOutMs(range.outMs);
                }}
              />
              <ScreenshotTimeline
                procedureId={procedureId}
                patientId={procedure?.patientId ?? ''}
                mediaBaseUrl={mediaUrl.url}
                status={procedure?.status}
                screenshots={screenshots}
                onSeek={handleSeek}
                onCapture={handleCapture}
                onDelete={handleDelete}
                onAnnotate={handleAnnotate}
                onOpen={setLightboxScreenshot}
                mediaCacheBuster={croppedAtMs}
              />
            </div>
          </div>

          <aside
            className="flex flex-col gap-4"
            data-testid="procedure-review-right"
          >
            <div className={RAIL_CARD_CHROME}>
              <p className={SMALL_CAPS_LABEL}>Notes</p>
              <div className="mt-2">
                <ProcedureNotesReview
                  procedureId={procedureId}
                  status={procedure?.status ?? 'completed'}
                />
              </div>
            </div>

            <div className={RAIL_CARD_CHROME}>
              <p className={SMALL_CAPS_LABEL}>Trim</p>
              <div className="mt-2">
                <TrimControls
                  status={procedure?.status ?? 'completed'}
                  videoPathOriginal={procedure?.videoPathOriginal ?? null}
                  inMs={trim.inMs}
                  outMs={trim.outMs}
                  durationMs={durationMs}
                  trimMode={trim.trimMode}
                  setTrimMode={trim.setTrimMode}
                  applying={trim.applying}
                  restoring={trim.restoring}
                  apply={trim.apply}
                  restore={trim.restore}
                  screenshots={screenshots}
                  videoRef={videoRef}
                  captureFrame={captureFrameForTrim}
                />
              </div>
            </div>

            <div
              className={`flex flex-col gap-2 ${CARD_CHROME} p-4`}
              data-testid="procedure-review-metadata"
            >
              <p className={SMALL_CAPS_LABEL}>Procedure</p>
              {procedure ? (
                <div className="mt-1 grid grid-cols-1 gap-2 font-mono text-xs tabular-nums text-[#13202E]">
                  <div>
                    <span className={SMALL_CAPS_FIELD}>Patient</span>{" "}
                    {patient ? patient.fullName : procedure.patientId.slice(0, 8)}
                  </div>
                  <div>
                    <span className={SMALL_CAPS_FIELD}>Started</span>{" "}
                    {formatTimestamp(procedure.startedAt)}
                  </div>
                  <div>
                    <span className={SMALL_CAPS_FIELD}>Ended</span>{" "}
                    {formatTimestamp(procedure.endedAt)}
                  </div>
                  <div>
                    <span className={SMALL_CAPS_FIELD}>Duration</span>{" "}
                    {formatDurationHHMMSS(durationMs)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("common.loading")}
                </p>
              )}
            </div>

            <div
              className={`flex flex-col gap-2 ${CARD_CHROME} p-4`}
              data-testid="procedure-review-report-cta"
            >
              <p className={SMALL_CAPS_LABEL}>{t("report.pageTitle")}</p>
              <Button
                size="sm"
                onClick={() => void handleOpenReport()}
                disabled={
                  procedure === null ||
                  procedure.status === 'recording'
                }
                data-testid="procedure-review-report-button"
                className={PRIMARY_TEAL_BUTTON}
              >
                <FileText className="size-4 mr-1" aria-hidden="true" />
                {report === null ? t("procedure.finalizeReport") : t("procedure.editReport")}
              </Button>
              {pdfLeafName !== null ? (
                <p
                  className="font-mono text-xs tabular-nums text-[#5C6770]"
                  data-testid="procedure-review-pdf-path"
                >
                  PDF: {pdfLeafName}
                </p>
              ) : null}
            </div>

            {procedure?.status === 'partial' ? (
              <DestructivePartialAlert
                status={procedure.status}
                videoPath={procedure.videoPath}
                lastKnownTimestampMs={lastLost?.lastKnownTimestampMs ?? null}
              />
            ) : null}
            {procedure?.status === 'partial' && procedure.videoPath.endsWith('.partial.mp4') ? (
              <DeviceLostBanner
                lastLost={lastLost}
                onDismiss={() => recordingStore.clearLastLost()}
              />
            ) : null}
          </aside>
        </section>
        {/* Plan 07 / G-05-10 — lightbox mounts at the page root so the
            Dialog portal sits outside the grid layout. The defensive
            empty-string patientId/procedureId keeps the modal null-safe
            during the initial procedure === null loading render. */}
        <ScreenshotLightbox
          screenshot={lightboxScreenshot}
          patientId={procedure?.patientId ?? ''}
          procedureId={procedure?.id ?? ''}
          mediaBaseUrl={mediaUrl.url}
          onClose={() => setLightboxScreenshot(null)}
          onDelete={handleDelete}
          onCropped={() => setCroppedAtMs(Date.now())}
        />
      </div>
    </main>
  );
}
