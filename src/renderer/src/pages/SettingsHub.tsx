// Settings hub — first-class page replacing the prior transient header menu.
// Per Plan 03-05 (G-03-3): the right-side sidebar nav is now the shared
// <SettingsSidebar /> component (per Plan 03-06 G-03-6). Back returns to
// the Patient List. Existing SettingsCapture and SettingsUsers pages are
// reached through the sidebar entries; this page is a router, not a
// destination, so it mounts <SettingsSidebar /> with no activeTab.
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoute } from '@/lib/router';
import { SettingsSidebar } from '@/components/SettingsSidebar';

export default function SettingsHub(): JSX.Element {
  const { navigate } = useRoute();

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

        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <SettingsSidebar />

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
        </div>
      </div>
    </main>
  );
}