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
//
// Quick task 20260912-shared-database-optional — the Hub now mentions
// every sidebar entry (Capture / Profile / Audit / License / Backup &
// Restore / Users / Storage). License + Storage were missing from the
// description block + the section paragraphs; the user reported "the
// text appears is the keys instead of the text" because the Hub's
// strings were hardcoded English instead of going through t(). Now
// every string here resolves through i18n (EN + AR).

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoute } from '@/lib/router';
import { SettingsLayout } from '@/components/SettingsLayout';
import { useDoctorProfile } from '@/hooks/useDoctorProfile';
import { useEffect, useState } from 'react';

export default function SettingsHub(): JSX.Element {
  const { t } = useTranslation();
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
      title={t('settings.hubTitle')}
      subtitle={t('settings.hubDescription')}
      backTo={{ name: 'patients' }}
      backTestId="settings-hub-back"
      backLabel={t('settings.hubBackLabel')}
    >
      <Card
        className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]"
        data-testid="settings-hub-overview"
      >
        <CardHeader>
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
            {t('settings.hubCardTitle')}
          </CardTitle>
          <CardDescription className="text-[#5C6770]">
            {t('settings.hubCardDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-[#5C6770]">
          <p>
            <span className="font-medium text-[#13202E]">
              {t('settings.captureTitle')}
            </span>{' '}
            — {t('settings.hubCaptureDescription')}
          </p>
          <p data-testid="settings-hub-profile-card">
            <span className="font-medium text-[#13202E]">
              {t('settings.profileTitle')}
            </span>{' '}
            —{' '}
            {previewClinicName === ''
              ? t('settings.hubProfileAddDescription')
              : t('settings.hubProfileShowDescription', {
                  name: previewClinicName,
                })}{' '}
            <Button
              variant="link"
              size="sm"
              className="px-1"
              onClick={() => navigate({ name: 'profile-edit' })}
              data-testid="settings-hub-profile-link"
            >
              {t('settings.profileOpen')}
            </Button>
          </p>
          <p>
            <span className="font-medium text-[#13202E]">
              {t('settings.auditTitle')}
            </span>{' '}
            — {t('settings.auditDescription')}
          </p>
          <p>
            <span className="font-medium text-[#13202E]">
              {t('license.pageTitle')}
            </span>{' '}
            — {t('license.pageDescription')}
          </p>
          <p>
            <span className="font-medium text-[#13202E]">
              {t('settings.backupTitle')}
            </span>{' '}
            — {t('settings.backupDescription')}
          </p>
          <p>
            <span className="font-medium text-[#13202E]">
              {t('settings.usersTitle')}
            </span>{' '}
            — {t('settings.usersDescription')}
          </p>
          {/* Quick task 20260912-q4g — About paragraph sits between
              Users and Storage so the hub's description block
              mirrors the sidebar order. */}
          <p>
            <span className="font-medium text-[#13202E]">
              {t('about.sidebarEntry')}
            </span>{' '}
            — {t('about.pageDescription')}
          </p>
          {/* Quick task 20260913-5b0 — Diagnostics paragraph sits
              between About and Storage so the hub's description
              block mirrors the new sidebar order. */}
          <p>
            <span className="font-medium text-[#13202E]">
              {t('diagnostics.sidebarEntry')}
            </span>{' '}
            — {t('diagnostics.pageDescription')}
          </p>
          <p>
            <span className="font-medium text-[#13202E]">
              {t('settings.storageTitle')}
            </span>{' '}
            — {t('settings.storageDescription')}
          </p>
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}