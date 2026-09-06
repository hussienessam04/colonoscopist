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
  procedureType: 'colon',
  instrument: null,
  premedicationOverride: null,
  esophagus: '',
  stomach: '',
  pylorus: '',
  duodenum: '',
  colon: '',
  ileum: '',
  conclusion: '',
  recommendation: '',
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
  colon: 'Initial findings text',
  conclusion: 'Diagnosis text',
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
  // Quick task 20260812-redesign-report — anatomy boxes switch on
  // procedureType. With procedureType='colon' the timeline renders
  // Colon + Ileum + (always-on) Conclusion + Recommendation.
  it('renders the colon anatomy boxes + conclusion + recommendation when procedureType=colon', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    await renderReportEditor();
    await waitFor(() => {
      expect(api.reports.getOrCreate).toHaveBeenCalled();
    });
    expect(screen.getByTestId('report-editor-colon')).toBeInTheDocument();
    expect(screen.getByTestId('report-editor-ileum')).toBeInTheDocument();
    expect(screen.getByTestId('report-editor-conclusion')).toBeInTheDocument();
    expect(screen.getByTestId('report-editor-recommendation')).toBeInTheDocument();
    expect(screen.queryByTestId('report-editor-esophagus')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-editor-stomach')).not.toBeInTheDocument();
  });

  // Quick task 20260906-report-editor-procedure-layout-screenshots-grid-bullet-button —
  // the procedure meta row carries Date / Duration / Doctor on a single
  // line via grid-cols-3, and the duration value uses the timezone-free
  // formatDuration (no Date math that drifts by UTC offset).
  it('procedure meta row is 3 columns with a timezone-free duration value', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    api.procedures.get.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000888',
      patientId: '00000000-0000-4000-8000-000000000001',
      doctorId: ADMIN_USER.id,
      startedAt: Date.UTC(2026, 8, 6, 10, 0, 0),
      endedAt: Date.UTC(2026, 8, 6, 12, 5, 30),
      // 2h 5m 30s = 7530s
      durationSeconds: 7530,
      status: 'completed',
      videoPath: 'video.mp4',
      videoPathOriginal: null,
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
      createdAt: Date.now(),
    });
    await renderReportEditor();
    const meta = await screen.findByTestId('report-editor-procedure-meta');
    expect(meta.className).toContain('grid-cols-3');
    // 2h 5m 30s = 02:05:30. Timezone-free, so this is the same in any UTC offset.
    expect(
      screen.getByTestId('report-editor-procedure-duration-value'),
    ).toHaveTextContent('02:05:30');
  });

  // Quick task 20260906-report-editor-layout-and-bullets — the bullet
  // button prefixes every non-empty line of the box with `"• "`. The
  // contract is symmetric: clicking again un-bullets every line.
  it('bullet button prefixes every non-empty line with "• " and un-bullets on a second click', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    api.reports.updateDraft.mockImplementation(async (input) => ({
      ...DRAFT_REPORT,
      colon: input.colon ?? '',
    }));
    await renderReportEditor();
    const colonBox = await screen.findByTestId('report-editor-colon');
    fireEvent.change(colonBox, { target: { value: 'line one\nline two\n\nline three' } });
    const bulletBtn = await screen.findByTestId('report-editor-bullet-colon');
    fireEvent.click(bulletBtn);
    await waitFor(() => {
      expect((colonBox as HTMLTextAreaElement).value).toBe(
        '• line one\n• line two\n\n• line three',
      );
    });
    // Second click strips the bullets.
    fireEvent.click(bulletBtn);
    await waitFor(() => {
      expect((colonBox as HTMLTextAreaElement).value).toBe(
        'line one\nline two\n\nline three',
      );
    });
  });

  it('draft textarea change fires api.reports.updateDraft after debounce', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    api.reports.updateDraft.mockImplementation(async (input) => ({
      ...DRAFT_REPORT,
      colon: input.colon ?? '',
    }));
    await renderReportEditor();
    const colonBox = await screen.findByTestId('report-editor-colon');
    // fireEvent.change fires React's onChange synchronously; the
    // hook schedules a 300ms debounce, then the wrapped fn runs and
    // calls api.reports.updateDraft.
    fireEvent.change(colonBox, { target: { value: 'A polyp was identified' } });
    await waitFor(
      () => {
        expect(api.reports.updateDraft).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
    const lastCall = api.reports.updateDraft.mock.calls.at(-1)![0] as {
      colon?: string;
    };
    expect(lastCall.colon).toContain('polyp');
  });

  it('after finalize, textarea change fires api.reports.updateFinalized instead', async () => {
    const api = getApi();
    // Mount with a finalized report so the first fetch lands in
    // finalized status.
    api.reports.getOrCreate.mockResolvedValue(FINALIZED_REPORT);
    api.reports.updateFinalized.mockImplementation(async (input) => ({
      ...FINALIZED_REPORT,
      colon: input.colon ?? FINALIZED_REPORT.colon,
    }));
    await renderReportEditor();
    // Wait for the "Finalized" badge so we know status === 'finalized'.
    await screen.findByTestId('report-editor-finalized-badge');
    const colonBox = screen.getByTestId('report-editor-colon');
    fireEvent.change(colonBox, { target: { value: 'Updated colon after finalize' } });
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

  // Quick task 20260906-pdf-min-bytes-print-preview-reveal-explorer —
  // 'Reveal in Explorer' button removed (the doctor doesn't use it;
  // the screenshot timeline already surfaces the source files).
});

// Plan 08-10 / G-08-4 — when procedures.get returns {ok:false} the

// Plan 08-10 / G-08-4 — when procedures.get returns {ok:false} the
// ReportEditor no longer crashes on undefined reads; it renders the
// <EmptyStateCard> inside the document Card.
describe('ReportEditor — gated-IPC graceful degrade (08-10)', () => {
  it('renders <EmptyStateCard> when procedures.get returns {ok: false, code: IPC_LICENSE_INVALID}', async () => {
    const api = getApi();
    api.reports.getOrCreate.mockResolvedValue(DRAFT_REPORT);
    api.procedures.get.mockResolvedValue({ ok: false, code: 'IPC_LICENSE_INVALID' });
    await renderReportEditor();
    expect(await screen.findByTestId('gated-empty-state')).toBeInTheDocument();
  });
});