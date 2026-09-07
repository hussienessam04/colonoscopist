// SettingsSidebar — shared sidebar nav for every Settings page.
// Per Plan 03-06 (G-03-6): the right-side SettingsHub sidebar is extracted
// into a reusable component that SettingsHub (no activeTab), SettingsCapture
// (activeTab="capture"), and SettingsUsers (activeTab="users") each mount.
// The active tab carries `data-active="true"` and uses the default (filled)
// variant; the inactive tab carries `data-active="false"` and uses the
// outline variant. The Users button stays `disabled={!isAdmin}` regardless
// of which page mounts the sidebar so the admin gate (T-3-22) travels with
// the component. The two `data-testid` values match the prior inline <aside>
// so the existing SettingsHub tests keep finding the buttons.
//
// Phase 6 / Plan 02 — Profile entry. Per CONTEXT.md §Phase 6, every
// doctor edits their own profile (no admin gate). The Profile button
// lives alongside Capture + Users in the sidebar. The active highlight
// keys on route.name === 'profile-edit' since the profile page has no
// `activeTab` prop.
//
// Phase 7 / Plan 07-02 — D-05 + D-11: Audit + Backup & Restore entries.
// Visual only — the page bodies land in Plan 07-03 (Audit) and Plan 07-05
// (Backup & Restore). Audit + Backup & Restore buttons are NOT admin-gated
// per UI-SPEC §Implementation Bindings — every doctor sees them. Visual
// order is Capture → Profile → Audit → Backup & Restore → Users.
//
// Phase 8 / Plan 08-05 — License entry (LIC-03). Sits BETWEEN Audit and
// Backup & Restore per CONTEXT D-04. The icon is `KeyRound` from the same
// lucide-react set (matches the sibling icons). The button is NOT
// admin-gated — every doctor sees it. The active highlight keys on the
// new `activeTab === 'license'` value; the route union's `{name:
// 'license'}` was added to lib/router.ts so the navigate() call compiles.

import { FileSearch, HardDrive, KeyRound, Shield, UserCircle, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSession } from '@/store/session';
import { useRoute } from '@/lib/router';
import { useLicenseStatus } from '@/hooks/useLicenseStatus';
import type { LicenseState } from '@shared/ipc-contract';

export type SettingsTab =
  | 'capture'
  | 'users'
  | 'profile'
  | 'audit'
  | 'license'
  | 'backup-restore';

// Plan 08-13 / UI audit Blocker 3 — the `sidebarBadge*` keys had no usage
// site. The License entry now renders a colour dot + the state label so a
// doctor can tell Trial from Expired without opening the page. Literal
// class strings so tailwind's JIT picks them up.
const LICENSE_DOT_COLOR: Record<LicenseState, string> = {
  licensed: 'bg-emerald-500',
  trial: 'bg-blue-500',
  expired: 'bg-red-500',
  unactivated: 'bg-slate-500',
};

