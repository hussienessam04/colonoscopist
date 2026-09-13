// Settings → About — quick task 20260912-q4g.
//
// Per user request: a one-glance About card with the locked identity
// of the app (name, version, developer, phone, email). Mirrors the
// License card pattern — single Card under SettingsLayout, small-caps
// section labels + grid-cols-3 rows + clinical workstation palette.
//
// Visual treatment is verbatim the rest of the Settings surfaces:
//   * ivory Card on the warm-ivory page bg
//   * small-caps section labels with a leading Info icon
//   * grid-cols-3 (label / value) treatment
//   * Mail + Phone icons next to the email/phone values so they read
//     as clickable affordances (mirrors how License uses KeyRound)
//
// Quick task 260913-64l — auto-update card sits ABOVE the app-info
// card when an update is queued (available / downloaded / error). The
// card is conditional on the SWR hook's state so the default About
// page remains visually identical when the clinic is up to date.
//
// ponytail: APP_VERSION is hardcoded — bump on release. The grid
// row renders it as a fourth row so the page has a clear "About this
// app" identity without an extra Card.

import { Download, Info, Mail, Phone, RefreshCw, RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SettingsLayout } from '@/components/SettingsLayout';
import { useUpdater } from '@/hooks/useUpdater';

// ponytail: bump APP_VERSION on release. Hardcoded for now (no build
// pipeline stamp); keeps the About card stable across runs without a
// rebuild if the version constant lives in the renderer.
const APP_VERSION = '1.0';

export default function SettingsAbout(): JSX.Element {
  const { t } = useTranslation();
  const { state, check, download, install } = useUpdater();

  // Surface update errors as a toast — clinic installs should still
  // see "Update failed" if the network is down at boot.
  useEffect(() => {
    if (state.error) {
      toast.error(t('update.checkFailed'));
    }
  }, [state.error, t]);

  return (
    <SettingsLayout
      title={t('about.pageTitle')}
      subtitle={t('about.pageDescription')}
      activeTab="about"
      backTestId="settings-about-back"
    >
      {(state.available || state.downloaded || state.error) && (
        <Card
          data-testid="settings-about-update-card"
          className={`border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)] ${
            state.downloaded ? 'border-l-4 border-l-[#0E3A47]' : ''
          }`}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
              <Download className="size-4" aria-hidden="true" />
              {state.downloaded ? t('update.downloadedTitle') : t('update.availableTitle')}
            </CardTitle>
            <CardDescription className="text-[#5C6770]">
              {state.downloaded
                ? t('update.downloadedBody')
                : t('update.availableBody', { version: state.latestVersion ?? '?' })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            {state.progress ? (
              <p className="text-sm font-mono text-[#5C6770]" data-testid="settings-about-update-progress">
                {t('update.downloadingLabel', { percent: Math.round(state.progress.percent) })}
              </p>
            ) : (
              <span className="text-xs text-[#5C6770] font-mono">
                v{state.latestVersion ?? '?'}
              </span>
            )}
            <div className="flex items-center gap-2">
              {!state.downloaded && (
                <Button
                  onClick={() => void download()}
                  data-testid="settings-about-update-download"
                  disabled={Boolean(state.progress)}
                  className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
                >
                  <Download className="size-4 mr-1" aria-hidden="true" />
                  {t('update.downloadButton')}
                </Button>
              )}
              {state.downloaded && (
                <Button
                  onClick={install}
                  data-testid="settings-about-update-install"
                  className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
                >
                  <RotateCw className="size-4 mr-1" aria-hidden="true" />
                  {t('update.restartButton')}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => void check()}
                data-testid="settings-about-update-check"
                className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
              >
                <RefreshCw className="size-4 mr-1" aria-hidden="true" />
                {t('update.checkButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card
        data-testid="settings-about-card"
        className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
            <Info className="size-4" aria-hidden="true" />
            {t('about.pageTitle')}
          </CardTitle>
          <CardDescription className="text-[#5C6770]">
            {t('about.pageDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border">
            <span className="text-[#5C6770]">{t('about.appNameLabel')}</span>
            <span className="col-span-2 font-medium" data-testid="settings-about-app-name">
              {t('about.appName')}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border">
            <span className="text-[#5C6770]">{t('about.versionLabel')}</span>
            <span className="col-span-2 font-mono" data-testid="settings-about-version">
              {t('about.versionValue', { version: APP_VERSION })}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border">
            <span className="text-[#5C6770]">{t('about.developerLabel')}</span>
            <span className="col-span-2" data-testid="settings-about-developer">
              {t('about.developerName')}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border">
            <span className="text-[#5C6770]">{t('about.phoneLabel')}</span>
            <span className="col-span-2 font-mono" data-testid="settings-about-phone">
              <Phone className="mr-2 inline-block size-3.5 align-middle text-[#0E3A47]" aria-hidden="true" />
              <a
                href="tel:+201026524116"
                className="text-[#0E3A47] hover:underline"
              >
                +201026524116
              </a>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <span className="text-[#5C6770]">{t('about.emailLabel')}</span>
            <span className="col-span-2 font-mono" data-testid="settings-about-email">
              <Mail className="mr-2 inline-block size-3.5 align-middle text-[#0E3A47]" aria-hidden="true" />
              <a
                href="mailto:hussienessam04@gmail.com"
                className="text-[#0E3A47] hover:underline"
              >
                hussienessam04@gmail.com
              </a>
            </span>
          </div>

          {!state.available && !state.downloaded && (
            <p className="text-xs text-[#5C6770] pt-2 font-mono" data-testid="settings-about-up-to-date">
              {t('update.upToDate', { version: state.currentVersion })}
            </p>
          )}

          <p className="text-xs text-[#5C6770] pt-2" data-testid="settings-about-description">
            {t('about.description')}
          </p>
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}
