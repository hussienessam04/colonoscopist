// ProfileEditor — Settings → Profile (PROF-01).
// Bilingual fields (fullNameEn/Ar + clinicNameEn/Ar) + address + phone
// + 4 image assets (header / footer / signature / logo) + premedication
// input + used-devices CRUD. Auto-save-on-blur per CONTEXT.md §Doctor
// profile storage. The inline save indicator cycles Saving → Saved at
// HH:MM:SS / Save failed — retry via the useAutoSave state machine.
//
// Uploads:
//   - Reads the file via FileReader.readAsDataURL.
//   - Decodes the base64 payload, sniffs the first bytes for PNG/JPEG
//     magic numbers client-side. Reject (toast.error + NO IPC) on
//     mismatch — defense in depth on top of the main-side sniff from
//     Plan 06-01 Task 11.
//   - On accept, calls api.profile.upload{Signature,Logo,Header,Footer}
//     with the matching { pngBase64 | jpegBase64 } field.
//
// Quick task 260812-ns0 — header/footer/premedication/used-devices +
// UI polish. The Assets card now renders as a 2×2 grid (header / footer /
// signature / logo), a new "Procedure defaults" card sits between
// Assets and Language (premedication input + used-devices CRUD).

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsLayout } from '@/components/SettingsLayout';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useDoctorProfile } from '@/hooks/useDoctorProfile';
import { safeInvoke } from '@/lib/ipc-result';
import EmptyStateCard from '@/components/EmptyStateCard';
import type { DoctorProfile, UsedDevice } from '@shared/ipc-contract';

// PNG signature: 89 50 4E 47 0D 0A 1A 0A (8 bytes).
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// JPEG SOI: FF D8 FF (3 bytes).
const JPEG_SIG = [0xff, 0xd8, 0xff];

