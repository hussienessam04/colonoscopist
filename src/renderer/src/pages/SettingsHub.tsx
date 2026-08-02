// Settings hub — first-class page replacing the prior transient header menu.
// Per Plan 03-05 (G-03-3): right-side sidebar nav with Capture (every
// authenticated doctor) and Users (first admin only). Back returns to the
// Patient List. Existing SettingsCapture and SettingsUsers pages are reached
// through the sidebar entries; this page is a router, not a destination.
import { ArrowLeft, Shield, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';

export default function SettingsHub(): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  const isAdmin = currentUser?.isFirstAdmin ?? false;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Workspace
            </p>
            <h1 className="text-2xl font-semibold">Settings</h1>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate({ name: 'patients' })}
            data-testid="settings-hub-back"
          >
            <ArrowLeft className="size-4 mr-1" aria-hidden="true" />
            Back
          </Button>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>
                Choose a section from the sidebar. Capture is available to every
                authenticated doctor; Users is available to the first admin.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Capture</span> — pick
                a default device, choose a quality preset, and verify the live
                preview before saving.
              </p>
              <p>
                <span className="font-medium text-foreground">Users</span> — add
                or remove staff and reset PINs (first admin only).
              </p>
            </CardContent>
          </Card>

          <aside className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Sections
            </p>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => navigate({ name: 'settings-capture' })}
              data-testid="settings-hub-capture"
            >
              <Video className="size-4 mr-2" aria-hidden="true" />
              Capture
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => navigate({ name: 'settings-users' })}
              disabled={!isAdmin}
              title={isAdmin ? 'Manage users' : 'Admin only'}
              data-testid="settings-hub-users"
            >
              <Shield className="size-4 mr-2" aria-hidden="true" />
              Users
            </Button>
          </aside>
        </div>
      </div>
    </main>
  );
}
