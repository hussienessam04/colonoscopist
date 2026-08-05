// ProcedureNotesPanel — append-only chronological log of mid-procedure notes
// rendered below the recording controls in the Procedure Room side-rail.
// Per CAPT-08 + D-06/D-07/D-08/D-09. Notes save via explicit Save button;
// empty/over-length bodies are filtered at the form layer (renderer) and
// enforced again at the DB layer (procedure_notes CHECK constraint).

import { useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProcedureNote } from '@shared/ipc-contract';

const PLACEHOLDER = 'Add a note (e.g. polyp at 12 o\'clock)';
const EMPTY_MESSAGE = 'No notes yet.';

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: 'numeric',
});

function formatNoteTime(ms: number): string {
  try {
    return timeFormatter.format(new Date(ms));
  } catch {
    return '';
  }
}

export type ProcedureNotesPanelProps = {
  procedureId: string | null;
};

export default function ProcedureNotesPanel({
  procedureId,
}: ProcedureNotesPanelProps): JSX.Element {
  const [notes, setNotes] = useState<ProcedureNote[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch the existing notes for the active procedure. Empty list on read
  // failure (D-07 — predictable audit trail, no half-rendered state).
  useEffect(() => {
    let cancelled = false;
    if (!procedureId) {
      setNotes([]);
      return () => {
        cancelled = true;
      };
    }
    void window.api.procedureNotes
      .list({ procedureId })
      .then((rows) => {
        if (!cancelled) setNotes(rows);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  const trimmed = body.trim();
  const canSave = !!procedureId && trimmed.length > 0 && !saving;

  async function handleSave(): Promise<void> {
    if (!procedureId || trimmed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await window.api.procedureNotes.create({
        procedureId,
        body: trimmed,
      });
      setNotes((prev) => [...prev, created]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="flex flex-col gap-2" aria-label="Procedure notes">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Procedure notes
      </p>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={PLACEHOLDER}
        disabled={!procedureId}
        aria-label="Procedure note input"
        maxLength={1000}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          aria-label="Save note"
        >
          Save note
        </Button>
      </div>
      <ScrollArea
        className="h-[280px] rounded-md border p-3"
        aria-label="Procedure notes history"
        data-testid="procedure-notes-scroll"
      >
        {notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{EMPTY_MESSAGE}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => (
              <li key={note.id} className="flex flex-col gap-0.5">
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={new Date(note.createdAt).toISOString()}
                >
                  {formatNoteTime(note.createdAt)}
                </time>
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}
