// @vitest-environment happy-dom
// ProcedureNotesReview — read-only Notes accordion. Plan 02 ships D-09 +
// D-12 polish (default-open for completed, empty-state copy).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { getApi } from '../setup';
import { ProcedureNotesReview } from '@/components/ProcedureNotesReview';
import type { ProcedureNote } from '@shared/ipc-contract';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixture: ProcedureNote[] = [
  {
    id: 1,
    procedureId: 'p1',
    body: 'first note in time',
    createdAt: 1_000_000_000,
  },
  {
    id: 2,
    procedureId: 'p1',
    body: 'middle note',
    createdAt: 2_000_000_000,
  },
  {
    id: 3,
    procedureId: 'p1',
    body: 'last note in time',
    createdAt: 3_000_000_000,
  },
];

describe('ProcedureNotesReview', () => {
  beforeEach(() => {
    const api = getApi();
    api.procedureNotes.list.mockReset();
  });

  it('renders the empty-state copy when no notes are returned', async () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue([]);

    render(<ProcedureNotesReview procedureId="p1" status="completed" />);

    // Default-open for completed -> empty state appears after the API resolves.
    await waitFor(() => {
      expect(
        screen.getByText(/No notes recorded for this procedure\./i),
      ).toBeInTheDocument();
    });
  });

  it('renders the notes list in created_at ASC order', async () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue(fixture);

    render(<ProcedureNotesReview procedureId="p1" status="completed" />);

    // ASC order: id=1 (first), id=2, id=3
    await waitFor(() => {
      expect(screen.getByText('first note in time')).toBeInTheDocument();
    });
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('first note in time');
    expect(items[1]?.textContent).toContain('middle note');
    expect(items[2]?.textContent).toContain('last note in time');
  });

  it('expands by default for status=completed', async () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue(fixture);

    render(<ProcedureNotesReview procedureId="p1" status="completed" />);

    await waitFor(() => {
      expect(screen.getByText('first note in time')).toBeInTheDocument();
    });
  });

  it('is collapsed by default for status=partial', () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue(fixture);

    render(<ProcedureNotesReview procedureId="p1" status="partial" />);

    // No click needed — the trigger button is present but content not visible.
    expect(screen.queryByText('first note in time')).toBeNull();
    expect(screen.getByRole('button', { name: /Notes \(0\)/i })).toBeInTheDocument();
  });

  it('does NOT include an input (read-only)', async () => {
    const api = getApi();
    api.procedureNotes.list.mockResolvedValue(fixture);

    render(<ProcedureNotesReview procedureId="p1" status="completed" />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Notes are read-only in Review\./i)).toBeInTheDocument();
  });
});
