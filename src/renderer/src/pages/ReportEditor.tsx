// ReportEditor — RPT-01..05 + RPT-07.
//
// Phase 6 UAT G-06-12 — editor UI matches the rendered PDF layout. The
// left column is a 1:1 visual preview of the PDF: header (logo +
// clinic name | signature + doctor name + date), patient block,
// procedure block, Findings / Diagnosis sections, attached screenshots
// grid, footer. Each editable section is a styled `<textarea>` styled
// to look like the PDF body. The doctor sees exactly what the PDF
// will look like as they type.
//
// Phase 6 UAT G-06-10 — Recommendations + procedureDetails fields
// removed from the editor. Only Findings + Diagnosis remain. The
// removed fields are still columns in the reports table (no
// migration) so historical data is preserved.
//
// Phase 6 UAT G-06-11 — Print button embeds the actual generated PDF
// in a hidden `<iframe>` and calls `iframe.contentWindow.print()`.
// The OS print dialog shows the PDF as the print target with a live
// preview, not the on-screen editor DOM. The iframe is recreated
// whenever the PDF file changes (after each finalize / re-render).
//
// Phase 6 UAT G-06-9 — Finalize auto-triggers a PDF render. The
// Open PDF / Print / Reveal buttons depend on report.pdfPath being
// populated, so the regenPdf IPC fires immediately after finalize.
//
// Phase 6 UAT G-06-8 — ScreenshotTimeline receives the rich `attached`
// prop (with sortOrder) so the move buttons can reorder attached
// thumbnails visibly.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { ArrowLeft, FileText, FolderOpen, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import {
  useAttachedScreenshots,
  useProcedureScreenshots,
  useReport,
  type ReportEditableFields,
} from '@/hooks/useReport';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useDoctorProfile } from '@/hooks/useDoctorProfile';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';
import type { Report, Screenshot } from '@shared/ipc-contract';

