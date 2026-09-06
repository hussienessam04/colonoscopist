// ReportEditor — Quick task 20260812-redesign-report.
//
// Procedure-type toggle + 8 procedure-type-specific boxes (colon/ileum
// for `colon`; esophagus/stomach/pylorus/duodenum for `upper_gi`) +
// always-on conclusion + recommendation + instrument picker + per-report
// premedication override + saved-text-templates picker per box.
//
// Layout matches the rendered PDF 1:1 (Phase 6 UAT G-06-12) — header
// (logo + clinic | signature + doctor + date), patient block,
// procedure block (with instrument + premedication line), anatomy-box
// sections, attached screenshots grid, footer with signature.
//
// Phase 6 UAT G-06-11 — Print button reuses openPdf IPC; the OS PDF
// viewer's toolbar carries the print affordance.
// Phase 6 UAT G-06-9 — Finalize auto-triggers PDF regen so
// Open PDF / Print / Reveal surface immediately.
// Phase 6 UAT G-08-8 — Save indicator + Finalize button.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookmarkPlus, FileText, FolderOpen, Printer, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { SaveTemplateDialog } from '@/components/SaveTemplateDialog';
import { TemplatesDialog } from '@/components/TemplatesDialog';
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
import { safeInvoke } from '@/lib/ipc-result';
import EmptyStateCard from '@/components/EmptyStateCard';
import { isPdfLockedError } from '@/lib/pdf-locked-error';
import { useSession } from '@/store/session';
import type {
  Procedure,
  Report,
  ReportTemplate,
  UsedDevice,
} from '@shared/ipc-contract';

const ANATOMY_BOXES_BY_TYPE: Record<
  'colon' | 'upper_gi',
  ReadonlyArray<keyof ReportEditableFields>
> = {
  colon: ['colon', 'ileum'],
  upper_gi: ['esophagus', 'stomach', 'pylorus', 'duodenum'],
};

