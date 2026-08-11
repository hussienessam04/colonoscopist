// PatientProcedures page — quick task 20260811.
//
// Replaces the Phase 7 accordion expansion that lived inside
// PatientsList. Each patient's procedures are now reached via the
// "View procedures" DropdownMenu item on PatientRow, which navigates
// here with { name: 'patient-procedures', patientId }.
//
// Surface (per plan):
//   - Header: "Workspace" kicker + "Procedures" h1 + Back button → patients.
//   - Patient header Card: name + MRN + DOB + gender (sourced via
//     window.api.patients.get). "Patient not found" toast + back-to-list
//     when the row is missing.
//   - Procedures Card: one row per procedure (started date + status
//     badge + duration + Open procedure button + report status chip +
//     Open PDF button). Each procedure row calls
//     window.api.reports.getByProcedure({procedureId}) to surface the
//     matching report — parallel fetch on mount, null is a valid state
//     (no report yet).
//
// ponytail: plain useState + useEffect — no SWR hook for the list since
// no shared state between pages; one-shot fetch on mount.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoute } from '@/lib/router';
import { formatProcedureDate } from '@/lib/format';
import type { Patient, Procedure, Report } from '@shared/ipc-contract';

type ProcedureWithReport = { procedure: Procedure; report: Report | null };

export default function PatientProcedures({ patientId }: { patientId: string }): JSX.Element {
  const { navigate } = useRoute();
  const { t } = useTranslation();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [rows, setRows] = useState<ProcedureWithReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const p: Patient | null = await window.api.patients.get(patientId);
        if (cancelled) return;
        if (p === null) {
          toast.error(t('patientProcedures.patientNotFound'));
          navigate({ name: 'patients' });
          return;
        }
        setPatient(p);
        // pageSize: 200 — keeps the surface scroll-free for any realistic
        // clinic year; matches the existing patients.list default-ish
        // shape (per plan: "use existing API").
        const procs = await window.api.procedures.list({
          patientId,
          pageSize: 200,
        });
        if (cancelled) return;
        // Parallel report lookup per procedure (null is valid — no
        // report exists yet for fresh recordings).
        const reports = await Promise.all(
          procs.rows.map((proc) =>
            window.api.reports.getByProcedure({ procedureId: proc.id }),
          ),
        );
        if (cancelled) return;
        setRows(
          procs.rows.map((procedure, idx) => ({
            procedure,
            report: reports[idx] ?? null,
          })),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load';
        toast.error(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, navigate, t]);

  function handleOpenProcedure(procedureId: string): void {
    navigate({ name: 'procedure-review', procedureId });
  }

  async function handleOpenReport(reportId: string): Promise<void> {
    try {
      await window.api.reports.openPdf({ id: reportId, reveal: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open PDF';
      toast.error(msg);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t('patientProcedures.pageKicker')}
            </p>
            <h1 className="text-2xl font-semibold">{t('patientProcedures.pageTitle')}</h1>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate({ name: 'patients' })}
            data-testid="patient-procedures-back"
          >
            <ArrowLeft className="size-4 mr-1" aria-hidden="true" />
            {t('patientProcedures.backToList')}
          </Button>
        </header>

        <Card data-testid="patient-procedures-header">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {patient === null ? t('patientProcedures.loadingPatient') : patient.fullName}
            </CardTitle>
          </CardHeader>
          {patient !== null ? (
            <CardContent className="text-sm text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <span className="font-medium text-foreground">{t('patient.mrnExact')}:</span>{' '}
                {patient.mrn ?? '—'}
              </span>
              <span>
                <span className="font-medium text-foreground">DOB:</span> {patient.dob}
              </span>
              <span>
                <span className="font-medium text-foreground">Gender:</span>{' '}
                {patient.gender ?? '—'}
              </span>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t('patient.total', { count: rows.length })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-md">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">{t('patientProcedures.columnStarted')}</th>
                    <th className="px-3 py-2">{t('patientProcedures.columnStatus')}</th>
                    <th className="px-3 py-2">{t('patientProcedures.columnDuration')}</th>
                    <th className="px-3 py-2">{t('patientProcedures.columnReport')}</th>
                    <th className="px-3 py-2 text-right">{t('patientProcedures.columnActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                        data-testid="patient-procedures-loading"
                      >
                        {t('patientProcedures.loadingProcedures')}
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                        data-testid="patient-procedures-empty"
                      >
                        {t('patientProcedures.proceduresEmpty')}
                      </td>
                    </tr>
                  ) : (
                    rows.map(({ procedure, report }) => (
                      <tr
                        key={procedure.id}
                        className="border-b last:border-b-0"
                        data-testid={`patient-procedure-row-${procedure.id}`}
                      >
                        <td className="px-3 py-2 text-sm">
                          {formatProcedureDate(procedure.startedAt)}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <Badge
                            variant={procedure.status === 'completed' ? 'default' : 'secondary'}
                            data-testid={`patient-procedure-status-${procedure.id}`}
                          >
                            {procedure.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-sm text-muted-foreground">
                          {t('patientProcedures.minutesShort', {
                            count: Math.round(procedure.durationSeconds / 60),
                          })}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          {report ? (
                            <Badge
                              variant={report.status === 'finalized' ? 'default' : 'outline'}
                              data-testid={`patient-procedure-report-status-${procedure.id}`}
                            >
                              {report.status === 'finalized'
                                ? t('patient.reportStatusFinalized')
                                : t('patient.reportStatusDraft')}
                            </Badge>
                          ) : (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid={`patient-procedure-no-report-${procedure.id}`}
                            >
                              {t('patientProcedures.noReport')}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenProcedure(procedure.id)}
                              data-testid={`patient-procedure-open-${procedure.id}`}
                            >
                              {t('patientProcedures.openProcedure')}
                            </Button>
                            {report !== null ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleOpenReport(report.id)}
                                data-testid={`patient-procedure-open-pdf-${procedure.id}`}
                              >
                                <FileText className="size-3.5 mr-1" aria-hidden="true" />
                                {t('patientProcedures.openPdf')}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}