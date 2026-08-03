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

import { Shield, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/store/session';
import { useRoute } from '@/lib/router';

export type SettingsTab = 'capture' | 'users';

export function SettingsSidebar({ activeTab }: { activeTab?: SettingsTab }): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
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