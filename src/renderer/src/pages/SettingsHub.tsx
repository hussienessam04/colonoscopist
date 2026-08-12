// Settings hub — first-class page replacing the prior transient header menu.
// Per Plan 03-05 (G-03-3): the right-side sidebar nav is now part of the
// shared SettingsLayout component (per Plan 03-06 G-03-6; refactored under
// quick task 260812-n0h). Back returns to the Patient List. Existing
// SettingsCapture and SettingsUsers pages are reached through the sidebar
// entries; this page is a router, not a destination, so it passes no
// activeTab to SettingsLayout.
//
// Phase 6 / Plan 02 — Profile card. The doctor can pre-fill the clinic
// name + jump straight into the bilingual profile editor from the hub.
//
// Phase 7 / Plan 07-02 — Audit + Backup & Restore descriptions. The
// actual page bodies land in Plan 07-03 (Audit) + Plan 07-05 (Backup &
// Restore). These paragraphs pre-introduce the surfaces so the doctor
// knows what the sidebar entries do.
//
// Quick task 260812-n0h — unified shell: this page now uses
// SettingsLayout for the header / sidebar / grid so it matches every
// other settings page. The Hub is the only page whose Back goes to
// `patients` (instead of `settings-hub`); backLabel is "Back to patients"
// to make that explicit.
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoute } from '@/lib/router';
import { SettingsLayout } from '@/components/SettingsLayout';
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
    <SettingsLayout
      title="Settings"
      subtitle="Choose a section from the sidebar."
      backTo={{ name: 'patients' }}
      backTestId="settings-hub-back"
      backLabel="Back to patients"
    >
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            Capture, Profile, Audit, and Backup &amp; restore are
            available to every authenticated doctor; Users is available
            to the first admin.
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
    </SettingsLayout>
  );
}