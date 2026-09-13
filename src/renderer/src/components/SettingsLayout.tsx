// SettingsLayout — unified shell for every Settings sub-page.
// Per quick task 260812-n0h: every settings page renders the same
// header (kicker "Settings" + h1 + optional subtitle + optional
// right-side action slot + Back button) + the same left sidebar
// (SettingsSidebar) + the same outer grid (16rem sidebar / minmax
// content). The header kicker is hard-coded "Settings" — pages do
// NOT pass their own kicker (the prior divergence was Hub=Workspace,
// Capture=Settings, others=i18n).
//
// The Back button navigates to `settings-hub` on every page by
// default; the SettingsHub itself overrides this via its own
// `backTo` / `backLabel` (returns to `patients` with "Back to patients").
//
// Test seams:
//   - The wrapper carries no `data-testid` of its own (it would
//     duplicate across 6 pages).
//   - `backTestId` defaults to `'settings-layout-back'`; pages pass
//     their historical id (`settings-hub-back`, `audit-back`,
//     `backup-restore-back`, `profile-editor-back`) so existing tests
//     keep finding the button.
//   - `headerAction` renders in the header's right-side flex row;
//     the SettingsCapture Save button lives there now (moved from
//     inside the right aside) — the existing `data-testid="save-capture"`
//     contract is preserved.

import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { SettingsSidebar, type SettingsTab } from '@/components/SettingsSidebar';
import { useRoute } from '@/lib/router';
import type { Route } from '@/lib/router';

type Props = {
  /** h1 text — the page-specific title (e.g. "Capture", "Users", "Audit"). */
  title: string;
  /** Optional muted-text line under the h1. */
  subtitle?: string;
  /** Active sidebar entry. `undefined` = no entry active (hub). */
  activeTab?: SettingsTab;
  /** Right-side action slot (e.g. Save button on Capture, Add user on Users). */
  headerAction?: ReactNode;
  /** Override the default back-testid. Defaults to `settings-layout-back`. */
  backTestId?: string;
  /** Override the default back-destination. Defaults to `settings-hub`. */
  backTo?: Route;
  /** Override the default back-label. Defaults to "Back". */
  backLabel?: string;
  /** Optional banner rendered above the content card (e.g. in-progress download). */
  updateBanner?: ReactNode;
  /** Body content — the page's own layout goes inside the right column. */
  children: ReactNode;
};

export function SettingsLayout({
  title,
  subtitle,
  activeTab,
  headerAction,
  backTestId = 'settings-layout-back',
  backTo = { name: 'settings-hub' },
  backLabel = 'Back',
  updateBanner,
  children,
}: Props): JSX.Element {
  const { navigate } = useRoute();
  return (
    <main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <SettingsSidebar activeTab={activeTab} />
        <div className="flex flex-col gap-5">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E0D9C6] pb-4">
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]">
                Settings
              </p>
              <h1 className="text-2xl font-medium tracking-tight text-[#13202E]">{title}</h1>
              {subtitle ? (
                <p className="text-sm text-[#5C6770]">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {headerAction}
              <Button
                variant="outline"
                onClick={() => navigate(backTo)}
                data-testid={backTestId}
                className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
              >
                <ArrowLeft className="size-4 mr-1" aria-hidden="true" />
                {backLabel}
              </Button>
            </div>
          </header>
          {updateBanner}
          <div className="relative overflow-hidden rounded-lg border border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1 bg-[#0E3A47]"
            />
            <div className="relative flex flex-col gap-5 p-6 pl-7">
              {children}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default SettingsLayout;