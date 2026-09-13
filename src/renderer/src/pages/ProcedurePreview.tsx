import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Camera, CircleDot, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FramingGuide } from '@/components/FramingGuide';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import EmptyStateCard from '@/components/EmptyStateCard';
import { useLicenseChangeRefresh } from '@/hooks/useLicenseStatus';
import { useRoute } from '@/store/route';
import { safeInvoke } from '@/lib/ipc-result';
import type { Procedure } from '@shared/ipc-contract';

// Quick task 20260907-procedure-preview-ui-enhance — design
// tokens lifted verbatim from ProcedureReview.tsx + ProcedureRoom
// .tsx so the three pages share the "clinical workstation"
// palette + chrome. Kept inline rather than promoted to a shared
// module (small surface; a future design-system pass would
// extract).
const CARD_CHROME =
  "rounded-lg border border-[#E0D9C6] bg-white shadow-sm";
const RAIL_CARD_CHROME =
  "rounded-lg border border-[#E0D9C6] bg-[#E6EFF1] p-4 shadow-sm transition-colors hover:border-[#A8C5B5]";
const SMALL_CAPS_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]";
const SMALL_CAPS_FIELD =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]";
const SECONDARY_OUTLINE_BUTTON =
  "border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]";
const PRIMARY_TEAL_BUTTON =
  "bg-[#0E3A47] text-white hover:bg-[#0B2C36] shadow-inner";

function NoDeviceState({ openSettings }: { openSettings: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
      <div className="flex max-w-md flex-col items-center gap-3">
        <Camera aria-hidden="true" className="size-9 text-slate-400" />
        <p className="font-medium">
          {t('procedure.previewNoDeviceBody')}
        </p>
        <Button variant="secondary" onClick={openSettings}>
          {t('procedure.previewOpenSettings')}
        </Button>
      </div>
    </div>
  );
}

