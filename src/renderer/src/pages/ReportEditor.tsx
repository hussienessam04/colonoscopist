// ReportEditor — RPT-01..05 + RPT-07. Four textareas
// (findings / diagnosis / recommendations / procedureDetails) +
// ScreenshotTimeline attachment list + Finalize button + post-finalize
// "Re-render PDF" button (the actual PDF render is Plan 06-03; this
// plan just wires the IPC and the post-finalize badge).
//
// Auto-save: each textarea binds the local `report[field]`; onChange
// patches the local row; onBlur fires useAutoSave which calls
// api.reports.updateDraft (or updateFinalized when status === 'finalized').
//
// Attach: ScreenshotTimeline receives the procedure's full screenshot
// list + the attachedIds Set from useAttachedScreenshots. Toggling
// attach calls useAttachedScreenshots.attach/detach; drag-to-reorder
// calls reorder(orderedIds).
//
// Post-finalize: a Badge in the header reads "Finalized · last edited
// by <X>". The textareas + screenshot toggles remain editable per
// CONTEXT.md D-07 (any signed-in doctor can edit).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import {
  useAttachedScreenshots,
  useProcedureScreenshots,
  useReport,
  type ReportEditableFields,
} from '@/hooks/useReport';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';

type FieldKey = keyof ReportEditableFields;

const FIELDS: ReadonlyArray<{ key: FieldKey; label: string; testId: string; rows: number }> = [
  { key: 'findings', label: 'Findings', testId: 'report-editor-findings', rows: 5 },
  { key: 'diagnosis', label: 'Diagnosis', testId: 'report-editor-diagnosis', rows: 4 },
  {
    key: 'recommendations',
    label: 'Recommendations',
    testId: 'report-editor-recommendations',
    rows: 4,
  },
  {
    key: 'procedureDetails',
    label: 'Procedure details',
    testId: 'report-editor-procedureDetails',
    rows: 4,
  },
];

function formatHHMMSS(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  // ponytail: reportId is plumbed through the route union so the
  // ProcedureReview CTA can navigate with the resolved id after
  // getOrCreate — saves a round-trip on every ReportEditor mount.
  void (initialReportId ?? routeReportId);

  const { report, loading, refresh, setLocal } = useReport({ procedureId });
  const { currentUser } = useSession();
  const mediaUrl = useMediaUrl();

  const { attached, attach, detach, reorder } = useAttachedScreenshots({
    reportId: report?.id ?? null,
  });
  const { screenshots } = useProcedureScreenshots({
    procedureId,
  });

  // Auto-save state machine — one useAutoSave covers all four fields.
  // Per CONTEXT.md, the doctor blurs a field → debounced 300ms IPC
  // round-trip → indicator cycles. The IPC method is selected on
  // report.status: updateDraft for drafts, updateFinalized for
  // finalized rows (D-07 + IPC contract).
  const { status, savedAt, trigger } = useAutoSave({
    value: report,
    onSave: async (r) => {
      if (r === null) return;
      const patch: ReportEditableFields = {
        findings: r.findings,
        diagnosis: r.diagnosis,
        recommendations: r.recommendations,
        procedureDetails: r.procedureDetails,
      };
      if (r.status === 'finalized') {
        await window.api.reports.updateFinalized({ id: r.id, ...patch });
      } else {
        await window.api.reports.updateDraft({ id: r.id, ...patch });
      }
    },
  });

  const handleFieldChange = useCallback(
    (key: FieldKey) =>
      (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
        const value = e.target.value;
        setLocal({ [key]: value });
        trigger();
      },
    [setLocal, trigger],
  );

  const handleFinalize = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.finalize({ id: report.id });
      toast.success('Report finalized');
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Finalize failed';
      toast.error(msg);
    }
  }, [report, refresh]);

  const handleRegenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.regenPdf({ id: report.id });
      toast.success('PDF regenerated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF render failed';
      toast.error(msg);
    }
  }, [report]);

  const handleOpenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Open failed';
      toast.error(msg);
    }
  }, [report]);

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
    if (status === 'saved' && savedAt !== null) return `Saved at ${formatHHMMSS(savedAt)}`;
    return '';
  }, [status, savedAt]);

  // ponytail: resolve the patient for the screenshot URL composition.
  // The ReportEditor doesn't need the full patient row, just the id —
  // but it has to come from the procedure. If we don't have the
  // procedure, the timeline degrades (placeholder) per the screenshotUrl
  // helper.
  const [patientId, setPatientId] = useState<string>('');
  useEffect(() => {
    if (!procedureId) {
      setPatientId('');
      return;
    }
    let cancelled = false;
    void window.api.procedures.get({ id: procedureId }).then((p) => {
      if (!cancelled) setPatientId(p?.patientId ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const isFinalized = report?.status === 'finalized';

  if (procedureId === null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <p className="text-sm text-slate-500">Missing procedure id.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
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
                  onClick={() => void handleOpenPdf()}
                  data-testid="report-editor-open-pdf"
                >
                  <FileText className="size-4 mr-1" aria-hidden="true" />
                  Open PDF
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

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex flex-col gap-4" data-testid="report-editor-left">
            <Card>
              <CardHeader>
                <CardTitle>Clinical fields</CardTitle>
                <CardDescription>
                  Auto-saves on blur. Finalize locks the report PDF
                  snapshot — edits after Finalize bump <code>updated_at</code>
                  but keep the original <code>finalized_at</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {loading && report === null ? (
                  <p className="text-sm text-slate-500">Loading report…</p>
                ) : null}
                {FIELDS.map(({ key, label, testId, rows }) => (
                  <div key={key} className="flex flex-col gap-2">
                    <label
                      htmlFor={testId}
                      className="text-sm font-medium text-foreground"
                    >
                      {label}
                    </label>
                    <Textarea
                      id={testId}
                      rows={rows}
                      value={report?.[key] ?? ''}
                      onChange={handleFieldChange(key)}
                      data-testid={testId}
                    />
                  </div>
                ))}
                <p
                  className="text-xs text-muted-foreground"
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
                    className="self-start"
                    data-testid="report-editor-finalize"
                  >
                    Finalize report
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </section>

          <aside className="flex flex-col gap-3" data-testid="report-editor-right">
            <Card>
              <CardHeader>
                <CardTitle>Attached screenshots</CardTitle>
                <CardDescription>
                  Toggle to include in the PDF; drag to reorder.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScreenshotTimeline
                  procedureId={procedureId}
                  patientId={patientId}
                  mediaBaseUrl={mediaUrl.url}
                  status="completed"
                  screenshots={screenshots}
                  onSeek={() => {
                    /* no-op in editor — seeking the video is owned by ProcedureReview */
                  }}
                  onCapture={() => {
                    /* disabled: capture is a ProcedureReview action */
                  }}
                  attachedIds={new Set(attached.map((a) => a.screenshotId))}
                  onToggleAttach={handleToggleAttach}
                  onReorder={reorder}
                  testId="report-editor-screenshot-timeline"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {attached.length} attached · {screenshots.length} available
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}