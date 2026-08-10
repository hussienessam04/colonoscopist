// Patient table row + actions menu (Open Procedure Room / Edit / Delete / Restore).
// Per Plan 03-05 (G-03-4): a non-deleted row exposes an "Open Procedure Room"
// entry that navigates to { name: 'procedure-room', patientId } — the
// destination preserves the route snapshot so Finish returns to Patient List.
//
// Phase 7 / Plan 07-02 — SRCH-03 + D-03: per-row accordion expansion. When
// `expanded` is true, the row renders a sub-section listing the patient's
// procedures. Each procedure row click navigates to { name:
// 'procedure-review', procedureId } (per D-03). Each report row click
// invokes the existing `reports.openPdf` IPC (per D-03) — no report creation
// side effect, no contract surface change.
import { ChevronDown, ChevronRight, FileText, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRoute } from '@/lib/router';
import { formatProcedureDate } from '@/lib/format';
import type { Patient, Procedure, Report } from '@shared/ipc-contract';

type Props = {
  patient: Patient;
  canRestore: boolean;
  onEdit: (patient: Patient) => void;
  onDelete: (patient: Patient) => void;
  onRestore: (patient: Patient) => void;
  // Phase 7 / Plan 07-02 — SRCH-03 + D-03: accordion expansion.
  expanded?: boolean;
  onToggleExpand?: () => void;
  procedures?: Procedure[];
  reportsByProcedure?: Record<string, Report | null>;
  onOpenProcedure?: (procedureId: string) => void;
  onOpenReport?: (reportId: string) => void;
};

export default function PatientRow({
  patient,
  canRestore,
  onEdit,
  onDelete,
  onRestore,
  expanded = false,
  onToggleExpand,
  procedures = [],
  reportsByProcedure,
  onOpenProcedure,
  onOpenReport,
}: Props): JSX.Element {
  const { navigate } = useRoute();
  const isDeleted = patient.deletedAt !== null;
  return (
    <>
      <tr
        className="border-b last:border-b-0"
        data-testid={`patient-row-${patient.id}`}
      >
        <td className="px-2 py-2 align-top">
          <Button
            variant="ghost"
            size="icon"
            aria-label={expanded ? `Collapse ${patient.fullName}` : `Expand ${patient.fullName}`}
            onClick={onToggleExpand}
            data-testid={`patient-row-toggle-${patient.id}`}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </td>
        <td className="px-3 py-2 text-sm align-top">
          <div className="flex flex-col">
            <span className="font-medium">{patient.fullName}</span>
            {isDeleted && (
              <span className="self-start mt-1 inline-flex items-center rounded-md bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
                Deleted
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.dob}</td>
        <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.gender ?? '—'}</td>
        <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.mrn ?? '—'}</td>
        <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.phone ?? '—'}</td>
        <td className="px-3 py-2 text-right align-top">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${patient.fullName}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isDeleted ? (
                <DropdownMenuItem
                  onSelect={() => navigate({ name: 'procedure-preview', patientId: patient.id })}
                  data-testid="open-procedure-room"
                >
                  Open Procedure Preview
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => onEdit(patient)}>Edit</DropdownMenuItem>
              {isDeleted ? (
                <DropdownMenuItem
                  onSelect={() => onRestore(patient)}
                  disabled={!canRestore}
                >
                  Restore
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onDelete(patient)}>Delete</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {expanded ? (
        <tr
          className="border-b last:border-b-0 bg-slate-50/50"
          data-testid={`patient-row-expansion-${patient.id}`}
        >
          <td colSpan={7} className="px-3 py-3">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Procedures
              </p>
              {procedures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No procedures for this patient.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {procedures.map((proc) => {
                    const report = reportsByProcedure?.[proc.id] ?? null;
                    return (
                      <li
                        key={proc.id}
                        className="rounded-md border bg-card p-2"
                        data-testid={`procedure-row-${proc.id}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Button
                              variant="link"
                              size="sm"
                              className="px-0 h-auto font-medium"
                              onClick={() => onOpenProcedure?.(proc.id)}
                              data-testid={`procedure-row-open-${proc.id}`}
                            >
                              {formatProcedureDate(proc.startedAt)}
                            </Button>
                            <Badge
                              variant={proc.status === 'completed' ? 'default' : 'secondary'}
                              data-testid={`procedure-row-status-${proc.id}`}
                            >
                              {proc.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {Math.round(proc.durationSeconds / 60)} min
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-sm">
                          <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          {report ? (
                            <>
                              <Badge
                                variant={report.status === 'finalized' ? 'default' : 'outline'}
                                data-testid={`report-row-status-${proc.id}`}
                              >
                                {report.status === 'finalized' ? 'Finalized' : 'Draft'}
                              </Badge>
                              <Button
                                variant="link"
                                size="sm"
                                className="px-0 h-auto"
                                onClick={() => report.id && onOpenReport?.(report.id)}
                                data-testid={`report-row-open-${proc.id}`}
                              >
                                Open PDF
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">No report yet</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