// ponytail: Phase 6 UAT G-06-11 — print preview. The PDF is fetched
// via `api.reports.getPdfBlob({ id })` (the MediaServer does NOT serve
// the report PDF — it restricts to data/media/patients/ paths). The
// bytes are wrapped in a Blob + ObjectURL which the iframe loads. The
// iframe is keyed by the object URL string so re-renders (after a
// regenPdf round-trip) re-mount the iframe with the new blob URL,
// bypassing any browser cache.
function PrintPreview({ reportId }: { reportId: string | null }): JSX.Element | null {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (reportId === null) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let objectUrlToRevoke: string | null = null;
    (async (): Promise<void> => {
      try {
        const result = await window.api.reports?.getPdfBlob?.({ id: reportId });
        if (cancelled || result === undefined || result === null) return;
        // Wrap the bytes in a Blob → ObjectURL. The renderer owns the
        // URL; revoke on unmount or when the PDF changes.
        const blob = new Blob([result.bytes], { type: result.mime });
        const url = URL.createObjectURL(blob);
        objectUrlToRevoke = url;
        setSrc(url);
      } catch (err) {
        // best-effort — PrintPreview is optional UX
        if (!cancelled) {
          console.warn('Failed to load PDF for print preview:', err);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrlToRevoke !== null) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [reportId]);
  if (src === null) return null;
  return (
    <iframe
      ref={iframeRef}
      src={src}
      title="PDF preview"
      // ponytail: keep the iframe loaded so contentWindow.print() works
      // synchronously on demand. Hidden via inline style (Tailwind's
      // `hidden` = display:none would prevent print()). 1×1 px at
      // opacity 0.01 keeps it loaded without occupying space.
      style={{ position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', border: 0, opacity: 0.01 }}
      data-testid="report-editor-pdf-iframe"
    />
  );
}

export default function ReportEditor({
  procedureId: initialProcedureId,
  reportId: initialReportId,
}: {
  procedureId?: string;
  reportId?: string;
}): JSX.Element {
  const { navigate } = useRoute();
  const route = useRoute().current;
  // ponytail: prefer explicit props (page-composable) over the route
  // union fields. The ReportEditor accepts both: prop-driven for tests,
  // route-driven for navigation (Phase 5 ProcedureReview CTA lands the
  // doctor here with the resolved reportId).
  const routeProcedureId = route.name === 'report-editor' ? route.procedureId : null;
  const routeReportId = route.name === 'report-editor' ? route.reportId : undefined;
  const procedureId = initialProcedureId ?? routeProcedureId ?? null;
  void (initialReportId ?? routeReportId);

  const { report, loading, refresh, setLocal } = useReport({ procedureId });
  const { currentUser } = useSession();
  const { profile: doctorProfile } = useDoctorProfile();
  const mediaUrl = useMediaUrl();

  const { attached, attach, detach, reorder } = useAttachedScreenshots({
    reportId: report?.id ?? null,
  });
  const { screenshots } = useProcedureScreenshots({
    procedureId,
  });

  // Auto-save — only Findings + Diagnosis remain (Phase 6 UAT G-06-10).
  const { status, savedAt, trigger } = useAutoSave({
    value: report,
    onSave: async (r) => {
      if (r === null) return;
      const patch: ReportEditableFields = {
        findings: r.findings,
        diagnosis: r.diagnosis,
      };
      if (r.status === 'finalized') {
        await window.api.reports.updateFinalized({ id: r.id, ...patch });
      } else {
        await window.api.reports.updateDraft({ id: r.id, ...patch });
      }
    },
  });

  const handleFieldChange = useCallback(
    (key: keyof ReportEditableFields) =>
      (e: ChangeEvent<HTMLTextAreaElement>): void => {
        const value = e.target.value;
        const patched: Partial<ReportEditableFields> = { [key]: value };
        setLocal(patched);
        // ponytail: pass the patched report directly so the auto-save
        // IPC doesn't race the React setState — by the time the
        // 300ms debounce fires, setLocal has been queued but not yet
        // flushed, so the hook's closure-captured `value` is stale.
        const next =
          report === null ? null : ({ ...report, ...patched } as Report);
        trigger(next ?? undefined);
      },
    [report, setLocal, trigger],
  );

  const handleFinalize = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.finalize({ id: report.id });
      // Phase 6 UAT G-06-9 — auto-render the PDF after finalize so the
      // doctor doesn't have to click "Re-render PDF" separately. The
      // Open PDF / Print / Reveal buttons depend on report.pdfPath
      // being populated.
      await window.api.reports.regenPdf({ id: report.id });
      await refresh();
      toast.success('Report finalized + PDF generated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Finalize failed';
      toast.error(msg);
    }
  }, [report, refresh]);

  const handleRegenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.regenPdf({ id: report.id });
      await refresh();
      toast.success('PDF regenerated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF render failed';
      toast.error(msg);
    }
  }, [report, refresh]);

  const handleOpenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id, reveal: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Open failed';
      toast.error(msg);
    }
  }, [report]);

  const handleRevealPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id, reveal: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reveal failed';
      toast.error(msg);
    }
  }, [report]);

  // Phase 6 UAT G-06-11 — print the actual PDF (not the on-screen
  // editor DOM). Triggers the OS print dialog with the PDF as the
  // print target, which gives the doctor a real PDF preview.
  const handlePrint = useCallback((): void => {
    // The iframe is mounted in the JSX below. After the PDF path
    // changes, the iframe re-mounts (cacheBust key); we wait one
    // frame for the PDF to load before calling print(). Cheap and
    // sufficient for a desktop app where the user just clicked Print.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const iframe = document.querySelector<HTMLIFrameElement>(
          '[data-testid="report-editor-pdf-iframe"]',
        );
        if (iframe === null || iframe.contentWindow === null) {
          toast.error('PDF not ready — click Re-render PDF first');
          return;
        }
        iframe.contentWindow.print();
      });
    });
  }, []);

  const handleToggleAttach = useCallback(
    (screenshotId: number): void => {
      const isAttached = attached.some((a) => a.screenshotId === screenshotId);
      if (isAttached) {
        void detach(screenshotId);
      } else {
        void attach(screenshotId);
      }
    },
    [attached, attach, detach],
  );

  const indicatorText = useMemo((): string => {
    if (status === 'saving') return 'Saving…';
    if (status === 'error') return 'Save failed — retry';
    if (status === 'saved' && savedAt !== null) {
      const d = new Date(savedAt);
      const pad = (n: number): string => n.toString().padStart(2, '0');
      return `Saved at ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return '';
  }, [status, savedAt]);

  // Resolve the patient for the screenshot URL composition + the
  // patient block in the rendered PDF preview.
  const [patient, setPatient] = useState<{
    id: string;
    fullName: string;
    mrn: string | null;
    dob: string;
    gender: string | null;
  } | null>(null);
  useEffect(() => {
    if (!procedureId) {
      setPatient(null);
      return;
    }
    let cancelled = false;
    // ponytail: fetch procedure to get patientId, then fetch patient.
    // Same pattern as ProcedureReview.
    const procPromise = window.api.procedures?.get?.({ id: procedureId });
    if (!procPromise || typeof procPromise.then !== 'function') {
      return;
    }
    procPromise.then(async (p) => {
      if (cancelled || p === undefined || p === null) return;
      const patientRow = await window.api.patients?.get?.(p.patientId);
      if (cancelled || patientRow === undefined || patientRow === null) return;
      setPatient({
        id: patientRow.id,
        fullName: patientRow.fullName,
        mrn: patientRow.mrn,
        dob: patientRow.dob,
        gender: patientRow.gender,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const [procedure, setProcedure] = useState<{
    startedAt: number;
    durationSeconds: number;
    patientId: string;
  } | null>(null);
  useEffect(() => {
    if (!procedureId) {
      setProcedure(null);
      return;
    }
    let cancelled = false;
    const promise = window.api.procedures?.get?.({ id: procedureId });
    if (!promise || typeof promise.then !== 'function') {
      return;
    }
    promise.then((p) => {
      if (cancelled || p === undefined || p === null) return;
      setProcedure({
        startedAt: p.startedAt,
        durationSeconds: p.durationSeconds,
        patientId: p.patientId,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const isFinalized = report?.status === 'finalized';

  // Load the doctor profile's signature + logo as data URLs for the
  // rendered PDF preview (header logo + signature in footer).
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [sig, logo] = await Promise.all([
          window.api.profile?.getAssetDataUrl?.({ kind: 'signature' }),
          window.api.profile?.getAssetDataUrl?.({ kind: 'logo' }),
        ]);
        setSignaturePreview(sig?.dataUrl ?? null);
        setLogoPreview(logo?.dataUrl ?? null);
      } catch {
        // best-effort
      }
    })();
  }, [doctorProfile?.signaturePath, doctorProfile?.logoPath]);

  if (procedureId === null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <p className="text-sm text-slate-500">Missing procedure id.</p>
      </main>
    );
  }

  const clinicName = doctorProfile?.clinicNameEn ?? '';
  const doctorName = currentUser?.fullName ?? 'Doctor';
  const procedureDateLabel =
    procedure !== null
      ? new Date(procedure.startedAt).toISOString().slice(0, 10)
      : '';
  const procedureDurationLabel =
    procedure !== null ? formatHHMMSS(procedure.durationSeconds * 1000) : '';

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      {/* Phase 6 UAT G-06-11 — hidden iframe hosting the actual PDF for
          `contentWindow.print()`. Mounted whenever the report has a
          pdfPath. The PDF bytes are fetched via the new getPdfBlob IPC
          (the MediaServer doesn't serve the report PDF), wrapped in a
          Blob ObjectURL, and loaded in the iframe. */}
      <PrintPreview key={report?.pdfPath ?? 'none'} reportId={report?.id ?? null} />
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Report
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isFinalized ? (
                <span className="flex items-center gap-2">
                  Findings &amp; diagnosis
                  <Badge
                    variant="secondary"
                    data-testid="report-editor-finalized-badge"
                  >
                    Finalized · last edited by {currentUser?.fullName ?? 'doctor'}
                  </Badge>
                </span>
              ) : (
                <span>Findings &amp; diagnosis (draft)</span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {isFinalized ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handlePrint()}
                  disabled={report?.pdfPath === null}
                  data-testid="report-editor-print"
                >
                  <Printer className="size-4 mr-1" aria-hidden="true" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleOpenPdf()}
                  disabled={report?.pdfPath === null}
                  data-testid="report-editor-open-pdf"
                >
                  <FileText className="size-4 mr-1" aria-hidden="true" />
                  Open PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRevealPdf()}
                  disabled={report?.pdfPath === null}
                  data-testid="report-editor-reveal-pdf"
                >
                  <FolderOpen className="size-4 mr-1" aria-hidden="true" />
                  Reveal in Explorer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRegenPdf()}
                  data-testid="report-editor-regen-pdf"
                >
                  Re-render PDF
                </Button>
              </>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ name: 'procedure-review', procedureId })}
              data-testid="report-editor-back"
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          </div>
        </header>

        {/* Phase 6 UAT G-06-12 — editor UI matches the rendered PDF layout.
            One-column document-style page (max-w-3xl) with header / patient
            / procedure / Findings / Diagnosis / screenshots / footer. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <article
            className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
            data-testid="report-editor-document"
          >
            {loading && report === null ? (
              <p className="text-sm text-slate-500">Loading report…</p>
            ) : null}

            {/* Header — mirrors the PDF header (logo + clinic name | signature + doctor + date) */}
            <div className="mb-5 flex items-start justify-between border-b border-slate-200 pb-4">
              <div className="flex max-w-[200px] flex-col gap-1">
                {logoPreview !== null ? (
                  <img
                    src={logoPreview}
                    alt="Clinic logo"
                    className="max-h-[60px] max-w-[200px] object-contain"
                    data-testid="report-editor-logo"
                  />
                ) : (
                  <p className="text-xs text-slate-400">[No logo uploaded]</p>
                )}
                <p className="text-base font-bold text-slate-900" data-testid="report-editor-clinic-name">
                  {clinicName}
                </p>
              </div>
              <div className="flex max-w-[220px] flex-col items-end gap-1">
                {signaturePreview !== null ? (
                  <img
                    src={signaturePreview}
                    alt="Signature"
                    className="max-h-[40px] max-w-[120px] object-contain"
                    data-testid="report-editor-signature"
                  />
                ) : null}
                <p className="text-sm text-slate-700" data-testid="report-editor-doctor-name">
                  {doctorName}
                </p>
                <p className="text-xs text-slate-500" data-testid="report-editor-procedure-date">
                  {procedureDateLabel}
                </p>
              </div>
            </div>

            {/* Patient block */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-bold text-slate-900">Patient</h2>
              <div className="flex flex-wrap gap-x-4 text-sm text-slate-700" data-testid="report-editor-patient-block">
                <span>Name: <strong>{patient?.fullName ?? '—'}</strong></span>
                <span>MRN: {patient?.mrn ?? '—'}</span>
                <span>DOB: {patient?.dob ?? '—'}</span>
                <span>Gender: {patient?.gender ?? '—'}</span>
              </div>
            </section>

            {/* Procedure block */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-bold text-slate-900">Procedure</h2>
              <div className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Date: {procedureDateLabel}</span>
                <span>Duration: {procedureDurationLabel}</span>
                <span>Doctor: {doctorName}</span>
              </div>
            </section>

            {/* Findings — editable textarea styled to look like PDF body */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-bold text-slate-900">Findings</h2>
              <textarea
                value={report?.findings ?? ''}
                onChange={handleFieldChange('findings')}
                rows={6}
                placeholder="Document the key findings…"
                className="w-full resize-y rounded border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 focus:border-blue-400 focus:outline-none"
                data-testid="report-editor-findings"
              />
            </section>

            {/* Diagnosis — editable textarea styled to look like PDF body */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-bold text-slate-900">Diagnosis</h2>
              <textarea
                value={report?.diagnosis ?? ''}
                onChange={handleFieldChange('diagnosis')}
                rows={4}
                placeholder="State the clinical diagnosis…"
                className="w-full resize-y rounded border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 focus:border-blue-400 focus:outline-none"
                data-testid="report-editor-diagnosis"
              />
            </section>

            {/* Attached screenshots — mirrors the PDF inline grid */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-bold text-slate-900">
                Attached screenshots
                <span className="ml-2 text-xs font-normal text-slate-500">
                  ({attached.length} of {screenshots.length})
                </span>
              </h2>
              <ScreenshotTimeline
                procedureId={procedureId}
                patientId={procedure?.patientId ?? ''}
                mediaBaseUrl={mediaUrl.url}
                status="completed"
                screenshots={screenshots}
                onSeek={() => {
                  /* no-op in editor — seeking the video is owned by ProcedureReview */
                }}
                // G-06-6: +Capture button intentionally omitted in editor
                // G-06-8: pass rich `attached` list with sortOrder so
                // move buttons reorder attached items visually
                attached={attached}
                onToggleAttach={handleToggleAttach}
                onReorder={reorder}
                testId="report-editor-screenshot-timeline"
              />
            </section>

            {/* Footer — mirrors the PDF footer (signature + clinic + page) */}
            <footer className="mt-6 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                {signaturePreview !== null ? (
                  <img src={signaturePreview} alt="Signature" className="h-5 w-[60px] object-contain" />
                ) : null}
                <span>{doctorName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{clinicName}</span>
              </div>
            </footer>

            {/* Save indicator + Finalize button */}
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="report-editor-save-indicator"
              role="status"
              aria-live="polite"
            >
              {indicatorText}
            </p>
            {!isFinalized ? (
              <Button
                onClick={() => void handleFinalize()}
                disabled={report === null}
                className="mt-2 self-start"
                data-testid="report-editor-finalize"
              >
                Finalize report (auto-generates PDF)
              </Button>
            ) : null}
          </article>
        </div>
      </div>
    </main>
  );
}

function formatHHMMSS(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}