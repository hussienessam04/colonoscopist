// ProcedureNotesReview — read-only Notes accordion for the Procedure Review
// screen. Mirrors the Phase 4 in-procedure notes panel shape (timestamp +
// body) but the input is hidden: the doctor CANNOT add new notes from the
// review screen (Phase 4 owns the in-procedure input). Per D-09 notes are
// listed in `created_at ASC` order.
//
// Default-open state:
//   * `status === 'completed'` → expanded (the doctor is reviewing a
//     finished recording and wants context immediately)
//   * any other status → collapsed (no need to spam the right rail on
//     partial / crashed entries)

import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { ProcedureNote, ProcedureStatus } from '@shared/ipc-contract';

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

function formatNoteTime(ms: number): string {
  try {
    return timeFormatter.format(new Date(ms));
  } catch {
    return '';
  }
}

export type ProcedureNotesReviewProps = {
  procedureId: string | null;
  status: ProcedureStatus;
  testId?: string;
};

export function ProcedureNotesReview({
  procedureId,
  status,
  testId,
}: ProcedureNotesReviewProps): JSX.Element {
  const [notes, setNotes] = useState<ProcedureNote[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!procedureId) {
      setNotes([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void window.api.procedureNotes
      .list({ procedureId })
      .then((rows) => {
        if (!cancelled) setNotes(rows);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const defaultValue = status === 'completed' ? 'notes' : undefined;

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultValue}
      className="rounded-md border bg-card px-3 shadow-sm"
    >
      <AccordionItem value="notes" data-testid={testId ?? 'procedure-notes-review'}>
        <AccordionTrigger>
          <span className="flex-1 text-left text-sm">Notes ({notes.length})</span>
        </AccordionTrigger>
        <AccordionContent>
          <p className="mb-2 text-xs italic text-muted-foreground">
            Notes are read-only in Review.
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-slate-500">No notes recorded for this procedure.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <span className="mr-2 text-xs text-slate-500">
                    {formatNoteTime(n.createdAt)}
                  </span>
                  <span>{n.body}</span>
                </li>
              ))}
            </ul>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
