// Reusable StatusBadge — wraps shadcn `<Badge>` with the canonical mapping
// from `ProcedureStatus` to Badge variant. The mapping was lifted out of
// ProcedureReview.tsx (Phase 4) so Phase 7's procedure-list view + Phase 6's
// PDF report can reuse it without re-implementing.
//
// Per T-05-19 — single source of truth for the variant mapping.

import { Badge } from '@/components/ui/badge';
import type { ProcedureStatus } from '@shared/ipc-contract';

function statusBadgeVariant(
  status: ProcedureStatus,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'completed') return 'default';
  if (status === 'recording' || status === 'partial') return 'secondary';
  return 'destructive';
}

export type StatusBadgeProps = {
  status: ProcedureStatus;
  className?: string;
  testId?: string;
};

export function StatusBadge({ status, className, testId }: StatusBadgeProps): JSX.Element {
  return (
    <Badge
      variant={statusBadgeVariant(status)}
      className={`capitalize ${className ?? ''}`}
      data-testid={testId ?? 'status-badge'}
      data-status={status}
    >
      {status}
    </Badge>
  );
}

// ponytail: export the variant helper so the same mapping can be reused in
// tests + future components without going through StatusBadge.
export { statusBadgeVariant };