export function SettingsSidebar({ activeTab }: { activeTab?: SettingsTab }): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  const { t } = useTranslation();
  const { status: licenseStatus } = useLicenseStatus();
  const isAdmin = currentUser?.isFirstAdmin ?? false;
  const licenseState = licenseStatus?.state ?? null;
  const licenseBadge =
    licenseState === null
      ? null
      : licenseState === 'trial'
        ? t('license.sidebarBadgeTrial', { count: licenseStatus?.trialDaysRemaining ?? 0 })
        : t(
            `license.sidebarBadge${licenseState.charAt(0).toUpperCase()}${licenseState.slice(1)}`,
          );

  return (
    <aside className="flex flex-col gap-2 rounded-lg border border-[#E0D9C6] bg-[#EFEAE0] p-4 shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
        Sections
      </p>
      <Button
        variant={activeTab === 'capture' ? 'default' : 'outline'}
        className={
          activeTab === 'capture'
            ? 'justify-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]'
            : 'justify-start border border-[#E0D9C6] bg-[#FBF7EE] text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47] hover:border-[#0E3A47]'
        }
        onClick={() => navigate({ name: 'settings-capture' })}
        data-testid="settings-hub-capture"
        data-active={activeTab === 'capture' ? 'true' : 'false'}
      >
        <Video className="size-4 mr-2" aria-hidden="true" />
        Capture
      </Button>
      <Button
        variant={activeTab === 'profile' ? 'default' : 'outline'}
        className={
          activeTab === 'profile'
            ? 'justify-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]'
            : 'justify-start border border-[#E0D9C6] bg-[#FBF7EE] text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47] hover:border-[#0E3A47]'
        }
        onClick={() => navigate({ name: 'profile-edit' })}
        data-testid="settings-hub-profile"
        data-active={activeTab === 'profile' ? 'true' : 'false'}
      >
        <UserCircle className="size-4 mr-2" aria-hidden="true" />
        Profile
      </Button>
      <Button
        variant={activeTab === 'audit' ? 'default' : 'outline'}
        className={
          activeTab === 'audit'
            ? 'justify-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]'
            : 'justify-start border border-[#E0D9C6] bg-[#FBF7EE] text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47] hover:border-[#0E3A47]'
        }
        onClick={() => navigate({ name: 'audit' })}
        data-testid="settings-hub-audit"
        data-active={activeTab === 'audit' ? 'true' : 'false'}
      >
        <FileSearch className="size-4 mr-2" aria-hidden="true" />
        Audit
      </Button>
      <Button
        variant={activeTab === 'license' ? 'default' : 'outline'}
        className={
          activeTab === 'license'
            ? 'justify-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]'
            : 'justify-start border border-[#E0D9C6] bg-[#FBF7EE] text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47] hover:border-[#0E3A47]'
        }
        onClick={() => navigate({ name: 'license' })}
        data-testid="settings-hub-license"
        data-active={activeTab === 'license' ? 'true' : 'false'}
      >
        <KeyRound className="size-4 mr-2" aria-hidden="true" />
        {t('license.sidebarEntry')}
        {licenseState !== null ? (
          <>
            <span
              className={`ms-auto inline-block size-2 shrink-0 rounded-full ${LICENSE_DOT_COLOR[licenseState]}`}
              data-testid="settings-hub-license-dot"
              data-state={licenseState}
              aria-hidden="true"
            />
            <span
              className="ms-2 truncate text-xs font-normal text-[#A39A86]"
              data-testid="settings-hub-license-badge"
            >
              {licenseBadge}
            </span>
          </>
        ) : null}
      </Button>
      <Button
        variant={activeTab === 'backup-restore' ? 'default' : 'outline'}
        className={
          activeTab === 'backup-restore'
            ? 'justify-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]'
            : 'justify-start border border-[#E0D9C6] bg-[#FBF7EE] text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47] hover:border-[#0E3A47]'
        }
        onClick={() => navigate({ name: 'backup-restore' })}
        data-testid="settings-hub-backup-restore"
        data-active={activeTab === 'backup-restore' ? 'true' : 'false'}
      >
        <HardDrive className="size-4 mr-2" aria-hidden="true" />
        Backup &amp; restore
      </Button>
      <Button
        variant={activeTab === 'users' ? 'default' : 'outline'}
        className={
          activeTab === 'users'
            ? 'justify-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]'
            : 'justify-start border border-[#E0D9C6] bg-[#FBF7EE] text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47] hover:border-[#0E3A47] disabled:opacity-50 disabled:cursor-not-allowed'
        }
        onClick={() => navigate({ name: 'settings-users' })}
        disabled={!isAdmin}
        title={isAdmin ? 'Manage users' : 'Admin only'}
        data-testid="settings-hub-users"
        data-active={activeTab === 'users' ? 'true' : 'false'}
      >
        <Shield className="size-4 mr-2" aria-hidden="true" />
        Users
      </Button>
    </aside>
  );
}

export default SettingsSidebar;
