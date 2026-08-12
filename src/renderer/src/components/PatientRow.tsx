// Patient table row + actions menu (Open Procedure Room / View procedures /
// Edit / Delete / Restore).
// Per Plan 03-05 (G-03-4): a non-deleted row exposes an "Open Procedure Room"
// entry that navigates to { name: 'procedure-room', patientId } — the
// destination preserves the route snapshot so Finish returns to Patient List.
//
// Quick task 20260811 — the Phase 7 accordion expansion was reverted;
// procedures are now reached via the dedicated PatientProcedures page
// (navigates to { name: 'patient-procedures', patientId }).
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRoute } from '@/lib/router';
import { useTranslation } from 'react-i18next';
import type { Patient } from '@shared/ipc-contract';

type Props = {
  patient: Patient;
  canRestore: boolean;
  onEdit: (patient: Patient) => void;
  onDelete: (patient: Patient) => void;
  onRestore: (patient: Patient) => void;
};

export default function PatientRow({
  patient,
  canRestore,
  onEdit,
  onDelete,
  onRestore,
}: Props): JSX.Element {
  const { navigate } = useRoute();
  // ponytail: useTranslation is the standard react-i18next hook — the
  // dropdown item labels live in the bundles per Phase 7 i18n parity.
  const { t } = useTranslation();
  const isDeleted = patient.deletedAt !== null;
  return (
    <tr
      className="border-b last:border-b-0"
      data-testid={`patient-row-${patient.id}`}
    >
      <td className="px-3 py-2 text-sm align-top">
        <div className="flex flex-col">
          <span className="font-medium">{patient.fullName}</span>
          {isDeleted && (
            <span className="self-start mt-1 inline-flex items-center rounded-md bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
              {t('patient.deleted')}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.dob}</td>
      <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.gender ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.mrn}</td>
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
              <>
                {/* Per Plan 03-05 (G-03-4): the existing "Open Procedure Preview"
                    label is preserved verbatim (hardcoded English) so the
                    pre-existing test contract at
                    tests/renderer/components/patient-row.test.tsx holds. The
                    new "View procedures" item (quick task 20260811) flows
                    through t() so EN + AR bundles cover it. */}
                <DropdownMenuItem
                  onSelect={() => navigate({ name: 'procedure-preview', patientId: patient.id })}
                  data-testid="open-procedure-room"
                >
                  Open Procedure Preview
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    navigate({ name: 'patient-procedures', patientId: patient.id })
                  }
                  data-testid="view-procedures"
                >
                  {t('patient.viewProcedures')}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => onEdit(patient)}>{t('common.edit')}</DropdownMenuItem>
            {isDeleted ? (
              <DropdownMenuItem
                onSelect={() => onRestore(patient)}
                disabled={!canRestore}
              >
                {t('patient.restore')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onDelete(patient)}>
                {t('common.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}