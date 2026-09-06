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
  useState,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookmarkPlus,
  FileText,
  List,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScreenshotTimeline } from "@/components/ScreenshotTimeline";
import { SaveTemplateDialog } from "@/components/SaveTemplateDialog";
import { TemplatesDialog } from "@/components/TemplatesDialog";
import {
  useAttachedScreenshots,
  useProcedureScreenshots,
  useReport,
  type ReportEditableFields,
} from "@/hooks/useReport";
// Quick task 20260906-remove-autosave — useAutoSave hook dropped.
// The doctor wants an explicit "Save changes" button at the
// bottom of the page (final action they trigger), not silent
// auto-save on every keystroke.
import { useDoctorProfile } from "@/hooks/useDoctorProfile";
import { useMediaUrl } from "@/hooks/useMediaUrl";
import { useRoute } from "@/lib/router";
import { safeInvoke } from "@/lib/ipc-result";
import EmptyStateCard from "@/components/EmptyStateCard";
import { isPdfLockedError } from "@/lib/pdf-locked-error";
import { useSession } from "@/store/session";
import type {
  Procedure,
  ReportTemplate,
  UsedDevice,
} from "@shared/ipc-contract";

const ANATOMY_BOXES_BY_TYPE: Record<
  "colon" | "upper_gi",
  ReadonlyArray<keyof ReportEditableFields>
> = {
  colon: ["colon", "ileum"],
  upper_gi: ["esophagus", "stomach", "pylorus", "duodenum"],
};

// Quick task 20260906-print-preview-and-input-unify — unified
// input field treatment. Every <select> + <input> + <textarea>
// in the document shares the same border + bg + padding +
// focus state so the page reads as a single form language.
const FIELD_CLASS =
  "block w-full rounded border border-[#E0D9C6] bg-[#FBF7EE] px-3 py-2 text-sm text-[#13202E] placeholder:text-[#A39A86] transition-colors hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0E3A47]/30";

