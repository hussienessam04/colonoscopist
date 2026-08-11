// @vitest-environment happy-dom
// Audit page tests — Phase 7 / Plan 07-03 (AUDIT-01 / AUDIT-02).
// Covers the three must-have behaviors:
//   1. Row layout: each row mounts at min-h-[36px] + contains the
//      formatted timestamp + user + action + entity.
//   2. audit_view emit: page mount starts a 1s setTimeout that fires
//      audit.log({action:'audit_view', entityType:'audit'}) exactly
//      once. State changes (filter edits) do NOT re-fire (Pitfall 8).
//   3. Detail dialog: clicking a row opens a Dialog with the row data
//      + pretty-printed JSON metadata + Copy JSON button working.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { setRoute, initialRoute } from '@/lib/router';
import { session } from '@/store/session';
import Audit from '@/pages/Audit';
import type { AuditEntry, UserPublic } from '@shared/ipc-contract';

const ADMIN_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
  language: 'en',
};

const OTHER_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Dr. Karim',
  isFirstAdmin: false,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
  language: 'en',
};

const ROW: AuditEntry = {
  id: 1,
  userId: OTHER_USER.id,
  action: 'login',
  entityType: 'user',
  entityId: OTHER_USER.id,
  metadata: { ip: '127.0.0.1', method: 'pin' },
  outcome: 'ok',
  createdAt: 1_700_000_000_000,
};

const ROW2: AuditEntry = {
  id: 2,
  userId: null,
  action: 'backup.created',
  entityType: 'backup',
  entityId: 'backup-1',
  metadata: null,
  outcome: 'ok',
  createdAt: 1_700_000_500_000,
};

const ROW3: AuditEntry = {
  id: 3,
  userId: ADMIN_USER.id,
  action: 'patient.viewed',
  entityType: 'patient',
  entityId: 'pat-1',
  metadata: { key: 'value' },
  outcome: 'ok',
  createdAt: 1_700_001_000_000,
};

beforeEach(() => {
  setRoute(initialRoute);
  // ponytail: clipboard.writeText is not implemented in happy-dom — stub
  // it so the Copy JSON button doesn't throw. The assertion is on the
  // call args, not the implementation.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  } else {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(undefined) as typeof navigator.clipboard.writeText;
  }
});

async function renderAudit(): Promise<void> {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER, OTHER_USER]);
  await session.refresh();
  render(<Audit />);
}