export default function ProcedurePreview(): JSX.Element {
  const { t } = useTranslation();
  const routeState = useRoute();
  const route = routeState.current;
  const navigate = routeState.navigate;
  const patientId = route.name === 'procedure-preview' ? route.patientId : '';
  const incomingProcedureId =
    route.name === 'procedure-preview' ? route.procedureId : undefined;

  const { browser, loading, error: deviceError, lookup, pickBrowserId } = useCaptureDeviceMap();
  const [savedDevice, setSavedDevice] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [defaultLoaded, setDefaultLoaded] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const deviceInitRef = useRef(false);

  const preview = useVideoPreview(selectedBrowserId, undefined);
  const isRunning = preview.active || preview.starting;
  // ponytail: pull `start`/`stop` out so the auto-start effect doesn't
  // re-run on every render (preview object is recreated each render —
  // depending on the whole object would cause an infinite start/stop loop).
  const { start: previewStart, stop: previewStop } = preview;

  // Quick task 260913-rp5 — extracted the default-device fetch into a
  // stable callback so the LICENSE_CHANGED_EVENT listener can re-run it
  // when the user activates. The previous version had
  // `useEffect(() => {...}, [])` which meant the page never recovered
  // after activation: savedDevice stayed null and the no-device overlay
  // kept showing.
  const refetchDefaultDevice = useCallback((): void => {
    let cancelled = false;
    void window.api.capture
      .getDefaultDevice()
      .then((device) => {
        if (!cancelled) setSavedDevice(device);
      })
      .catch(() => {
        if (!cancelled) setSavedDevice(null);
      })
      .finally(() => {
        if (!cancelled) setDefaultLoaded(true);
      });
  }, []);

  useEffect(() => {
    refetchDefaultDevice();
  }, [refetchDefaultDevice]);

  useLicenseChangeRefresh(refetchDefaultDevice);

  useEffect(() => {
    if (loading || !defaultLoaded || deviceInitRef.current) return;
    deviceInitRef.current = true;
    setSelectedBrowserId(savedDevice ? pickBrowserId(savedDevice) ?? null : null);
  }, [defaultLoaded, loading, pickBrowserId, savedDevice]);

  // ponytail: auto-start the preview as soon as the doctor picks a device.
  // Explicit Start/Stop button removed — picking a device implies "show me
  // the feed". The preview hook handles idempotent start (no double-stream).
  useEffect(() => {
    if (selectedBrowserId && !isRunning && !preview.error) {
      previewStart();
    }
    if (!selectedBrowserId && isRunning) {
      previewStop();
    }
  }, [selectedBrowserId, isRunning, preview.error, previewStart, previewStop]);

  const selectedCanonical = selectedBrowserId ? lookup(selectedBrowserId) : undefined;

  const [procedureId] = useState<string | null>(
    incomingProcedureId ?? null,
  );
  const [procedureError, setProcedureError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Plan 08-10 / G-08-4 — gate-rejected flag. The Continue-to-recording
  // button returns null from procedures.create when the gate rejects;
  // render <EmptyStateCard> so the user sees the License path.
  const [gated, setGated] = useState(false);

  const ready = !loading && defaultLoaded;
  const hasSelection = selectedBrowserId !== null;

  // Quick task 260913-rp5 — clear `gated` when the user activates so
  // the EmptyStateCard disappears and they can click Continue to
  // recording again. The hook-level useCaptureDeviceMap also re-fetches
  // automatically; this clears the local "procedures.create was
  // rejected" flag specifically.
  useLicenseChangeRefresh(() => {
    setGated(false);
    setProcedureError(null);
  });

  function openSettings(): void {
    navigate({ name: 'settings-capture' });
  }

  function continueToRecording(): void {
    if (!patientId || creating) return;
    if (procedureId) {
      preview.stop();
      navigate({
        name: 'procedure-room',
        patientId,
        procedureId,
      });
      return;
    }
    setCreating(true);
    setProcedureError(null);
    safeInvoke(window.api.procedures.create({ patientId }))
      .then((row: Procedure | null) => {
        if (row === null) {
          // Plan 08-10 / G-08-4 — gate rejected. Keep the user on the
          // preview page; the EmptyStateCard below guides them through
          // activating while the LicenseGate modal stays interactable.
          setCreating(false);
          setGated(true);
          return;
        }
        preview.stop();
        navigate({
          name: 'procedure-room',
          patientId,
          procedureId: row.id,
        });
      })
      .catch((err: unknown) => {
        setCreating(false);
        setProcedureError(
          err instanceof Error ? err.message : t('procedure.previewPrepareFailed'),
        );
      });
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      {/* Quick task 20260907-procedure-preview-ui-enhance —
          dropped `mx-auto max-w-7xl` so the page spans full
          width (matches ProcedureReview + ProcedureRoom). */}
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E0D9C6] pb-3">
          <div>
            {/* Quick task 20260907-procedure-preview-ui-enhance —
                kicker text ("Preview") is intentionally distinct
                from the h1 ("Preview & setup") so existing tests
                that search for /preview/i don't match both. */}
            <p className={SMALL_CAPS_FIELD}>{t('procedure.previewLabel')}</p>
            <h1 className="mt-1 font-serif text-3xl font-medium tracking-tight text-[#13202E]">
              {t('procedure.previewPageTitle')}
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ name: 'patients' })}
            data-testid="procedure-preview-back"
            className={SECONDARY_OUTLINE_BUTTON}
          >
            <ArrowRight className="size-4 mr-1 rotate-180" aria-hidden="true" />
            {t('procedure.previewBackToPatients')}
          </Button>
        </header>

        <section
          className={`grid gap-5 ${notesCollapsed ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_20rem]'}`}
        >
          {/* Quick task 20260907-procedure-preview-ui-enhance —
              live preview card uses the same warm-ivory
              CARD_CHROME as ProcedureReview + ProcedureRoom.
              The dark `bg-slate-900` stays for the video frame
              itself — Chromium native controls need the dark
              backdrop. */}
          <div className={`overflow-hidden ${CARD_CHROME}`}>
            <div className="relative aspect-video bg-slate-900">
              <video
                ref={preview.videoRef}
                autoPlay
                muted
                playsInline
                aria-label="Live capture preview"
                className="size-full object-contain"
              />
              <FramingGuide />
              {!ready || !hasSelection ? (
                <NoDeviceState openSettings={openSettings} />
              ) : null}
              {preview.error && hasSelection ? (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
                  <div className="flex max-w-md flex-col items-center gap-3">
                    <Video aria-hidden="true" className="size-9 text-rose-400" />
                    <p className="font-medium">{t('procedure.previewNoDeviceBodyHint')}</p>
                    <p className="text-xs text-slate-300">{preview.error.message}</p>
                    <Button
                      variant="secondary"
                      onClick={() => preview.start()}
                    >
                      {t('procedure.reviewRetry')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {!notesCollapsed ? (
            <aside className={`flex flex-col gap-4 ${RAIL_CARD_CHROME}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Camera className="size-3.5 text-[#0E3A47]" aria-hidden="true" />
                  <p className={SMALL_CAPS_LABEL}>{t('procedure.previewCaptureDeviceLabel')}</p>
                  {/* Quick task 20260907-procedure-preview-ui-enhance —
                      signature element: live status pill that
                      echoes the live/streaming state in mono +
                      a pulsing dot. The pill sits in the header
                      row so the doctor sees live state at a
                      glance without reading the body text. */}
                  <span
                    data-testid="procedure-preview-live-pill"
                    className="ml-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#0E3A47] shadow-sm ring-1 ring-[#E0D9C6]"
                  >
                    <CircleDot
                      className={`size-3 ${isRunning ? "text-[#0E3A47] animate-pulse" : "text-slate-400"}`}
                      aria-hidden="true"
                    />
                    {isRunning ? t('procedure.previewLive') : t('procedure.previewIdle')}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNotesCollapsed(true)}
                  aria-label={t('procedure.previewCollapsePanel')}
                  className="text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                >
                  Hide
                </Button>
              </div>
              {deviceError ? (
                <p role="alert" className="text-sm text-destructive">
                  {deviceError}
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                {/* Quick task 20260907-procedure-preview-ui-enhance —
                    the small-caps 'Capture device' header above
                    is the visual label. The `<label
                    className="sr-only">` here is the accessible
                    label so the <Select> trigger gets a real
                    `<label htmlFor>` association + existing
                    tests using `findByLabelText(/capture device/i)`
                    still resolve. */}
                <label htmlFor="procedure-device" className="sr-only">
                  {t('procedure.previewCaptureDeviceLabel')}
                </label>
                <Select
                  value={selectedBrowserId ?? ''}
                  onValueChange={(v) => setSelectedBrowserId(v || null)}
                >
                  <SelectTrigger id="procedure-device" className="w-full">
                    <SelectValue placeholder={t('procedure.previewPickDevice')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {browser.map((device, index) => {
                        const canonical = lookup(device.deviceId);
                        return (
                          <SelectItem key={device.deviceId} value={device.deviceId}>
                            {canonical || device.label || `Video device ${index + 1}`}
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="font-mono text-[11px] tabular-nums text-[#5C6770]">
                  {selectedCanonical ? t('procedure.previewUsing', { device: selectedCanonical }) : t('procedure.previewPickToEnable')}
                </p>
              </div>

              <div
                className="flex items-center gap-2 rounded-md border border-[#E0D9C6] bg-white px-3 py-2"
                data-testid="preview-step"
              >
                <Video className="size-3.5 text-[#0E3A47]" aria-hidden="true" />
                <p className={SMALL_CAPS_FIELD}>{t('procedure.previewLabel')}</p>
                <span
                  className="ml-auto font-mono text-[11px] tabular-nums text-[#13202E]"
                >
                  {isRunning ? t('procedure.previewStreamingLive') : t('procedure.previewIdle')}
                </span>
              </div>

              <Button
                onClick={continueToRecording}
                disabled={creating || !patientId}
                data-testid="continue-to-recording-button"
                size="lg"
                className={`mt-2 w-full ${PRIMARY_TEAL_BUTTON}`}
              >
                {creating ? t('procedure.previewPreparing') : t('procedure.previewContinue')}
                <ArrowRight aria-hidden="true" className="ml-1 size-4" />
              </Button>
              {procedureError ? (
                <p
                  role="alert"
                  className="text-xs text-destructive"
                  data-testid="procedure-error"
                >
                  {procedureError}
                </p>
              ) : null}
              {gated ? <EmptyStateCard /> : null}
              <p className="text-xs text-[#5C6770]">
                {creating
                  ? t('procedure.previewPreparingHint')
                  : procedureId
                    ? t('procedure.previewReadyHint')
                    : t('procedure.previewStartHint')}
              </p>
            </aside>
          ) : (
            <div className="flex items-start justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNotesCollapsed(false)}
                aria-label={t('procedure.previewShowPanel')}
                className={SECONDARY_OUTLINE_BUTTON}
              >
                {t('procedure.previewShowPanel')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}