// Quick task 20260907-remove-print-button — the Print button is
// gone (and so is `handlePrint`, the REPORTS_PRINT IPC, and the
// preload `reports.print` bridge). The "Open PDF" button alone
// drives the PDF flow: shell.openPath opens the report in the
// clinic's default viewer (Edge / Adobe Reader), which has a fully
// working native print dialog with preview — the doctor prints
// from there (Ctrl+P or File → Print).

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
  const routeProcedureId =
    route.name === "report-editor" ? route.procedureId : null;
  const routeReportId =
    route.name === "report-editor" ? route.reportId : undefined;
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

  // Quick task 20260906-remove-autosave — useAutoSave removed. The
  // textarea / select / input handlers now only call `setLocal`
  // (in-memory React state). Box edits persist when the doctor
  // clicks "Save changes" at the bottom of the page
  // (handleRegenPdf flushes the current 8 box fields via
  // updateDraft / updateFinalized BEFORE calling regenPdf).
  //
  // procedure_type / instrument / premedication_override still
  // persist immediately on each change via their dedicated IPC
  // channels (handleProcedureTypeChange / handleInstrumentChange
  // / premedicationCommitted) — those don't need Save changes
  // because each has its own commit action (segmented control
  // toggle, select onChange, input onBlur).

  const handleFieldChange = useCallback(
    (key: keyof ReportEditableFields) =>
      (e: ChangeEvent<HTMLTextAreaElement>): void => {
        const value = e.target.value;
        const patched: Partial<ReportEditableFields> = { [key]: value };
        setLocal(patched);
        // Quick task 20260906-remove-autosave — no `trigger()`. Box
        // edits persist via Save changes → handleRegenPdf flushes
        // the 8 box fields via updateDraft / updateFinalized.
      },
    [report, setLocal],
  );

  // Quick task 20260812-redesign-report — procedure-type toggle.
  // Quick task 20260906-report-editor-polish — procedure type is now
  // free to toggle at any time (re-paints against the new anatomy set).
  // The previous boxesLocked guard + the repo's empty-state SQL
  // invariant have both been dropped.

  const handleProcedureTypeChange = useCallback(
    async (next: "colon" | "upper_gi"): Promise<void> => {
      if (report === null) return;
      try {
        const updated = await window.api.reports.setProcedureType({
          id: report.id,
          procedureType: next,
        });
        setLocal(updated);
        await refresh();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t("report.procedureTypeChangeFailed"),
        );
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
      const next = value === "" ? null : value;
      try {
        const updated = await window.api.reports.setInstrument({
          id: report.id,
          instrument: next,
        });
        setLocal(updated);
        await refresh();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t("report.instrumentChangeFailed"),
        );
      }
    },
    [report, refresh, setLocal, t],
  );

  // Quick task 20260812-redesign-report — per-report premedication
  // override. Defaults to the profile's premedication when empty.
  const [premedicationInput, setPremedicationInput] = useState<string>("");
  useEffect(() => {
    if (report === null) return;
    setPremedicationInput(report.premedicationOverride ?? "");
  }, [report?.premedicationOverride, report?.id]);
  const premedicationCommitted = useCallback(
    async (value: string): Promise<void> => {
      if (report === null) return;
      const next = value === "" ? null : value;
      try {
        const updated = await window.api.reports.setPremedicationOverride({
          id: report.id,
          override: next,
        });
        setLocal(updated);
        await refresh();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t("report.premedicationChangeFailed"),
        );
      }
    },
    [report, refresh, setLocal, t],
  );

  // Quick task 20260812-redesign-report — per-box templates picker +
  // "Save current as template". The dialog state is keyed by scope so
  // each box has its own dialog.
  const [templatesDialogScope, setTemplatesDialogScope] = useState<
    ReportTemplate["scope"] | null
  >(null);
  const [saveDialogScope, setSaveDialogScope] = useState<
    ReportTemplate["scope"] | null
  >(null);

  const handleInsertTemplate = useCallback(
    (scope: ReportTemplate["scope"]) =>
      (template: ReportTemplate): void => {
        if (report === null) return;
        // Map scope → ReportEditableFields key. They're 1:1 by design.
        const key = scope as keyof ReportEditableFields;
        const patched = {
          [key]: template.body,
        } as Partial<ReportEditableFields>;
        setLocal(patched);
        // Quick task 20260906-remove-autosave — no `trigger()`.
        // Template-insert edits persist via Save changes.
      },
    [report, setLocal],
  );

  const handleSaveTemplate = useCallback(
    (scope: ReportTemplate["scope"]) =>
      async (label: string): Promise<void> => {
        if (report === null) return;
        const key = scope as keyof ReportEditableFields;
        const body = report[key] ?? "";
        if (body.trim() === "") {
          toast.error(t("report.templateEmptyBody"));
          return;
        }
        try {
          await window.api.reportTemplates?.add?.({ scope, label, body });
          toast.success(t("report.templateSaved", { label }));
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("report.templateSaveFailed"),
          );
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
      const current = report[key] ?? "";
      const lines = current.split("\n");
      const allBulleted = lines.every(
        (line) => line === "" || /^\s*•\s*/.test(line),
      );
      const next = allBulleted
        ? lines.map((line) => line.replace(/^\s*•\s*/, "")).join("\n")
        : lines.map((line) => (line === "" ? "" : `• ${line}`)).join("\n");
      const patched = { [key]: next } as Partial<ReportEditableFields>;
      setLocal(patched);
      // Quick task 20260906-remove-autosave — no `trigger()`. Bullet
      // toggle persists via Save changes.
    },
    [report, setLocal],
  );

  const handleFinalize = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.finalize({ id: report.id });
      await window.api.reports.regenPdf({ id: report.id });
      await refresh();
      toast.success(t("report.reportFinalized"));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("procedure.finalizeFailed");
      toast.error(msg);
    }
  }, [report, refresh, t]);

  // Quick task 20260906-remove-autosave — Save changes is the
  // single place where box edits flush to the DB. Before calling
  // regenPdf, the current 8 box fields are persisted via
  // updateDraft (or updateFinalized if the report was already
  // finalized) so the regenerated PDF reflects the latest edits.
  const handleRegenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      const patch: ReportEditableFields = {
        esophagus: report.esophagus,
        stomach: report.stomach,
        pylorus: report.pylorus,
        duodenum: report.duodenum,
        colon: report.colon,
        ileum: report.ileum,
        conclusion: report.conclusion,
        recommendation: report.recommendation,
      };
      if (report.status === "finalized") {
        await window.api.reports.updateFinalized({
          id: report.id,
          ...patch,
        });
      } else {
        await window.api.reports.updateDraft({
          id: report.id,
          ...patch,
        });
      }
      await window.api.reports.regenPdf({ id: report.id });
      await refresh();
      toast.success(t("report.regenPdfSuccess"));
    } catch (err) {
      const msg = isPdfLockedError(err)
        ? t("report.pdfLockedError")
        : err instanceof Error
          ? err.message
          : t("report.regenPdfFailed");
      toast.error(msg);
    }
  }, [report, refresh, t]);

  const handleOpenPdf = useCallback(async (): Promise<void> => {
    if (report === null) return;
    try {
      await window.api.reports.openPdf({ id: report.id, reveal: false });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("report.openPdfFailed"),
      );
    }
  }, [report, t]);

  // Quick task 20260907-remove-print-button — `handlePrint` removed
  // (the Print button is gone; the Open PDF button now serves both
  // "view the PDF" and "print the PDF" — the doctor prints from the
  // system viewer's native print dialog).

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

  // Quick task 20260906-remove-autosave — dropped the indicatorText
  // useMemo + the save-indicator UI line (no auto-save means
  // nothing to show). The Save changes button at the bottom of
  // the page now surfaces its own success/error toast.

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
    if (!procPromise || typeof procPromise.then !== "function") {
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
    if (!promise || typeof promise.then !== "function") {
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

  const isFinalized = report?.status === "finalized";
  const procedureType: "colon" | "upper_gi" = report?.procedureType ?? "colon";
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

  const doctorName = currentUser?.fullName ?? "Doctor";
  const procedureDateLabel =
    procedure !== null
      ? new Date(procedure.startedAt).toISOString().slice(0, 10)
      : "";
  // Quick task 20260906-report-editor-procedure-layout-screenshots-grid-bullet-button —
  // duration formatter is now timezone-independent (pure seconds →
  // HH:MM:SS, no Date math). Previously `new Date(ms).getHours()`
  // returned local time, which drifted by UTC offset (e.g. 2h
  // procedure showed `05:00:00` in UTC+9).
  const procedureDurationLabel =
    procedure !== null ? formatDuration(procedure.durationSeconds) : "";
  const instrumentLabel =
    report?.instrument !== null && report?.instrument !== undefined
      ? (usedDevices.find((d) => d.id === report.instrument)?.name ?? "")
      : "";
  const premedicationDisplay =
    report?.premedicationOverride !== null &&
    report?.premedicationOverride !== undefined &&
    report.premedicationOverride !== ""
      ? report.premedicationOverride
      : (doctorProfile?.premedication ?? "");
  const scopeLabel = (scope: ReportTemplate["scope"]): string =>
    t(`report.box.${scope}`);

  const renderBox = (
    key: keyof ReportEditableFields,
    scope: ReportTemplate["scope"],
    label: string,
    rows: number,
    placeholder: string,
  ): JSX.Element => (
    <section className="mb-4" data-testid={`report-editor-section-${scope}`}>
      {/* Quick task 20260906-report-editor-procedure-layout-screenshots-grid-bullet-button —
          Templates / Save template stay in the heading row (doctor
          reaches them most often). Bullet moves into the box itself
          as a small icon button anchored at the top-right of the
          textarea; the hint copy is shown as a thin line under the
          textarea so the doctor knows what the button does.
          Quick task 20260906-report-editor-clinical-refresh —
          small-caps clinical label on the heading, hairline rule
          between the heading and the textarea. */}
      <div className="mb-2 flex items-center justify-between border-b border-[#E0D9C6] pb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
          {label}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setTemplatesDialogScope(scope)}
            data-testid={`report-editor-templates-${scope}`}
            className="text-[#5C6770] hover:bg-[#F0EBDE] hover:text-[#0E3A47]"
          >
            <ScrollText className="size-3.5 mr-1" aria-hidden="true" />
            {t("report.templatesButton")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSaveDialogScope(scope)}
            data-testid={`report-editor-save-template-${scope}`}
            className="text-[#5C6770] hover:bg-[#F0EBDE] hover:text-[#0E3A47]"
          >
            <BookmarkPlus className="size-3.5 mr-1" aria-hidden="true" />
            {t("report.saveTemplateButton")}
          </Button>
        </div>
      </div>
      <div className="relative">
        <textarea
          value={report?.[key] ?? ""}
          onChange={handleFieldChange(key)}
          rows={rows}
          placeholder={placeholder}
          // Quick task 20260906-report-editor-clinical-refresh — clinical
          // field treatment. Soft ivory tint, hairline rule, teal accent
          // on focus (matches the document's signature accent). pb-9
          // leaves room for the bullet button at the bottom-right.
          className="block w-full resize-y rounded border border-[#E0D9C6] bg-[#FBF7EE] px-3 py-2 pb-9 text-sm leading-relaxed text-[#13202E] placeholder:text-[#A39A86] transition-colors hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0E3A47]/30"
          data-testid={`report-editor-${scope}`}
        />
        {/* Quick task 20260906-report-editor-unify-patient-procedure-bullet-attached —
            enhanced bullet button: icon-only, anchored in the bottom-right
            of the textarea with a small teal pill background + tooltip.
            Reads as a tool affordance, not a button competing with the
            Templates / Save buttons in the heading row. */}
        <button
          type="button"
          onClick={() => handleBullet(key)()}
          aria-label={t("report.bullet")}
          title={t("report.addBulletHint")}
          data-testid={`report-editor-bullet-${scope}`}
          className="absolute bottom-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#E0D9C6] bg-white text-[#0E3A47] shadow-sm transition-colors hover:border-[#0E3A47] hover:bg-[#E6EFF1] focus:border-[#0E3A47] focus:bg-[#E6EFF1] focus:outline-none focus:ring-1 focus:ring-[#0E3A47]/40"
        >
          <List className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );

  return (
    // Quick task 20260906-report-editor-clinical-refresh — clinical
    // workstation palette. Warm ivory background (clinic-bg
    // #F7F1E6) instead of slate-100 — feels like a clinical chart
    // resting on a desk, not a SaaS dashboard.
    <main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E0D9C6] pb-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#8C8478]">
              {t("common.report")}
            </p>
            <h1 className="mt-1 font-serif text-3xl font-medium tracking-tight text-[#13202E]">
              {isFinalized ? (
                <span className="flex items-center gap-3">
                  {t("report.pageTitle")}
                  <Badge
                    variant="secondary"
                    data-testid="report-editor-finalized-badge"
                    className="bg-[#E6EFF1] text-[#0E3A47] hover:bg-[#D6E4E8]"
                  >
                    {t("report.finalizedBy", {
                      doctor: currentUser?.fullName ?? "doctor",
                    })}
                  </Badge>
                </span>
              ) : (
                <span>{t("report.pageTitleDraft")}</span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {isFinalized ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleOpenPdf()}
                disabled={report?.pdfPath === null}
                data-testid="report-editor-open-pdf"
                className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
              >
                <FileText className="size-4 mr-1" aria-hidden="true" />
                {t("report.openPdfButton")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({ name: "procedure-review", procedureId })
              }
              data-testid="report-editor-back"
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              <ArrowLeft aria-hidden="true" />
              {t("common.back")}
            </Button>
          </div>
        </header>

        {/* Quick task 20260906-report-editor-layout-and-bullets — full
            page width. The two-column layout (boxes left, screenshots
            right) lives inside the document <article>. */}
        <div className="mx-auto w-full max-w-7xl px-2">
          {/* Quick task 20260906-report-editor-clinical-refresh — the
              article is the report "document". White surface on the
              warm-ivory background reads like a printed chart. The
              4px teal stripe on the left edge is the page's signature
              accent — same hue as the procedure-type toggle's active
              state so the two visual anchors rhyme. */}
          <article
            className="relative overflow-hidden rounded-lg border border-[#E0D9C6] bg-white p-8 shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]"
            data-testid="report-editor-document"
          >
            {/* Signature teal stripe */}
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1 bg-[#0E3A47]"
            />
            <div className="pl-4">
              {loading && report === null ? (
                <p className="text-sm text-[#5C6770]">{t("common.loading")}</p>
              ) : null}

              {gated ? <EmptyStateCard /> : null}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                {/* LEFT — patient / procedure / boxes */}
                <div className="min-w-0">
                  {/* Patient block — quick task 20260906 dropped the logo + */}
                  {/* signature header band at the top of the editor (it only */}
                  {/* matters on the rendered PDF). The page-level "Report */}
                  {/* editor" h1 + finalized badge above still surface the */}
                  {/* context.
                    Quick task 20260906-report-editor-unify-patient-procedure-bullet-attached:
                    unified with the Procedure meta-row treatment — small-caps
                    label above, mono value below, in a 4-col grid. */}
                  <section className="mb-6">
                    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
                      {t("common.patient")}
                    </h2>
                    <div
                      className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4"
                      data-testid="report-editor-patient-block"
                    >
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.name")}
                        </p>
                        <p
                          className="mt-0.5 truncate font-medium text-[#13202E]"
                          title={patient?.fullName ?? ""}
                        >
                          {patient?.fullName ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.mrn")}
                        </p>
                        <p className="mt-0.5 font-mono text-sm text-[#13202E]">
                          {patient?.mrn}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.dob")}
                        </p>
                        <p className="mt-0.5 font-mono text-sm text-[#13202E]">
                          {patient?.dob ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.gender")}
                        </p>
                        <p className="mt-0.5 text-sm text-[#13202E]">
                          {patient?.gender ?? "—"}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Procedure block + instrument + premedication */}
                  <section className="mb-6">
                    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
                      {t("common.procedure")}
                    </h2>
                    {/* Quick task 20260906-report-editor-procedure-layout-screenshots-grid-bullet-button —
                      Date / Duration / Doctor on a single row with small caps labels. */}
                    <div
                      className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm text-[#13202E]"
                      data-testid="report-editor-procedure-meta"
                    >
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.date")}
                        </p>
                        <p
                          className="mt-0.5 font-mono text-sm text-[#13202E]"
                          data-testid="report-editor-procedure-date-value"
                        >
                          {procedureDateLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.duration")}
                        </p>
                        <p
                          className="mt-0.5 font-mono text-sm text-[#13202E]"
                          data-testid="report-editor-procedure-duration-value"
                        >
                          {procedureDurationLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                          {t("common.doctor")}
                        </p>
                        <p
                          className="mt-0.5 truncate text-sm text-[#13202E]"
                          title={doctorName}
                        >
                          {doctorName}
                        </p>
                      </div>
                    </div>

                    {/* Procedure-type toggle — quick task
                      20260906-report-editor-clinical-refresh: teal accent
                      on the active state (matches the document's
                      signature stripe).
                      Quick task 20260906-report-editor-procedure-center-print-regen-thumbnails:
                      centered in the procedure block. */}
                    <div className="mt-4 text-center">
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]">
                        {t("report.procedureTypeLabel")}
                      </label>
                      <div
                        className="mx-auto inline-flex rounded border border-[#E0D9C6] bg-[#FBF7EE]"
                        role="radiogroup"
                        aria-label={t("report.procedureTypeLabel")}
                        data-testid="report-editor-procedure-type"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            void handleProcedureTypeChange("colon")
                          }
                          aria-pressed={procedureType === "colon"}
                          className={`px-4 py-1.5 text-sm transition-colors ${
                            procedureType === "colon"
                              ? "bg-[#0E3A47] text-white shadow-inner"
                              : "text-[#5C6770] hover:bg-[#F0EBDE] hover:text-[#13202E]"
                          }`}
                          data-testid="report-editor-procedure-type-colon"
                        >
                          {t("report.procedureTypeColon")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleProcedureTypeChange("upper_gi")
                          }
                          aria-pressed={procedureType === "upper_gi"}
                          className={`px-4 py-1.5 text-sm transition-colors ${
                            procedureType === "upper_gi"
                              ? "bg-[#0E3A47] text-white shadow-inner"
                              : "text-[#5C6770] hover:bg-[#F0EBDE] hover:text-[#13202E]"
                          }`}
                          data-testid="report-editor-procedure-type-upper-gi"
                        >
                          {t("report.procedureTypeUpperGi")}
                        </button>
                      </div>
                    </div>

                    {/* Instrument picker + Premedication override —
                      quick task 20260906-report-editor-clinical-refresh:
                      same row in a 2-col grid so they read as a single
                      instrument-config block. */}
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label
                          htmlFor="report-editor-instrument"
                          className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]"
                        >
                          {t("report.instrumentLabel")}
                        </label>
                        <select
                          id="report-editor-instrument"
                          value={report?.instrument ?? ""}
                          onChange={(e) => void handleInstrumentChange(e)}
                          className={FIELD_CLASS}
                          data-testid="report-editor-instrument-select"
                        >
                          <option value="">{t("report.instrumentNone")}</option>
                          {usedDevices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                        {instrumentLabel === "" && usedDevices.length === 0 ? (
                          <p className="mt-1 text-xs text-[#8C8478]">
                            {t("report.instrumentNoneConfigured")}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label
                          htmlFor="report-editor-premedication"
                          className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C8478]"
                        >
                          {t("report.premedicationLabel")}
                        </label>
                        <Input
                          id="report-editor-premedication"
                          value={premedicationInput}
                          onChange={(e) =>
                            setPremedicationInput(e.target.value)
                          }
                          onBlur={() =>
                            void premedicationCommitted(premedicationInput)
                          }
                          placeholder={premedicationDisplay}
                          className={FIELD_CLASS}
                          data-testid="report-editor-premedication"
                        />
                        {/* Quick task 20260906-print-via-webcontents-save-changes-at-end —
                          drop the "Empty falls back to clinic default: …" hint line.
                          The input's `placeholder` already shows the
                          clinic default; whether the doctor overrode it
                          is implicit from the value (empty vs not). */}
                      </div>
                    </div>
                  </section>

                  {/* Anatomy boxes + always-on Conclusion + Recommendation —
                    quick task 20260906-report-editor-clinical-refresh:
                    all 8 boxes sit in the same 2-col grid. */}
                  <div
                    className="grid grid-cols-1 gap-4 md:grid-cols-2"
                    data-testid="report-editor-anatomy-grid"
                  >
                    {anatomyBoxes.map((box) =>
                      renderBox(
                        box,
                        box,
                        scopeLabel(box),
                        4,
                        t("report.boxPlaceholder", { scope: scopeLabel(box) }),
                      ),
                    )}
                    {renderBox(
                      "conclusion",
                      "conclusion",
                      scopeLabel("conclusion"),
                      3,
                      t("report.boxPlaceholder", {
                        scope: scopeLabel("conclusion"),
                      }),
                    )}
                    {renderBox(
                      "recommendation",
                      "recommendation",
                      scopeLabel("recommendation"),
                      3,
                      t("report.boxPlaceholder", {
                        scope: scopeLabel("recommendation"),
                      }),
                    )}
                  </div>

                  {/* Footer dropped alongside the top logo band (quick task
                    20260906-report-editor-polish) — the footer signature +
                    clinic name still appear on the rendered PDF, not in
                    the editor preview. */}
                </div>

                {/* RIGHT — screenshots rail (sticky on scroll, lg+) */}
                <aside
                  className="min-w-0"
                  data-testid="report-editor-screenshots-rail"
                >
                  <div className="rounded-lg border border-[#E0D9C6] bg-[#EFEAE0] p-3 lg:sticky lg:top-4">
                    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
                      {t("report.attachedScreenshots")}
                      <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-[#5C6770]">
                        ({attached.length} of {screenshots.length})
                      </span>
                    </h2>
                    <ScreenshotTimeline
                      procedureId={procedureId}
                      patientId={procedure?.patientId ?? ""}
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
                      // Quick task 20260906 — 2-column vertical grid for the
                      // narrow right rail so the thumbnails fill the
                      // available height (was overflow-x-auto before).
                      layout="grid"
                    />
                  </div>
                </aside>
              </div>
            </div>
            {/* Quick task 20260906-save-changes-vs-finalize-and-rail-max-height —
            one primary action at the very end of the page:
              - No PDF yet → "Finalize report" (creates the report row +
                locks the procedure status + generates the first PDF).
              - PDF exists  → "Save changes" (regenerates the PDF with
                any post-finalize edits).
            Coral vs teal keeps the "this is the irreversible state
            transition" visual cue distinct from the "save my edits"
            cue. */}
            <div className="mx-auto flex max-w-7xl justify-end px-2">
              {report?.pdfPath === null ? (
                <Button
                  onClick={() => void handleFinalize()}
                  disabled={report === null}
                  className="bg-[#C66B4D] px-5 text-white hover:bg-[#B05C40] disabled:bg-[#E0D9C6] disabled:text-[#8C8478]"
                  data-testid="report-editor-finalize"
                >
                  {t("report.finalizeButton")}
                </Button>
              ) : (
                <Button
                  onClick={() => void handleRegenPdf()}
                  data-testid="report-editor-regen-pdf"
                  className="bg-[#0E3A47] px-5 text-white hover:bg-[#0B2C36]"
                >
                  {t("report.regenPdfButton")}
                </Button>
              )}
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
            if (report === null) return "";
            const key = saveDialogScope as keyof ReportEditableFields;
            const body = report[key] ?? "";
            return body.split("\n")[0]?.trim().slice(0, 60) ?? "";
          })()}
          onSave={handleSaveTemplate(saveDialogScope)}
        />
      ) : null}
    </main>
  );
}

// Quick task 20260906-report-editor-procedure-layout-screenshots-grid-bullet-button —
// pure-seconds → HH:MM:SS formatter, timezone-independent. No Date
// math (which would drift by UTC offset).
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

// ponytail: Procedure + UsedDevice type imports are pulled in for the
// local Procedure / UsedDevice stubs. The hook returns Procedure | null
// but the editor doesn't read procedure fields beyond what's typed
// above; the import keeps strict TS happy without a `any` cast.
void (null as unknown as Procedure | null);