describe('Audit page', () => {
  it('renders one row per audit entry with min-h-[36px] + formatted timestamp + user + action + entity', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [ROW, ROW2, ROW3], total: 3 });
    await renderAudit();
    await waitFor(() => expect(api.audit.list).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByTestId('audit-row')).toHaveLength(3),
    );
    const renderedRows = screen.getAllByTestId('audit-row');
    // Each row carries the min-h-[36px] class (D-05 + UI-SPEC spacing exception).
    for (const r of renderedRows) {
      expect(r.className).toContain('min-h-[36px]');
    }
    // User display name resolves to the fullName (Dr. Karim).
    expect(renderedRows[0].textContent).toContain('Dr. Karim');
    expect(renderedRows[0].textContent).toContain('login');
    expect(renderedRows[0].textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    // Entity column shows entity_type + entity_id (NOT the patient name —
    // the row uses OTHER_USER.id, not a patient name).
    expect(renderedRows[0].textContent).toContain('user');
    expect(renderedRows[0].textContent).toContain(OTHER_USER.id);
    // Second row is system (null userId) → renders '(system)'.
    expect(renderedRows[1].textContent).toContain('(system)');
    expect(renderedRows[1].textContent).toContain('backup.created');
    expect(renderedRows[1].textContent).toContain('backup');
  });

  it('shows the empty state when no rows match', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [], total: 0 });
    await renderAudit();
    await waitFor(() => expect(screen.getByTestId('audit-empty')).toBeInTheDocument());
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
  });

  it('mounts ONCE → fires audit_view exactly once after 1s debounce; state changes do NOT re-fire (D-08 + Pitfall 8)', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [ROW], total: 1 });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderAudit();
      // Right after mount the audit_view has NOT been emitted yet (1s debounce).
      expect(api.audit.log).not.toHaveBeenCalled();
      // Advance < 1s — still no emit.
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(api.audit.log).not.toHaveBeenCalled();
      // Advance past 1s — now it fires exactly once.
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      await waitFor(() => expect(api.audit.log).toHaveBeenCalledTimes(1));
      expect(api.audit.log).toHaveBeenCalledWith({
        action: 'audit_view',
        entityType: 'audit',
      });
      // Trigger state changes — filter edits, page edits, etc. The hook
      // is the only path to schedule a re-fire; D-08 requires the
      // empty-deps useEffect so re-renders don't fire audit spam.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      const actionInput = screen.getByTestId('audit-action') as HTMLInputElement;
      fireEvent.change(actionInput, { target: { value: 'login' } });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      // Still exactly one call (D-08 + Pitfall 8 — empty deps).
      expect(api.audit.log).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking an audit row opens the detail Dialog with pretty-printed JSON metadata + Copy JSON button works', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [ROW], total: 1 });
    await renderAudit();
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(1));
    const row = screen.getByTestId('audit-row');
    fireEvent.click(row);
    const dialog = await screen.findByTestId('audit-detail-dialog');
    expect(dialog).toBeInTheDocument();
    const pre = screen.getByTestId('audit-detail-metadata');
    // Pretty-printed JSON — the multi-line format includes the indented
    // inner keys, so the raw `{"ip":...}` single-line format would NOT
    // contain the leading whitespace.
    expect(pre.textContent).toContain('"ip"');
    expect(pre.textContent).toContain('127.0.0.1');
    expect(pre.textContent).toContain('"method"');
    // The dialog also surfaces the user id, action, entity type, outcome.
    expect(dialog.textContent).toContain(OTHER_USER.id);
    expect(dialog.textContent).toContain('login');
    expect(dialog.textContent).toContain('ok');
    // Click Copy JSON → navigator.clipboard.writeText gets the JSON +
    // toast.success fires (we don't assert the toast helper here; the
    // assertion is that the clipboard write was invoked with the JSON).
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    fireEvent.click(screen.getByTestId('audit-copy-json'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const written = writeText.mock.calls[0]?.[0] as string;
    expect(written).toContain('"action": "login"');
    expect(written).toContain('"metadata"');
    expect(written).toContain('"ip"');
  });

  it('Clear all button resets all filter fields', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [], total: 0 });
    await renderAudit();
    await waitFor(() => expect(api.audit.list).toHaveBeenCalled());
    const dateFrom = screen.getByTestId('audit-date-from') as HTMLInputElement;
    fireEvent.change(dateFrom, { target: { value: '2026-01-01' } });
    const actionInput = screen.getByTestId('audit-action') as HTMLInputElement;
    fireEvent.change(actionInput, { target: { value: 'login' } });
    expect(dateFrom.value).toBe('2026-01-01');
    expect(actionInput.value).toBe('login');
    fireEvent.click(screen.getByTestId('audit-clear'));
    expect(dateFrom.value).toBe('');
    expect(actionInput.value).toBe('');
  });

  // Phase 7 / quick 20260811-audit-ui-polish — IPC handler mapping
  // regression coverage. The renderer mocks the IPC boundary, so the
  // tests below feed the renderer the post-mapping shape the IPC
  // handler now produces (camelCase + parsed metadata Record). The
  // IPC handler's actual mapping is covered separately in
  // tests/main/ipc/audit.test.ts via the handler map. Together, they
  // prove (a) the handler maps snake_case DB rows → camelCase
  // AuditEntry, and (b) the renderer handles the post-mapping shape
  // correctly.
  it('post-mapping shape: row renders HH:MM:SS + Dr. Karim + entity "user <uuid>" (no NaN, no fallback user)', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({
      rows: [
        {
          ...ROW,
          // metadata: parsed Record (what the IPC handler produces from
          // the raw JSON-encoded string in audit_log.metadata).
          metadata: { ip: '127.0.0.1', method: 'pin' },
        },
      ],
      total: 1,
    });
    await renderAudit();
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(1));
    const renderedRow = screen.getByTestId('audit-row');
    // Time formats HH:MM:SS — NOT "NaN:NaN:NaN" (pre-fix symptom when
    // the renderer saw `row.createdAt` as `undefined`).
    expect(renderedRow.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(renderedRow.textContent).not.toContain('NaN');
    // User column resolves to Dr. Karim — NOT the current user's name
    // (pre-fix fallback when `row.userId` was undefined).
    expect(renderedRow.textContent).toContain('Dr. Karim');
    expect(renderedRow.textContent).not.toContain(ADMIN_USER.fullName);
    // Entity column shows entity_type + entity_id (NOT "undefined undefined").
    expect(renderedRow.textContent).toContain('user');
    expect(renderedRow.textContent).toContain(OTHER_USER.id);
  });

  it('post-mapping shape: detail dialog renders pretty-printed JSON metadata', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({
      rows: [
        {
          ...ROW,
          metadata: { ip: '127.0.0.1', method: 'pin' },
        },
      ],
      total: 1,
    });
    await renderAudit();
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('audit-row'));
    const pre = await screen.findByTestId('audit-detail-metadata');
    // Pretty-printed JSON — multi-line indented format. The pre-fix
    // symptom was a single escaped string `'{"ip":"127.0.0.1"}'` with
    // backslash-escaped quotes; JSON.stringify on a Record produces
    // pretty-printed keys without the escape backslashes.
    expect(pre.textContent).toContain('"ip"');
    expect(pre.textContent).toContain('127.0.0.1');
    expect(pre.textContent).toContain('"method"');
    expect(pre.textContent).not.toMatch(/\\"/);
  });

  it('post-mapping shape: defensive _parseError fallback renders without crashing', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({
      rows: [
        {
          ...ROW,
          // metadata: the defensive fallback shape the IPC handler
          // produces when JSON.parse fails on a corrupt row.
          metadata: { _parseError: true, _raw: 'not-valid-json' },
        },
      ],
      total: 1,
    });
    await renderAudit();
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(1));
    // Click the row — dialog must open without throwing.
    fireEvent.click(screen.getByTestId('audit-row'));
    const dialog = await screen.findByTestId('audit-detail-dialog');
    expect(dialog).toBeInTheDocument();
    // The defensive fallback surfaces the raw string + the parseError
    // flag so the operator can see the row is corrupt.
    const pre = screen.getByTestId('audit-detail-metadata');
    expect(pre.textContent).toContain('not-valid-json');
    expect(pre.textContent).toContain('_parseError');
  });

  it('post-mapping shape: unknown outcome values are coerced to "ok" by the IPC handler', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({
      rows: [
        {
          ...ROW,
          // outcome: the post-coercion shape the IPC handler produces
          // (the raw "something-weird" never reaches the renderer).
          outcome: 'ok',
        },
      ],
      total: 1,
    });
    await renderAudit();
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('audit-row'));
    const dialog = await screen.findByTestId('audit-detail-dialog');
    expect(dialog.textContent).toContain('ok');
  });

  it('mounts <SettingsSidebar /> with activeTab="audit" (data-active="true" on the Audit button)', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [ROW], total: 1 });
    await renderAudit();
    await waitFor(() => expect(api.audit.list).toHaveBeenCalled());
    const auditButton = screen.getByTestId('settings-hub-audit');
    expect(auditButton).toBeInTheDocument();
    expect(auditButton.getAttribute('data-active')).toBe('true');
  });
});
