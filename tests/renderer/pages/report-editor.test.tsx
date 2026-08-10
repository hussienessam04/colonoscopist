// @vitest-environment happy-dom
// Plan 06-02 Task 10 — ReportEditor tests.
// Per CONTEXT.md §Report fields + D-07: 4 textareas (findings /
 // diagnosis / recommendations / procedureDetails), auto-save-on-blur
 // via useAutoSave; route api.reports.updateDraft for drafts +
 // api.reports.updateFinalized post-finalize. Screenshot attach via
 // the extended ScreenshotTimeline + useAttachedScreenshots. Finalize
 // button calls api.reports.finalize and renders a "Finalized" badge.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getApi } from '../setup';
import { setRoute, initialRoute } from '@/lib/router';
import { session } from '@/store/session';
import ReportEditor from '@/pages/ReportEditor';
import type { Report, UserPublic } from '@shared/ipc-contract';

const ADMIN_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
};

const DRAFT_REPORT: Report = {
  id: '00000000-0000-4000-8000-000000000777',
  procedureId: '00000000-0000-4000-8000-000000000888',
  doctorId: ADMIN_USER.id,
  findings: '',
  diagnosis: '',
  recommendations: '',
  procedureDetails: '',
  status: 'draft',
  finalizedAt: null,
  pdfPath: null,
  pdfGeneratedAt: null,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const FINALIZED_REPORT: Report = {
  ...DRAFT_REPORT,
  status: 'finalized',
  finalizedAt: 5_000,
  pdfPath: 'data/reports/777.pdf',
  pdfGeneratedAt: 5_000,
  findings: 'Initial findings text',
  diagnosis: 'Diagnosis text',
  recommendations: 'Recs',
  procedureDetails: 'Details',
  updatedAt: 5_000,
};

function setSession(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER]);
}

beforeEach(() => {
  setRoute(initialRoute);
});

async function renderReportEditor(): Promise<void> {
  setSession();
  await session.refresh();
  render(<ReportEditor procedureId={DRAFT_REPORT.procedureId} reportId={DRAFT_REPORT.id} />);
}