function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (bytes.length >= PNG_SIG.length && PNG_SIG.every((b, i) => bytes[i] === b)) {
    return 'png';
  }
  if (bytes.length >= JPEG_SIG.length && JPEG_SIG.every((b, i) => bytes[i] === b)) {
    return 'jpeg';
  }
  return null;
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  // dataUrl = "data:image/png;base64,XXXX" or "data:image/jpeg;base64,XXXX"
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return new Uint8Array(0);
  const payload = dataUrl.slice(comma + 1);
  // ponytail: atob is happy-dom / Chromium-compatible; sufficient for
  // a test seam. Production Electron renderer's renderer process is
  // Chromium so the same API exists.
  const binary = atob(payload);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function formatHHMMSS(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function profileFromPatch(p: DoctorProfile | null): Pick<
  DoctorProfile,
  'fullNameEn' | 'fullNameAr' | 'clinicNameEn' | 'clinicNameAr' | 'address' | 'phone' | 'premedication'
> {
  return {
    fullNameEn: p?.fullNameEn ?? '',
    fullNameAr: p?.fullNameAr ?? null,
    clinicNameEn: p?.clinicNameEn ?? '',
    clinicNameAr: p?.clinicNameAr ?? null,
    address: p?.address ?? null,
    phone: p?.phone ?? null,
    premedication: p?.premedication ?? null,
  };
}

// ponytail: small inline component for the 2x2 asset grid quadrants.
// Each quadrant renders the same pattern (label + status + preview + upload
// button) so we hoist the markup here instead of repeating it 4 times in
// the JSX below.
type AssetKind = 'header' | 'footer' | 'signature' | 'logo';

function AssetUploader({
  kind,
  preview,
  uploadedAt,
  onPick,
  t,
}: {
  kind: AssetKind;
  preview: string | null;
  uploadedAt: number | null;
  onPick: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactNode {
  const label = {
    header: t('profile.headerLabel'),
    footer: t('profile.footerLabel'),
    signature: t('profile.signatureLabel'),
    logo: t('profile.logoLabel'),
  }[kind];
  const uploadButtonLabel = {
    header: t('profile.uploadHeader'),
    footer: t('profile.uploadFooter'),
    signature: t('profile.uploadSignature'),
    logo: t('profile.uploadLogo'),
  }[kind];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium">{label}</p>
      <p
        className="text-xs text-muted-foreground"
        data-testid={`profile-editor-${kind}-status`}
      >
        {uploadedAt === null
          ? t(`profile.${kind}NotUploaded`)
          : t(`profile.${kind}UploadedAt`, { time: formatHHMMSS(uploadedAt) })}
      </p>
      {preview !== null ? (
        <img
          src={preview}
          alt={`${label} preview`}
          className="max-h-[80px] max-w-full rounded border border-slate-200 bg-white object-contain p-1"
          data-testid={`profile-editor-${kind}-preview`}
        />
      ) : (
        <div className="flex h-[80px] items-center justify-center rounded border border-dashed border-slate-300 bg-white text-xs text-muted-foreground">
          {t('profile.noPreview')}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onPick}
        data-testid={`profile-editor-${kind}-button`}
        className="self-start"
      >
        <ImagePlus className="size-4 mr-1" aria-hidden="true" />
        {uploadButtonLabel}
      </Button>
    </div>
  );
}

export default function ProfileEditor(): JSX.Element {
  const { profile, loading, refresh, setLocal } = useDoctorProfile();
  const { t, i18n } = useTranslation();
  // Plan 08-10 / G-08-4 — gate-rejected flag. The useDoctorProfile
  // hook does not branch on the discriminated union (a separate hook
  // file); the page detects the gate shape directly and renders the
  // empty-state card.
  // ponytail: `'ok' in profile && profile.ok === false` matches the
  // gate contract in src/main/license/gate.ts; a successful doctor
  // profile never carries an `ok` field so the check is safe.
  const gated =
    profile !== null &&
    typeof profile === 'object' &&
    'ok' in profile &&
    (profile as { ok: unknown }).ok === false;

  const persist = useCallback(
    async (patch: Partial<DoctorProfile>): Promise<void> => {
      const updated = await window.api.profile.update({
        fullNameEn: patch.fullNameEn ?? profile?.fullNameEn ?? '',
        fullNameAr: patch.fullNameAr ?? profile?.fullNameAr ?? null,
        clinicNameEn: patch.clinicNameEn ?? profile?.clinicNameEn ?? '',
        clinicNameAr: patch.clinicNameAr ?? profile?.clinicNameAr ?? null,
        address: patch.address ?? profile?.address ?? null,
        phone: patch.phone ?? profile?.phone ?? null,
        // Quick task 260812-ns0 — premedication flows through the same
        // auto-save IPC; null clears, undefined preserves the existing
        // value (the repo's upsert keeps it as-is in that case).
        premedication: patch.premedication !== undefined ? patch.premedication : profile?.premedication ?? null,
      });
      void refresh();
      void updated;
    },
    [profile, refresh],
  );

  const { status, savedAt, trigger } = useAutoSave({
    value: profile,
    onSave: async (p) => {
      if (p === null) return;
      const editable = profileFromPatch(p);
      await persist(editable);
    },
  });

  // Phase 7 / Plan 07-03 — I18N-01: per-doctor language preference.
  const [selectedLang, setSelectedLang] = useState<'en' | 'ar'>(
    profile?.language ?? 'en',
  );
  const selectedLangRef = useRef<'en' | 'ar'>(selectedLang);
  selectedLangRef.current = selectedLang;

  useEffect(() => {
    const lang = profile?.language;
    if (lang === null || lang === undefined) return;
    if (lang !== selectedLangRef.current) {
      setSelectedLang(lang);
    }
  }, [profile?.language]);

  const handleLanguageChange = useCallback(
    async (newLang: 'en' | 'ar'): Promise<void> => {
      const from = selectedLangRef.current;
      if (from === newLang) return;
      setSelectedLang(newLang);
      try {
        await Promise.all([
          window.api.profile.update({
            fullNameEn: profile?.fullNameEn ?? '',
            fullNameAr: profile?.fullNameAr ?? null,
            clinicNameEn: profile?.clinicNameEn ?? '',
            clinicNameAr: profile?.clinicNameAr ?? null,
            address: profile?.address ?? null,
            phone: profile?.phone ?? null,
            language: newLang,
          }),
          window.api.audit.log({
            action: 'language.changed',
            entityType: 'language',
            metadata: { from, to: newLang, scope: 'profile' },
          }),
        ]);
        await i18n.changeLanguage(newLang);
        void refresh();
        toast.success(
          newLang === 'ar'
            ? t('language.updatedTo', { name: 'العربية' })
            : t('language.updatedTo', { name: 'English' }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('language.updated');
        toast.error(msg);
      }
    },
    [profile, refresh, t],
  );

  // Quick task 260812-ns0 — 4 hidden file inputs (one per asset kind).
  const headerInputRef = useRef<HTMLInputElement | null>(null);
  const footerInputRef = useRef<HTMLInputElement | null>(null);
  const signatureInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [headerAt, setHeaderAt] = useState<number | null>(null);
  const [footerAt, setFooterAt] = useState<number | null>(null);
  const [signatureAt, setSignatureAt] = useState<number | null>(null);
  const [logoAt, setLogoAt] = useState<number | null>(null);
  // Phase 6 UAT G-06-3 — image previews. Loaded as base64 data URLs from
  // the existing `api.profile.getAssetDataUrl` IPC. Quick task 260812-ns0
  // extends this to header + footer (4 kinds total).
  const [headerPreview, setHeaderPreview] = useState<string | null>(null);
  const [footerPreview, setFooterPreview] = useState<string | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const refreshPreviews = useCallback(async (): Promise<void> => {
    try {
      // Plan 08-10 / G-08-4 — gate may reject. Each null becomes null;
      // missing preview is the same as no asset uploaded.
      const [hdr, ftr, sig, logo] = await Promise.all([
        safeInvoke(window.api.profile.getAssetDataUrl({ kind: 'header' })),
        safeInvoke(window.api.profile.getAssetDataUrl({ kind: 'footer' })),
        safeInvoke(window.api.profile.getAssetDataUrl({ kind: 'signature' })),
        safeInvoke(window.api.profile.getAssetDataUrl({ kind: 'logo' })),
      ]);
      setHeaderPreview(hdr?.dataUrl ?? null);
      setFooterPreview(ftr?.dataUrl ?? null);
      setSignaturePreview(sig?.dataUrl ?? null);
      setLogoPreview(logo?.dataUrl ?? null);
    } catch {
      // best-effort: keep last preview; toast on actual upload errors
    }
  }, []);

  useEffect(() => {
    void refreshPreviews();
  }, [refreshPreviews]);

  // Quick task 260812-ns0 — used devices list. Loaded on mount; refresh
  // after every add / remove.
  const [usedDevices, setUsedDevices] = useState<UsedDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const refreshDevices = useCallback(async (): Promise<void> => {
    setDevicesLoading(true);
    try {
      const list = await window.api.usedDevices.list();
      setUsedDevices(list);
    } catch {
      // best-effort; the section shows the empty state
    } finally {
      setDevicesLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // Inline add-row state.
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceNotes, setNewDeviceNotes] = useState('');
  const [addingDevice, setAddingDevice] = useState(false);

  const handleAddDevice = useCallback(async (): Promise<void> => {
    const name = newDeviceName.trim();
    if (name === '' || addingDevice) return;
    setAddingDevice(true);
    try {
      const created = await window.api.usedDevices.add({
        name,
        notes: newDeviceNotes.trim() === '' ? null : newDeviceNotes.trim(),
      });
      // ponytail: optimistic insert — append to the local list, clear
      // the form, then refresh in the background so the list is the
      // server's view (in case the server re-ordered by sort_order).
      setUsedDevices((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder));
      setNewDeviceName('');
      setNewDeviceNotes('');
      void refreshDevices();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Add failed';
      toast.error(msg);
    } finally {
      setAddingDevice(false);
    }
  }, [newDeviceName, newDeviceNotes, addingDevice, refreshDevices]);

  const handleRemoveDevice = useCallback(async (id: string): Promise<void> => {
    // Optimistic remove.
    setUsedDevices((prev) => prev.filter((d) => d.id !== id));
    try {
      await window.api.usedDevices.remove({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      toast.error(msg);
      // Rollback on failure.
      void refreshDevices();
    }
  }, [refreshDevices]);

  const indicatorText = useMemo((): string => {
    if (status === 'saving') return t('common.saving');
    if (status === 'error') return t('common.saveFailedRetry');
    if (status === 'saved' && savedAt !== null) return t('common.savedAt', { time: formatHHMMSS(savedAt) });
    return '';
  }, [status, savedAt, t]);

  const handleFieldChange = useCallback(
    (field: keyof ReturnType<typeof profileFromPatch>) =>
      (e: ChangeEvent<HTMLInputElement>): void => {
        const value = e.target.value;
        const patched: Partial<DoctorProfile> = {
          [field]: value === '' ? null : value,
        } as Partial<DoctorProfile>;
        setLocal(patched);
        const next = profile === null ? null : { ...profile, ...patched };
        trigger(next ?? undefined);
      },
    [profile, setLocal, trigger],
  );

  const handleUpload = useCallback(
    async (kind: AssetKind, e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = '';
      if (!file) return;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(reader.result as string);
        reader.onerror = (): void => reject(reader.error ?? new Error('Read failed'));
        reader.readAsDataURL(file);
      });
      const bytes = decodeDataUrl(dataUrl);
      const fmt = detectImageFormat(bytes);
      if (fmt === null) {
        toast.error(t('profile.uploadFormatError'));
        return;
      }
      const rawBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const payload = fmt === 'png' ? { pngBase64: rawBase64 } : { jpegBase64: rawBase64 };
      try {
        if (kind === 'signature') {
          await window.api.profile.uploadSignature(payload);
          setSignatureAt(Date.now());
        } else if (kind === 'logo') {
          await window.api.profile.uploadLogo(payload);
          setLogoAt(Date.now());
        } else if (kind === 'header') {
          await window.api.profile.uploadHeader(payload);
          setHeaderAt(Date.now());
        } else {
          await window.api.profile.uploadFooter(payload);
          setFooterAt(Date.now());
        }
        void refresh();
        void refreshPreviews();
        const kindLabel = t(
          kind === 'signature' ? 'profile.signatureLabel'
          : kind === 'logo' ? 'profile.logoLabel'
          : kind === 'header' ? 'profile.headerLabel'
          : 'profile.footerLabel',
        );
        toast.success(t('profile.uploadSuccess', { kind: kindLabel }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('profile.uploadFailed');
        toast.error(msg);
      }
    },
    [refresh, refreshPreviews, t],
  );

  useEffect(() => {
    void loading;
  }, [loading]);

  if (loading && profile === null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-slate-500">{t('profile.loadingProfile')}</p>
        </div>
      </main>
    );
  }

  // Plan 08-10 / G-08-4 — gate rejection. Render <EmptyStateCard> below
  // the page-level <SettingsLayout> so the LicenseGate modal stays on
  // top.
  if (gated) {
    return (
      <SettingsLayout
        title={t('profile.pageTitle')}
        subtitle={t('profile.pageKicker')}
        activeTab="profile"
        backTestId="profile-editor-back"
      >
        <EmptyStateCard />
      </SettingsLayout>
    );
  }

  const f = profileFromPatch(profile);

  return (
    <SettingsLayout
      title={t('profile.pageTitle')}
      subtitle={t('profile.pageKicker')}
      activeTab="profile"
      backTestId="profile-editor-back"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.cardClinicTitle')}</CardTitle>
          <CardDescription>{t('profile.cardClinicDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullNameEn">{t('profile.fullNameEn')}</Label>
              <Input
                id="fullNameEn"
                autoComplete="name"
                value={f.fullNameEn}
                onChange={handleFieldChange('fullNameEn')}
                data-testid="profile-editor-fullNameEn"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullNameAr">{t('profile.fullNameAr')}</Label>
              <Input
                id="fullNameAr"
                dir="rtl"
                value={f.fullNameAr ?? ''}
                onChange={handleFieldChange('fullNameAr')}
                data-testid="profile-editor-fullNameAr"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="clinicNameEn">{t('profile.clinicNameEn')}</Label>
              <Input
                id="clinicNameEn"
                autoComplete="organization"
                value={f.clinicNameEn}
                onChange={handleFieldChange('clinicNameEn')}
                data-testid="profile-editor-clinicNameEn"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="clinicNameAr">{t('profile.clinicNameAr')}</Label>
              <Input
                id="clinicNameAr"
                dir="rtl"
                value={f.clinicNameAr ?? ''}
                onChange={handleFieldChange('clinicNameAr')}
                data-testid="profile-editor-clinicNameAr"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="address">{t('profile.address')}</Label>
              <Input
                id="address"
                autoComplete="street-address"
                value={f.address ?? ''}
                onChange={handleFieldChange('address')}
                data-testid="profile-editor-address"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">{t('profile.phone')}</Label>
              <Input
                id="phone"
                autoComplete="tel"
                value={f.phone ?? ''}
                onChange={handleFieldChange('phone')}
                data-testid="profile-editor-phone"
              />
            </div>
          </div>

          <p
            className="text-xs text-muted-foreground"
            data-testid="profile-editor-save-indicator"
            role="status"
            aria-live="polite"
          >
            {indicatorText}
          </p>
        </CardContent>
      </Card>

      {/* Quick task 260812-ns0 — Assets card now renders as a 2x2 grid
          (header / footer / signature / logo). The four quadrants share
          the same shape via the inline <AssetUploader> helper above. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.cardAssetsTitle')}</CardTitle>
          <CardDescription>{t('profile.cardAssetsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={headerInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void handleUpload('header', e)}
            data-testid="profile-editor-header-input"
          />
          <input
            ref={footerInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void handleUpload('footer', e)}
            data-testid="profile-editor-footer-input"
          />
          <input
            ref={signatureInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void handleUpload('signature', e)}
            data-testid="profile-editor-signature-input"
          />
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void handleUpload('logo', e)}
            data-testid="profile-editor-logo-input"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AssetUploader
              kind="header"
              preview={headerPreview}
              uploadedAt={headerAt}
              onPick={() => headerInputRef.current?.click()}
              t={t}
            />
            <AssetUploader
              kind="footer"
              preview={footerPreview}
              uploadedAt={footerAt}
              onPick={() => footerInputRef.current?.click()}
              t={t}
            />
            <AssetUploader
              kind="signature"
              preview={signaturePreview}
              uploadedAt={signatureAt}
              onPick={() => signatureInputRef.current?.click()}
              t={t}
            />
            <AssetUploader
              kind="logo"
              preview={logoPreview}
              uploadedAt={logoAt}
              onPick={() => logoInputRef.current?.click()}
              t={t}
            />
          </div>
        </CardContent>
      </Card>

      {/* Quick task 260812-ns0 — new "Procedure defaults" card holds the
          premedication input + used-devices CRUD UI. Sits between Assets
          and Language so the existing profile-editor tests for the upper
          cards continue to find the same testids. */}
      <Card data-testid="profile-editor-procedure-defaults-card">
        <CardHeader>
          <CardTitle>{t('profile.cardProcedureDefaultsTitle')}</CardTitle>
          <CardDescription>{t('profile.cardProcedureDefaultsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="premedication">{t('profile.premedicationLabel')}</Label>
            <Input
              id="premedication"
              value={f.premedication ?? ''}
              onChange={handleFieldChange('premedication')}
              placeholder={t('profile.premedicationPlaceholder')}
              data-testid="profile-editor-premedication"
            />
            <p className="text-xs text-muted-foreground">
              {t('profile.premedicationHelp')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('profile.usedDevicesLabel')}</Label>
            <div className="flex flex-col gap-2" data-testid="profile-editor-used-devices">
              {devicesLoading && usedDevices.length === 0 ? (
                <p className="text-xs text-muted-foreground">…</p>
              ) : usedDevices.length === 0 ? (
                <p
                  className="text-xs text-muted-foreground italic"
                  data-testid="profile-editor-used-devices-empty"
                >
                  {t('profile.usedDevicesEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {usedDevices.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      data-testid={`profile-editor-used-device-row-${d.id}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.notes !== null ? (
                          <span className="text-xs text-muted-foreground">{d.notes}</span>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleRemoveDevice(d.id)}
                        aria-label={`${t('profile.usedDevicesRemove')}: ${d.name}`}
                        data-testid={`profile-editor-used-device-remove-${d.id}`}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-slate-300 p-2">
                <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                  <Input
                    placeholder={t('profile.usedDevicesNamePlaceholder')}
                    value={newDeviceName}
                    onChange={(e) => setNewDeviceName(e.target.value)}
                    data-testid="profile-editor-used-device-name-input"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddDevice();
                    }}
                  />
                </div>
                <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                  <Input
                    placeholder={t('profile.usedDevicesNotesPlaceholder')}
                    value={newDeviceNotes}
                    onChange={(e) => setNewDeviceNotes(e.target.value)}
                    data-testid="profile-editor-used-device-notes-input"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddDevice();
                    }}
                  />
                </div>
                <Button
                  onClick={() => void handleAddDevice()}
                  disabled={newDeviceName.trim() === '' || addingDevice}
                  data-testid="profile-editor-used-device-add"
                >
                  {t('profile.usedDevicesAdd')}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="profile-editor-language-card">
        <CardHeader>
          <CardTitle>{t('language.label')}</CardTitle>
          <CardDescription>{t('language.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                id="profile-editor-language-en"
                type="radio"
                name="profile-editor-language"
                value="en"
                checked={selectedLang === 'en'}
                onChange={() => void handleLanguageChange('en')}
                data-testid="profile-editor-language-en"
              />
              <Label htmlFor="profile-editor-language-en">English</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="profile-editor-language-ar"
                type="radio"
                name="profile-editor-language"
                value="ar"
                dir="rtl"
                checked={selectedLang === 'ar'}
                onChange={() => void handleLanguageChange('ar')}
                data-testid="profile-editor-language-ar"
              />
              <Label htmlFor="profile-editor-language-ar">العربية</Label>
            </div>
          </div>
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}