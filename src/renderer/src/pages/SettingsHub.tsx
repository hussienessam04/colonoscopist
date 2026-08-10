// Settings hub — first-class page replacing the prior transient header menu.
// Per Plan 03-05 (G-03-3): the right-side sidebar nav is now the shared
// <SettingsSidebar /> component (per Plan 03-06 G-03-6). Back returns to
// the Patient List. Existing SettingsCapture and SettingsUsers pages are
// reached through the sidebar entries; this page is a router, not a
// destination, so it mounts <SettingsSidebar /> with no activeTab.
//
// Phase 6 / Plan 02 — Profile card. The doctor can pre-fill the clinic
// name + jump straight into the bilingual profile editor from the hub.
//
// Phase 7 / Plan 07-02 — Audit + Backup & Restore descriptions. The
// actual page bodies land in Plan 07-03 (Audit) + Plan 07-05 (Backup &
// Restore). These paragraphs pre-introduce the surfaces so the doctor
// knows what the sidebar entries do.
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoute } from '@/lib/router';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { useDoctorProfile } from '@/hooks/useDoctorProfile';
import { useEffect, useState } from 'react';

export default function SettingsHub(): JSX.Element {
  const { navigate } = useRoute();
  const { profile } = useDoctorProfile();
  // ponytail: capture the clinic name preview at mount. The hook's
  // setLocal is local-only so we don't trigger IPC just to render a
  // preview line. Storing in local state avoids re-rendering the hub
  // every time the doctor edits the profile page.
  const [previewClinicName, setPreviewClinicName] = useState<string>('');
  useEffect(() => {
    setPreviewClinicName(profile?.clinicNameEn ?? '');
  }, [profile?.clinicNameEn]);

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
                Choose a section from the sidebar. Capture, Profile, Audit,
                and Backup &amp; restore are available to every authenticated
                doctor; Users is available to the first admin.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Capture</span> — pick
                a default device, choose a quality preset, and verify the live
                preview before saving.
              </p>
              <p data-testid="settings-hub-profile-card">
                <span className="font-medium text-foreground">Profile</span> —{' '}
                {previewClinicName === ''
                  ? 'add your clinic + doctor details for the report header.'
                  : `report header currently shows ${previewClinicName}.`}{' '}
                <Button
                  variant="link"
                  size="sm"
                  className="px-1"
                  onClick={() => navigate({ name: 'profile-edit' })}
                  data-testid="settings-hub-profile-link"
                >
                  Open profile editor
                </Button>
              </p>
              <p>
                <span className="font-medium text-foreground">Audit</span> —
                review the read + write log for every action the system
                recorded, filter by date or doctor, and export for a periodic
                compliance review.
              </p>
              <p>
                <span className="font-medium text-foreground">Backup &amp; restore</span> —
                snapshot the entire patient database + media to a zip on the
                workstation, or unpack a previous backup into a staging folder
                for review before activating.
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