describe('ReportEditor', () => {
  // Phase 6 UAT G-06-10 — Recommendations + procedureDetails removed
  // from the editor. Only Findings + Diagnosis remain.
  it('renders 2 textareas (Findings + Diagnosis)', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    await renderReportEditor();
    await waitFor(() => {
      expect(api.reports.getOrCreate).toHaveBeenCalled();
    });
    expect(screen.getByTestId('report-editor-findings')).toBeInTheDocument();
    expect(screen.getByTestId('report-editor-diagnosis')).toBeInTheDocument();
    expect(screen.queryByTestId('report-editor-recommendations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-editor-procedureDetails')).not.toBeInTheDocument();
  });

  it('draft textarea change fires api.reports.updateDraft after debounce', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    api.reports.updateDraft.mockImplementation(async (input) => ({
      ...DRAFT_REPORT,
      findings: input.findings ?? '',
      diagnosis: input.diagnosis ?? '',
    }));
    await renderReportEditor();
    const findings = await screen.findByTestId('report-editor-findings');
    // fireEvent.change fires React's onChange synchronously; the
    // hook schedules a 300ms debounce, then the wrapped fn runs and
    // calls api.reports.updateDraft.
    fireEvent.change(findings, { target: { value: 'A polyp was identified' } });
    await waitFor(
      () => {
        expect(api.reports.updateDraft).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
    const lastCall = api.reports.updateDraft.mock.calls.at(-1)![0] as {
      findings?: string;
    };
    expect(lastCall.findings).toContain('polyp');
  });

  it('after finalize, textarea change fires api.reports.updateFinalized instead', async () => {
    const api = getApi();
    // Mount with a finalized report so the first fetch lands in
    // finalized status.
    api.reports.getOrCreate.mockResolvedValue(FINALIZED_REPORT);
    api.reports.updateFinalized.mockImplementation(async (input) => ({
      ...FINALIZED_REPORT,
      findings: input.findings ?? FINALIZED_REPORT.findings,
    }));
    await renderReportEditor();
    // Wait for the "Finalized" badge so we know status === 'finalized'.
    await screen.findByTestId('report-editor-finalized-badge');
    const findings = screen.getByTestId('report-editor-findings');
    fireEvent.change(findings, { target: { value: 'Updated findings after finalize' } });
    await waitFor(
      () => {
        expect(api.reports.updateFinalized).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
    expect(api.reports.updateDraft).not.toHaveBeenCalled();
  });

  it('Finalize button calls api.reports.finalize and the badge appears', async () => {
    const api = getApi();
    const FINALIZED_ROW: Report = {
      ...DRAFT_REPORT,
      status: 'finalized',
      finalizedAt: Date.now(),
      pdfPath: 'data/reports/777.pdf',
      pdfGeneratedAt: Date.now(),
    };
    // ponytail: stateful mock — first fetch returns the DRAFT, the
    // post-finalize refresh returns the FINALIZED row. Simulates the
    // main-side state change.
    let currentRow: Report = DRAFT_REPORT;
    api.reports.getOrCreate.mockImplementation(async () => currentRow);
    api.reports.finalize.mockImplementation(async () => {
      currentRow = FINALIZED_ROW;
      return FINALIZED_ROW;
    });
    await renderReportEditor();
    const finalizeBtn = await screen.findByTestId('report-editor-finalize');
    // Wrap the click in act so React flushes the awaited IPC.
    await act(async () => {
      fireEvent.click(finalizeBtn);
      // Drain microtasks for the awaited finalize IPC + refresh().
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.reports.finalize).toHaveBeenCalled();
    });
    // Badge surfaces after the IPC round-trip + refresh().
    await waitFor(() => {
      expect(screen.getByTestId('report-editor-finalized-badge')).toBeInTheDocument();
    });
  });

  it('Re-render PDF button only renders post-finalize', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(FINALIZED_REPORT);
    api.reports.regenPdf.mockResolvedValue({ pdfPath: 'data/reports/777.pdf' });
    await renderReportEditor();
    // The button only mounts post-finalize.
    await screen.findByTestId('report-editor-finalized-badge');
    expect(screen.getByTestId('report-editor-regen-pdf')).toBeInTheDocument();
  });

  it('Open PDF button (post-finalize) calls api.reports.openPdf with reveal: false', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(FINALIZED_REPORT);
    api.reports.openPdf.mockResolvedValue({ opened: true });
    await renderReportEditor();
    await screen.findByTestId('report-editor-open-pdf');
    await act(async () => {
      fireEvent.click(screen.getByTestId('report-editor-open-pdf'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.reports.openPdf).toHaveBeenCalled();
    });
    const lastCall = api.reports.openPdf.mock.calls.at(-1)![0] as {
      id: string;
      reveal?: boolean;
    };
    expect(lastCall.id).toBe('00000000-0000-4000-8000-000000000777');
    expect(lastCall.reveal).toBe(false);
  });

  it('Reveal in Explorer button (post-finalize) calls api.reports.openPdf with reveal: true', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(FINALIZED_REPORT);
    api.reports.openPdf.mockResolvedValue({ opened: true });
    await renderReportEditor();
    await screen.findByTestId('report-editor-reveal-pdf');
    await act(async () => {
      fireEvent.click(screen.getByTestId('report-editor-reveal-pdf'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.reports.openPdf).toHaveBeenCalled();
    });
    const lastCall = api.reports.openPdf.mock.calls.at(-1)![0] as {
      id: string;
      reveal?: boolean;
    };
    expect(lastCall.id).toBe('00000000-0000-4000-8000-000000000777');
    expect(lastCall.reveal).toBe(true);
  });
});