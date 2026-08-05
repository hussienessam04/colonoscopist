// @vitest-environment happy-dom
// Plan 04-02 — ProcedureNotesPanel component tests (G-04-2).
// Per D-06/D-07/D-08/D-09: empty body is a form-layer no-op; non-empty body
// triggers an IPC round-trip and appends the returned row to the bottom of
// the list (no optimistic UI). Textarea is disabled when procedureId is null.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import ProcedureNotesPanel from '@/components/procedure-notes-panel';
import type { ProcedureNote } from '@shared/ipc-contract';

const PROCEDURE_ID = '00000000-0000-4000-8000-000000000001';
const PATIENT_ID = '00000000-0000-4000-8000-000000000002';

function makeNote(id: number, body: string, createdAt: number): ProcedureNote {
  return {
    id,
    procedureId: PROCEDURE_ID,
    body,
    createdAt,
  };
}

beforeEach(() => {
  const api = getApi();
  api.procedureNotes.list.mockResolvedValue([]);
  api.procedureNotes.create.mockResolvedValue(
    makeNote(1, '', Date.now()),
  );
});

describe('ProcedureNotesPanel', () => {
  it('renders the empty state and disables the textarea when procedureId is null', async () => {
    render(<ProcedureNotesPanel procedureId={null} />);
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
    const textarea = screen.getByLabelText(/procedure note input/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    const save = screen.getByRole('button', { name: /save note/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('renders chronological notes (oldest first, newest last) and enables the textarea', async () => {
    const api = getApi();
    const t0 = Date.now() - 5_000;
    api.procedureNotes.list.mockResolvedValue([
      makeNote(1, 'First finding', t0),
      makeNote(2, 'Second finding', t0 + 1_000),
    ]);

    render(<ProcedureNotesPanel procedureId={PROCEDURE_ID} />);

    await waitFor(() => expect(api.procedureNotes.list).toHaveBeenCalledWith({ procedureId: PROCEDURE_ID }));
    expect(await screen.findByText('First finding')).toBeInTheDocument();
    expect(screen.getByText('Second finding')).toBeInTheDocument();

    const textarea = screen.getByLabelText(/procedure note input/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it('Save click with empty/whitespace body does NOT call procedureNotes.create', async () => {
    const api = getApi();
    render(<ProcedureNotesPanel procedureId={PROCEDURE_ID} />);
    const textarea = await screen.findByLabelText(/procedure note input/i);
    const save = (await screen.findByRole('button', { name: /save note/i })) as HTMLButtonElement;

    // Empty input -> button stays disabled.
    expect(save.disabled).toBe(true);
    await userEvent.type(textarea, '   ');
    expect(save.disabled).toBe(true);
    await userEvent.click(save);
    expect(api.procedureNotes.create).not.toHaveBeenCalled();
  });

  it('Save click with a non-empty body calls IPC and appends the returned note at the bottom', async () => {
    const api = getApi();
    const now = Date.now();
    api.procedureNotes.list.mockResolvedValue([makeNote(1, 'Existing', now - 1_000)]);
    api.procedureNotes.create.mockResolvedValue(makeNote(2, 'Polyp at 12 o\'clock', now));

    render(<ProcedureNotesPanel procedureId={PROCEDURE_ID} />);
    const textarea = await screen.findByLabelText(/procedure note input/i);
    const save = (await screen.findByRole('button', { name: /save note/i })) as HTMLButtonElement;

    await userEvent.type(textarea, 'Polyp at 12 o\'clock');
    expect(save.disabled).toBe(false);

    await userEvent.click(save);

    await waitFor(() =>
      expect(api.procedureNotes.create).toHaveBeenCalledWith({
        procedureId: PROCEDURE_ID,
        body: 'Polyp at 12 o\'clock',
      }),
    );
    expect(await screen.findByText('Polyp at 12 o\'clock')).toBeInTheDocument();
    // Both rows must be in the DOM; the new note sits after the existing one.
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Existing');
    expect(items[1]).toHaveTextContent("Polyp at 12 o'clock");

    // Body input is cleared after a successful save.
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('IPC failure surfaces an inline error and does NOT append the note', async () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue([]);
    api.procedureNotes.create.mockRejectedValue(new Error('IPC rejected'));

    render(<ProcedureNotesPanel procedureId={PROCEDURE_ID} />);
    const textarea = await screen.findByLabelText(/procedure note input/i);
    const save = (await screen.findByRole('button', { name: /save note/i })) as HTMLButtonElement;

    await userEvent.type(textarea, 'cannot persist');
    await userEvent.click(save);

    expect(await screen.findByRole('alert')).toHaveTextContent(/IPC rejected/i);
    // The note must NOT have been appended to the notes list (it lives in
    // a <p> inside <li>; query the listitem scope so we don't match the
    // textarea's value).
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    // Body is preserved on failure so the user can retry without retyping.
    expect((textarea as HTMLTextAreaElement).value).toBe('cannot persist');
  });

  it('re-fetches notes when procedureId changes', async () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue([]);

    const { rerender } = render(<ProcedureNotesPanel procedureId={PROCEDURE_ID} />);
    await waitFor(() =>
      expect(api.procedureNotes.list).toHaveBeenLastCalledWith({ procedureId: PROCEDURE_ID }),
    );

    await act(async () => {
      rerender(<ProcedureNotesPanel procedureId={PATIENT_ID} />);
    });

    await waitFor(() =>
      expect(api.procedureNotes.list).toHaveBeenLastCalledWith({ procedureId: PATIENT_ID }),
    );
    expect(api.procedureNotes.list).toHaveBeenCalledTimes(2);
  });

  it('renders the ScrollArea wrapper with h-[280px]', async () => {
    render(<ProcedureNotesPanel procedureId={PROCEDURE_ID} />);
    const scroller = await screen.findByTestId('procedure-notes-scroll');
    expect(scroller.className).toContain('h-[280px]');
  });
});

// Silence the unused-import warning for vi in environments where tree-shaking
// drops the actual usage (typed above for clarity).
void vi;
