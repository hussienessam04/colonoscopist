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

export type SettingsTab =
  | 'capture'
  | 'users'
  | 'profile'
  | 'audit'
  | 'license'
  | 'backup-restore';

export function SettingsSidebar({ activeTab }: { activeTab?: SettingsTab }): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  const { t } = useTranslation();
  const isAdmin = currentUser?.isFirstAdmin ?? false;

  return (
    <aside className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Sections
      </p>
      <Button
        variant={activeTab === 'capture' ? 'default' : 'outline'}
        className="justify-start"
        onClick={() => navigate({ name: 'settings-capture' })}
        data-testid="settings-hub-capture"
        data-active={activeTab === 'capture' ? 'true' : 'false'}
      >
        <Video className="size-4 mr-2" aria-hidden="true" />
        Capture
      </Button>
      <Button
        variant={activeTab === 'profile' ? 'default' : 'outline'}
        className="justify-start"
        onClick={() => navigate({ name: 'profile-edit' })}
        data-testid="settings-hub-profile"
        data-active={activeTab === 'profile' ? 'true' : 'false'}
      >
        <UserCircle className="size-4 mr-2" aria-hidden="true" />
        Profile
      </Button>
      <Button
        variant={activeTab === 'audit' ? 'default' : 'outline'}
        className="justify-start"
        onClick={() => navigate({ name: 'audit' })}
        data-testid="settings-hub-audit"
        data-active={activeTab === 'audit' ? 'true' : 'false'}
      >
        <FileSearch className="size-4 mr-2" aria-hidden="true" />
        Audit
      </Button>
      <Button
        variant={activeTab === 'license' ? 'default' : 'outline'}
        className="justify-start"
        onClick={() => navigate({ name: 'license' })}
        data-testid="settings-hub-license"
        data-active={activeTab === 'license' ? 'true' : 'false'}
      >
        <KeyRound className="size-4 mr-2" aria-hidden="true" />
        {t('license.sidebarEntry')}
      </Button>
      <Button
        variant={activeTab === 'backup-restore' ? 'default' : 'outline'}
        className="justify-start"
        onClick={() => navigate({ name: 'backup-restore' })}
        data-testid="settings-hub-backup-restore"
        data-active={activeTab === 'backup-restore' ? 'true' : 'false'}
      >
        <HardDrive className="size-4 mr-2" aria-hidden="true" />
        Backup &amp; restore
      </Button>
      <Button
        variant={activeTab === 'users' ? 'default' : 'outline'}
        className="justify-start"
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