// ponytail: Phase 6 UAT G-06-11 — print preview. The PDF is fetched
// via `api.reports.getPdfBlob({ id })` (the MediaServer does NOT serve
// the report PDF — it restricts to data/media/patients/ paths). The
// bytes are wrapped in a Blob + ObjectURL which the iframe loads.
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
        const result = await safeInvoke(
          window.api.reports?.getPdfBlob?.({ id: reportId }),
        );
        if (cancelled || result === null || result === undefined) return;
        const blob = new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: result.mime });
        const url = URL.createObjectURL(blob);
        objectUrlToRevoke = url;
        setSrc(url);
      } catch {
        // best-effort
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
  const { t } = useTranslation();
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

  // Quick task 20260812-redesign-report — auto-save only writes the 8
  // box fields. procedure_type / instrument / premedication_override
  // have dedicated IPC channels with their own guards (e.g. setProcedureType
  // refuses after a box is non-empty).
  const { status, savedAt, trigger } = useAutoSave({
    value: report,
    onSave: async (r) => {
      if (r === null) return;
      const patch: ReportEditableFields = {
        esophagus: r.esophagus,
        stomach: r.stomach,
        pylorus: r.pylorus,
        duodenum: r.duodenum,
        colon: r.colon,
        ileum: r.ileum,
        conclusion: r.conclusion,
        recommendation: r.recommendation,
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
        const next =
          report === null ? null : ({ ...report, ...patched } as Report);
        trigger(next ?? undefined);
      },
    [report, setLocal, trigger],
  );

  // Quick task 20260812-redesign-report — procedure-type toggle.
  // Quick task 20260906-report-editor-polish — procedure type is now
  // free to toggle at any time (re-paints against the new anatomy set).
  // The previous boxesLocked guard + the repo's empty-state SQL
  // invariant have both been dropped.

  const handleProcedureTypeChange = useCallback(
    async (next: 'colon' | 'upper_gi'): Promise<void> => {
      if (report === null) return;
      try {
        const updated = await window.api.reports.setProcedureType({
          id: report.id,
          procedureType: next,
        });
        setLocal(updated);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('report.procedureTypeChangeFailed'));
      }
    },
    [report, refresh, setLocal, t],
  );

  // Quick task 20260812-redesign-report — instrument picker. List
  // loaded once from used_devices (per doctor profile). NULL on the
  // report when nothing picked.
  const [usedDevices, setUsedDevices] = useState<UsedDevice[]>([]);
  useEffect(() => {
    let cancelled = false;
    const list = async (): Promise<void> => {
      const rows = await safeInvoke(window.api.usedDevices?.list?.());
      if (cancelled) return;
      setUsedDevices(Array.isArray(rows) ? rows : []);
    };
    void list();
    return () => {
      cancelled = true;
    };
  }, [doctorProfile?.id]);

  const handleInstrumentChange = useCallback(
    async (e: ChangeEvent<HTMLSelectElement>): Promise<void> => {
      if (report === null) return;
      const value = e.target.value;
      const next = value === '' ? null : value;
      try {
        const updated = await window.api.reports.setInstrument({
          id: report.id,
          instrument: next,
        });
        setLocal(updated);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('report.instrumentChangeFailed'));
      }
    },
    [report, refresh, setLocal, t],
  );

  // Quick task 20260812-redesign-report — per-report premedication
  // override. Defaults to the profile's premedication when empty.
  const [premedicationInput, setPremedicationInput] = useState<string>('');
  useEffect(() => {
    if (report === null) return;
    setPremedicationInput(report.premedicationOverride ?? '');
  }, [report?.premedicationOverride, report?.id]);
  const premedicationCommitted = useCallback(
    async (value: string): Promise<void> => {
      if (report === null) return;
      const next = value === '' ? null : value;
      try {
        const updated = await window.api.reports.setPremedicationOverride({
          id: report.id,
          override: next,
        });
        setLocal(updated);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('report.premedicationChangeFailed'));
      }
    },
    [report, refresh, setLocal, t],
  );

  // Quick task 20260812-redesign-report — per-box templates picker +
  // "Save current as template". The dialog state is keyed by scope so
  // each box has its own dialog.
  const [templatesDialogScope, setTemplatesDialogScope] = useState<
    ReportTemplate['scope'] | null
  >(null);
  const [saveDialogScope, setSaveDialogScope] = useState<
    ReportTemplate['scope'] | null
  >(null);

  const handleInsertTemplate = useCallback(
    (scope: ReportTemplate['scope']) =>
      (template: ReportTemplate): void => {
        if (report === null) return;
        // Map scope → ReportEditableFields key. They're 1:1 by design.
        const key = scope as keyof ReportEditableFields;
        const patched = { [key]: template.body } as Partial<ReportEditableFields>;
        setLocal(patched);
        const next = { ...report, ...patched } as Report;
        trigger(next);
      },
    [report, setLocal, trigger],
  );

  const handleSaveTemplate = useCallback(
    (scope: ReportTemplate['scope']) =>
      async (label: string): Promise<void> => {
        if (report === null) return;
        const key = scope as keyof ReportEditableFields;
        const body = report[key] ?? '';
        if (body.trim() === '') {
          toast.error(t('report.templateEmptyBody'));
          return;
        }
        try {
          await window.api.reportTemplates?.add?.({ scope, label, body });
          toast.success(t('report.templateSaved', { label }));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('report.templateSaveFailed'));
        }
      },
    [report, t],
  );

  // Quick task 20260906-report-editor-layout-and-bullets — bullet
  // toggle for each box. Prefix every non-empty line of the box's
  // body with `"• "`; if every line is already bulleted, remove the
  // bullets instead (idempotent). Triggered by the small "• Bullet"
  // button next to Templates / Save template. Per-line selection is
  // out of scope; the textarea-level state is the source of truth.
  const handleBullet = useCallback(
    (key: keyof ReportEditableFields) => (): void => {
      if (report === null) return;
      const current = report[key] ?? '';
      const lines = current.split('\n');
      const allBulleted = lines.every(
        (line) => line === '' || /^\s*•\s*/.test(line),
      );
      const next = allBulleted
        ? lines.map((line) => line.replace(/^\s*•\s*/, '')).join('\n')
        : lines.map((line) => (line === '' ? '' : `• ${line}`)).join('\n');
      const patched = { [key]: next } as Partial<ReportEditableFields>;
      setLocal(patched);
      const nextReport = { ...report, ...patched } as Report;
      trigger(nextReport);
    },
    [report, setLocal, trigger],
  );

  const handleFinalize = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.finalize({ id: report.id });
      await window.api.reports.regenPdf({ id: report.id });
      await refresh();
      toast.success(t('report.reportFinalized'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('procedure.finalizeFailed');
      toast.error(msg);
    }
  }, [report, refresh, t]);

  const handleRegenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.regenPdf({ id: report.id });
      await refresh();
      toast.success(t('report.regenPdfSuccess'));
    } catch (err) {
      const msg = isPdfLockedError(err)
        ? t('report.pdfLockedError')
        : (err instanceof Error ? err.message : t('report.regenPdfFailed'));
      toast.error(msg);
    }
  }, [report, refresh, t]);

  const handleOpenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id, reveal: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('report.openPdfFailed'));
    }
  }, [report, t]);

  const handleRevealPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id, reveal: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('report.openPdfFailed'));
    }
  }, [report, t]);

  const handlePrint = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id, reveal: false });
      toast.success('PDF opened — use the viewer toolbar to print');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('report.openPdfFailed'));
    }
  }, [report, t]);

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
    if (status === 'saving') return t('common.saving');
    if (status === 'error') return t('common.saveFailedRetry');
    if (status === 'saved' && savedAt !== null) {
      const d = new Date(savedAt);
      const pad = (n: number): string => n.toString().padStart(2, '0');
      return t('common.savedAt', { time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` });
    }
    return '';
  }, [status, savedAt, t]);

  const [patient, setPatient] = useState<{
    id: string;
    fullName: string;
    mrn: string;
    dob: string;
    gender: string | null;
  } | null>(null);
  const [gated, setGated] = useState(false);
  useEffect(() => {
    if (!procedureId) {
      setPatient(null);
      return;
    }
    let cancelled = false;
    const procPromise = window.api.procedures?.get?.({ id: procedureId });
    if (!procPromise || typeof procPromise.then !== 'function') {
      return;
    }
    procPromise.then(async (raw) => {
      if (cancelled) return;
      const p = await safeInvoke(Promise.resolve(raw));
      if (cancelled) return;
      if (p === null) {
        setGated(true);
        return;
      }
      const patientRow = await safeInvoke(
        Promise.resolve(await window.api.patients?.get?.(p.patientId)),
      );
      if (cancelled) return;
      if (patientRow === null) {
        setGated(true);
        return;
      }
      setPatient({
        id: patientRow.id,
        fullName: patientRow.fullName,
        mrn: patientRow.mrn,
        dob: patientRow.dob,
        gender: patientRow.gender,
      });
      setGated(false);
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
    promise.then(async (raw) => {
      if (cancelled) return;
      const p = await safeInvoke(Promise.resolve(raw));
      if (cancelled) return;
      if (p === null) {
        setGated(true);
        return;
      }
      setProcedure({
        startedAt: p.startedAt,
        durationSeconds: p.durationSeconds,
        patientId: p.patientId,
      });
      setGated(false);
    });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const isFinalized = report?.status === 'finalized';
  const procedureType: 'colon' | 'upper_gi' = report?.procedureType ?? 'colon';
  const anatomyBoxes = ANATOMY_BOXES_BY_TYPE[procedureType];

  // ponytail: the editor dropped its logo + signature preview (quick
  // task 20260906 — those previews only matter on the rendered PDF).
  // The profile-asset fetch is also dropped; the doctor verifies
  // their logo / signature in Settings → Profile or by generating
  // a PDF.

  if (procedureId === null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <p className="text-sm text-slate-500">Missing procedure id.</p>
      </main>
    );
  }

  const doctorName = currentUser?.fullName ?? 'Doctor';
  const procedureDateLabel =
    procedure !== null
      ? new Date(procedure.startedAt).toISOString().slice(0, 10)
      : '';
  const procedureDurationLabel =
    procedure !== null ? formatHHMMSS(procedure.durationSeconds * 1000) : '';
  const instrumentLabel =
    report?.instrument !== null && report?.instrument !== undefined
      ? (usedDevices.find((d) => d.id === report.instrument)?.name ?? '')
      : '';
  const premedicationDisplay =
    report?.premedicationOverride !== null && report?.premedicationOverride !== undefined && report.premedicationOverride !== ''
      ? report.premedicationOverride
      : (doctorProfile?.premedication ?? '');
  const scopeLabel = (scope: ReportTemplate['scope']): string =>
    t(`report.box.${scope}`);

  const renderBox = (
    key: keyof ReportEditableFields,
    scope: ReportTemplate['scope'],
    label: string,
    rows: number,
    placeholder: string,
  ): JSX.Element => (
    <section className="mb-4" data-testid={`report-editor-section-${scope}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">{label}</h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleBullet(key)()}
            data-testid={`report-editor-bullet-${scope}`}
            title={t('report.addBulletHint')}
          >
            <span className="mr-1">•</span>
            {t('report.bullet')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setTemplatesDialogScope(scope)}
            data-testid={`report-editor-templates-${scope}`}
          >
            <ScrollText className="size-3.5 mr-1" aria-hidden="true" />
            {t('report.templatesButton')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSaveDialogScope(scope)}
            data-testid={`report-editor-save-template-${scope}`}
          >
            <BookmarkPlus className="size-3.5 mr-1" aria-hidden="true" />
            {t('report.saveTemplateButton')}
          </Button>
        </div>
      </div>
      <textarea
        value={report?.[key] ?? ''}
        onChange={handleFieldChange(key)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 focus:border-blue-400 focus:outline-none"
        data-testid={`report-editor-${scope}`}
      />
    </section>
  );

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <PrintPreview key={report?.pdfPath ?? 'none'} reportId={report?.id ?? null} />
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t('common.report')}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isFinalized ? (
                <span className="flex items-center gap-2">
                  {t('report.pageTitle')}
                  <Badge
                    variant="secondary"
                    data-testid="report-editor-finalized-badge"
                  >
                    {t('report.finalizedBy', { doctor: currentUser?.fullName ?? 'doctor' })}
                  </Badge>
                </span>
              ) : (
                <span>{t('report.pageTitleDraft')}</span>
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
                  {t('report.printButton')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleOpenPdf()}
                  disabled={report?.pdfPath === null}
                  data-testid="report-editor-open-pdf"
                >
                  <FileText className="size-4 mr-1" aria-hidden="true" />
                  {t('report.openPdfButton')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRevealPdf()}
                  disabled={report?.pdfPath === null}
                  data-testid="report-editor-reveal-pdf"
                >
                  <FolderOpen className="size-4 mr-1" aria-hidden="true" />
                  {t('report.revealPdfButton')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRegenPdf()}
                  data-testid="report-editor-regen-pdf"
                >
                  {t('report.regenPdfButton')}
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
              {t('common.back')}
            </Button>
          </div>
        </header>

        {/* Quick task 20260906-report-editor-layout-and-bullets — full
            page width. The two-column layout (boxes left, screenshots
            right) lives inside the document <article>. */}
        <div className="mx-auto w-full max-w-7xl px-2">
          <article
            className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
            data-testid="report-editor-document"
          >
            {loading && report === null ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : null}

            {gated ? <EmptyStateCard /> : null}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              {/* LEFT — patient / procedure / boxes */}
              <div className="min-w-0">
                {/* Patient block — quick task 20260906 dropped the logo + */}
                {/* signature header band at the top of the editor (it only */}
                {/* matters on the rendered PDF). The page-level "Report */}
                {/* editor" h1 + finalized badge above still surface the */}
                {/* context. */}
                <section className="mb-4">
                  <h2 className="mb-2 text-sm font-bold text-slate-900">{t('common.patient')}</h2>
                  <div
                    className="flex flex-wrap gap-x-4 text-sm text-slate-700"
                    data-testid="report-editor-patient-block"
                  >
                    <span>
                      {t('common.name')}: <strong>{patient?.fullName ?? '—'}</strong>
                    </span>
                    <span>{t('common.mrn')}: {patient?.mrn}</span>
                    <span>{t('common.dob')}: {patient?.dob ?? '—'}</span>
                    <span>{t('common.gender')}: {patient?.gender ?? '—'}</span>
                  </div>
                </section>

                {/* Procedure block + instrument + premedication */}
                <section className="mb-4">
                  <h2 className="mb-2 text-sm font-bold text-slate-900">{t('common.procedure')}</h2>
                  <div className="flex flex-col gap-2 text-sm text-slate-700">
                    <span>{t('common.date')}: {procedureDateLabel}</span>
                    <span>{t('common.duration')}: {procedureDurationLabel}</span>
                    <span>{t('common.doctor')}: {doctorName}</span>
                  </div>

                  {/* Procedure-type toggle */}
                  <div className="mt-4">
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      {t('report.procedureTypeLabel')}
                    </label>
                    <div
                      className="inline-flex rounded border border-slate-300 bg-slate-50"
                      role="radiogroup"
                      aria-label={t('report.procedureTypeLabel')}
                      data-testid="report-editor-procedure-type"
                    >
                      <button
                        type="button"
                        onClick={() => void handleProcedureTypeChange('colon')}
                        aria-pressed={procedureType === 'colon'}
                        className={`px-3 py-1.5 text-sm ${
                          procedureType === 'colon'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                        data-testid="report-editor-procedure-type-colon"
                      >
                        {t('report.procedureTypeColon')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleProcedureTypeChange('upper_gi')}
                        aria-pressed={procedureType === 'upper_gi'}
                        className={`px-3 py-1.5 text-sm ${
                          procedureType === 'upper_gi'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                        data-testid="report-editor-procedure-type-upper-gi"
                      >
                        {t('report.procedureTypeUpperGi')}
                      </button>
                    </div>
                  </div>

                  {/* Instrument picker */}
                  <div className="mt-3">
                    <label
                      htmlFor="report-editor-instrument"
                      className="mb-1 block text-xs font-medium text-slate-700"
                    >
                      {t('report.instrumentLabel')}
                    </label>
                    <select
                      id="report-editor-instrument"
                      value={report?.instrument ?? ''}
                      onChange={(e) => void handleInstrumentChange(e)}
                      className="block w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      data-testid="report-editor-instrument-select"
                    >
                      <option value="">{t('report.instrumentNone')}</option>
                      {usedDevices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    {instrumentLabel === '' && usedDevices.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {t('report.instrumentNoneConfigured')}
                      </p>
                    ) : null}
                  </div>

                  {/* Premedication override */}
                  <div className="mt-3">
                    <label
                      htmlFor="report-editor-premedication"
                      className="mb-1 block text-xs font-medium text-slate-700"
                    >
                      {t('report.premedicationLabel')}
                    </label>
                    <Input
                      id="report-editor-premedication"
                      value={premedicationInput}
                      onChange={(e) => setPremedicationInput(e.target.value)}
                      onBlur={() => void premedicationCommitted(premedicationInput)}
                      placeholder={premedicationDisplay}
                      data-testid="report-editor-premedication"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {premedicationInput === ''
                        ? t('report.premedicationFallsBack', { value: premedicationDisplay || t('common.empty') })
                        : t('report.premedicationOverrideActive')}
                    </p>
                  </div>
                </section>

                {/* Anatomy boxes (conditional on procedureType) — quick
                    task 20260906-report-editor-polish lays them out in a
                    2-column grid so the page fits more on screen without
                    scrolling. Conclusion + recommendation stay full-width
                    below. */}
                <div
                  className="grid grid-cols-1 gap-x-4 md:grid-cols-2"
                  data-testid="report-editor-anatomy-grid"
                >
                  {anatomyBoxes.map((box) =>
                    renderBox(
                      box,
                      box,
                      scopeLabel(box),
                      4,
                      t('report.boxPlaceholder', { scope: scopeLabel(box) }),
                    ),
                  )}
                </div>

                {/* Conclusion + recommendation always-on */}
                {renderBox(
                  'conclusion',
                  'conclusion',
                  scopeLabel('conclusion'),
                  3,
                  t('report.boxPlaceholder', { scope: scopeLabel('conclusion') }),
                )}
                {renderBox(
                  'recommendation',
                  'recommendation',
                  scopeLabel('recommendation'),
                  3,
                  t('report.boxPlaceholder', { scope: scopeLabel('recommendation') }),
                )}

                {/* Footer dropped alongside the top logo band (quick task
                    20260906-report-editor-polish) — the footer signature +
                    clinic name still appear on the rendered PDF, not in
                    the editor preview. */}

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
                    {t('report.finalizeButton')}
                  </Button>
                ) : null}
              </div>

              {/* RIGHT — screenshots rail (sticky on scroll, lg+) */}
              <aside
                className="min-w-0"
                data-testid="report-editor-screenshots-rail"
              >
                <div className="lg:sticky lg:top-4">
                  <h2 className="mb-2 text-sm font-bold text-slate-900">
                    {t('report.attachedScreenshots')}
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
                      /* no-op in editor */
                    }}
                    attached={attached}
                    onToggleAttach={handleToggleAttach}
                    onReorder={reorder}
                    testId="report-editor-screenshot-timeline"
                  />
                </div>
              </aside>
            </div>
          </article>
        </div>
      </div>

      {templatesDialogScope !== null ? (
        <TemplatesDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setTemplatesDialogScope(null);
          }}
          scope={templatesDialogScope}
          scopeLabel={scopeLabel(templatesDialogScope)}
          onInsert={(tpl) => {
            handleInsertTemplate(templatesDialogScope)(tpl);
            setTemplatesDialogScope(null);
          }}
        />
      ) : null}
      {saveDialogScope !== null ? (
        <SaveTemplateDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setSaveDialogScope(null);
          }}
          scopeLabel={scopeLabel(saveDialogScope)}
          defaultLabel={(() => {
            if (report === null) return '';
            const key = saveDialogScope as keyof ReportEditableFields;
            const body = report[key] ?? '';
            return body.split('\n')[0]?.trim().slice(0, 60) ?? '';
          })()}
          onSave={handleSaveTemplate(saveDialogScope)}
        />
      ) : null}
    </main>
  );
}

function formatHHMMSS(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ponytail: Procedure + UsedDevice type imports are pulled in for the
// local Procedure / UsedDevice stubs. The hook returns Procedure | null
// but the editor doesn't read procedure fields beyond what's typed
// above; the import keeps strict TS happy without a `any` cast.
void (null as unknown as Procedure | null);
