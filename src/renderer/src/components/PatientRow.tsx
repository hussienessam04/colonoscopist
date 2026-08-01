// Patient table row + actions menu (Edit / Delete / Restore).
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Patient } from '@shared/ipc-contract';

type Props = {
  patient: Patient;
  canRestore: boolean;
  onEdit: (patient: Patient) => void;
  onDelete: (patient: Patient) => void;
  onRestore: (patient: Patient) => void;
};

export default function PatientRow({ patient, canRestore, onEdit, onDelete, onRestore }: Props): JSX.Element {
  const isDeleted = patient.deletedAt !== null;
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-2 text-sm">
        <div className="flex flex-col">
          <span className="font-medium">{patient.fullName}</span>
          {isDeleted && (
            <span className="self-start mt-1 inline-flex items-center rounded-md bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
              Deleted
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{patient.dob}</td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{patient.gender ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{patient.mrn ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{patient.phone ?? '—'}</td>
      <td className="px-3 py-2 text-right">
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
  );
}
