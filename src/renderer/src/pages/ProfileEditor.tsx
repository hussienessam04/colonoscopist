// ProfileEditor — Settings → Profile (PROF-01).
// Bilingual fields (fullNameEn/Ar + clinicNameEn/Ar) + address + phone
// + signature + logo upload. Auto-save-on-blur per CONTEXT.md §Doctor
// profile storage. The inline save indicator cycles Saving → Saved at
// HH:MM:SS / Save failed — retry via the useAutoSave state machine.
//
// Uploads:
//   - Reads the file via FileReader.readAsDataURL.
//   - Decodes the base64 payload, sniffs the first bytes for PNG/JPEG
//     magic numbers client-side. Reject (toast.error + NO IPC) on
//     mismatch — defense in depth on top of the main-side sniff from
//     Plan 06-01 Task 11.
//   - On accept, calls api.profile.uploadSignature / uploadLogo with
//     the matching { pngBase64 | jpegBase64 } field.

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useDoctorProfile } from '@/hooks/useDoctorProfile';
import { useRoute } from '@/lib/router';
import type { DoctorProfile } from '@shared/ipc-contract';

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
  'fullNameEn' | 'fullNameAr' | 'clinicNameEn' | 'clinicNameAr' | 'address' | 'phone'
> {
  return {
    fullNameEn: p?.fullNameEn ?? '',
    fullNameAr: p?.fullNameAr ?? null,
    clinicNameEn: p?.clinicNameEn ?? '',
    clinicNameAr: p?.clinicNameAr ?? null,
    address: p?.address ?? null,
    phone: p?.phone ?? null,
  };
}

export default function ProfileEditor(): JSX.Element {
  const { navigate } = useRoute();
  const { profile, loading, refresh, setLocal } = useDoctorProfile();

  // ponytail: per-field auto-save state. We hold one useAutoSave per
  // field so the "Saving…" indicator tracks the just-blurred field.
  // All seven share the same { patch, persist } shape; using a single
  // hook keyed on the latest patch would have collapsed the indicators
  // into a confusing single line.
  const persist = useCallback(
    async (patch: Partial<DoctorProfile>): Promise<void> => {
      const updated = await window.api.profile.update({
        fullNameEn: patch.fullNameEn ?? profile?.fullNameEn ?? '',
        fullNameAr: patch.fullNameAr ?? profile?.fullNameAr ?? null,
        clinicNameEn: patch.clinicNameEn ?? profile?.clinicNameEn ?? '',
        clinicNameAr: patch.clinicNameAr ?? profile?.clinicNameAr ?? null,
        address: patch.address ?? profile?.address ?? null,
        phone: patch.phone ?? profile?.phone ?? null,
      });
      // Refresh from the source of truth (D-07 — RPC-after-patch reads
      // the server-stamped updated_at).
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

  // Phase 7 / Plan 07-03 — I18N-01: per-doctor language preference is
  // its own state machine (not auto-save-on-blur) because the picker is
  // a binary radio, not a free-text field. The handler fires
  // `profile.update` + `audit.log('language.changed')` in parallel on
  // each selection change. Default to 'en' when the per-doctor
  // override is null (the resolver falls back to users.language).
  const [selectedLang, setSelectedLang] = useState<'en' | 'ar'>(
    profile?.language ?? 'en',
  );
  // ponytail: stale-ref so the click handler always captures the
  // committed value (the closure approach would race the React state
  // update on rapid selects).
  const selectedLangRef = useRef<'en' | 'ar'>(selectedLang);
  selectedLangRef.current = selectedLang;

  // Sync the radio when the profile loads (initial render has
  // profile === null, so the radio defaults to 'en' per the spec; once
  // the IPC resolves we hydrate the user's actual preference).
  // Skip the sync if the user has already made a manual selection
  // (the local state is the source of truth for the UI surface).
  // null language = "follow users.language" — leave the radio on its
  // current value (defaults to 'en' until the picker is touched).
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
        void refresh();
        toast.success(newLang === 'ar' ? 'Language: العربية' : 'Language: English');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Language change failed';
        toast.error(msg);
      }
    },
    [profile, refresh],
  );

  // The signature + logo hidden file inputs.
  const signatureInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [signatureAt, setSignatureAt] = useState<number | null>(null);
  const [logoAt, setLogoAt] = useState<number | null>(null);
  // Phase 6 UAT G-06-3 — image previews. Loaded as base64 data URLs from
  // the new `api.profile.getAssetDataUrl` IPC so the doctor can see
  // what their signature/logo actually look like (and confirm the right
  // file uploaded). Refreshed after every successful upload.
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // ponytail: centralizes the data-URL fetch + state set so the
  // upload handler can call it on success. Profile change (e.g. on
  // wizard-bootstrap backfill) also calls this.
  const refreshPreviews = useCallback(async (): Promise<void> => {
    try {
      const [sig, logo] = await Promise.all([
        window.api.profile.getAssetDataUrl({ kind: 'signature' }),
        window.api.profile.getAssetDataUrl({ kind: 'logo' }),
      ]);
      setSignaturePreview(sig.dataUrl);
      setLogoPreview(logo.dataUrl);
    } catch {
      // best-effort: keep last preview; toast on actual upload errors
    }
  }, []);

  useEffect(() => {
    void refreshPreviews();
  }, [refreshPreviews]);

  // Inline save indicator text already covers the auto-save lifecycle
  // (Saving… / Saved at HH:MM:SS / Save failed — retry). No additional
  // explicit-save button per CONTEXT.md — field blurs are the only
  // trigger, so the per-field state machine is sufficient.

  const indicatorText = useMemo((): string => {
    if (status === 'saving') return 'Saving…';
    if (status === 'error') return 'Save failed — retry';
    if (status === 'saved' && savedAt !== null) return `Saved at ${formatHHMMSS(savedAt)}`;
    return '';
  }, [status, savedAt]);

  const handleFieldChange = useCallback(
    (field: keyof ReturnType<typeof profileFromPatch>) =>
      (e: ChangeEvent<HTMLInputElement>): void => {
        const value = e.target.value;
        const patched: Partial<DoctorProfile> = {
          [field]: value === '' ? null : value,
        } as Partial<DoctorProfile>;
        setLocal(patched);
        // ponytail: pass the patched value directly so the auto-save
        // IPC doesn't race the React setState — by the time the
        // 300ms debounce fires, setLocal has been queued but not yet
        // flushed, so the hook's closure-captured `value` is stale.
        const next = profile === null ? null : { ...profile, ...patched };
        trigger(next ?? undefined);
      },
    [profile, setLocal, trigger],
  );

  const handleUpload = useCallback(
    async (kind: 'signature' | 'logo', e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0] ?? null;
      // Reset the input so re-selecting the same file fires onChange.
      e.target.value = '';
      if (!file) return;
      // ponytail: FileReader.readAsDataURL is the standard browser API;
      // happy-dom + Chromium both support it. The decoded payload is a
      // base64 data URL; we sniff the first bytes for the PNG/JPEG
      // magic numbers BEFORE crossing the IPC boundary.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(reader.result as string);
        reader.onerror = (): void => reject(reader.error ?? new Error('Read failed'));
        reader.readAsDataURL(file);
      });
      const bytes = decodeDataUrl(dataUrl);
      const fmt = detectImageFormat(bytes);
      if (fmt === null) {
        toast.error('Only PNG or JPEG images are accepted');
        return;
      }
      // ponytail: send ONLY the raw base64 payload over IPC, NOT the
      // full data URL. Buffer.from('data:image/png;base64,XXX',
      // 'base64') does not strip the data URL prefix — Node drops the
      // non-base64 chars but keeps the valid ones (e.g. '/'), so the
      // decoded buffer's first 8 bytes are NOT the PNG signature. The
      // main-side magic-byte sniff then rejects a perfectly valid PNG.
      // Strip `data:<mime>;base64,` here so main receives pure base64.
      const rawBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const payload =
        fmt === 'png' ? { pngBase64: rawBase64 } : { jpegBase64: rawBase64 };
      try {
        if (kind === 'signature') {
          await window.api.profile.uploadSignature(payload);
          setSignatureAt(Date.now());
        } else {
          await window.api.profile.uploadLogo(payload);
          setLogoAt(Date.now());
        }
        void refresh();
        void refreshPreviews();
        toast.success(`${kind === 'signature' ? 'Signature' : 'Logo'} uploaded`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        toast.error(msg);
      }
    },
    [refresh],
  );

  // When the profile first loads, no auto-save fires (per the hook's
  // explicit-trigger contract). Effect is a no-op marker so future
  // hooks (e.g. language picker) can hydrate without round-tripping.
  useEffect(() => {
    void loading;
  }, [loading]);

  if (loading && profile === null) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-slate-500">Loading profile…</p>
        </div>
      </main>
    );
  }

  const f = profileFromPatch(profile);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Settings
            </p>
            <h1 className="text-2xl font-semibold">Doctor profile</h1>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate({ name: 'settings-hub' })}
            data-testid="profile-editor-back"
          >
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Clinic + doctor details</CardTitle>
            <CardDescription>
              English is required. Arabic is optional today (the clinic
              header on the report PDF uses English; Arabic will follow
              in a later release).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullNameEn">Full name (EN)</Label>
                <Input
                  id="fullNameEn"
                  autoComplete="name"
                  value={f.fullNameEn}
                  onChange={handleFieldChange('fullNameEn')}
                  data-testid="profile-editor-fullNameEn"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullNameAr">Full name (AR)</Label>
                <Input
                  id="fullNameAr"
                  dir="rtl"
                  value={f.fullNameAr ?? ''}
                  onChange={handleFieldChange('fullNameAr')}
                  data-testid="profile-editor-fullNameAr"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="clinicNameEn">Clinic name (EN)</Label>
                <Input
                  id="clinicNameEn"
                  autoComplete="organization"
                  value={f.clinicNameEn}
                  onChange={handleFieldChange('clinicNameEn')}
                  data-testid="profile-editor-clinicNameEn"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="clinicNameAr">Clinic name (AR)</Label>
                <Input
                  id="clinicNameAr"
                  dir="rtl"
                  value={f.clinicNameAr ?? ''}
                  onChange={handleFieldChange('clinicNameAr')}
                  data-testid="profile-editor-clinicNameAr"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  autoComplete="street-address"
                  value={f.address ?? ''}
                  onChange={handleFieldChange('address')}
                  data-testid="profile-editor-address"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Phone</Label>
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

        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <CardDescription>
              Signature + clinic logo are printed on every report PDF.
              PNG or JPEG, max 6 MB per file (enforced at the IPC
              boundary).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <input
              ref={signatureInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => void handleUpload('signature', e)}
              data-testid="profile-editor-signature-input"
            />
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Signature</p>
                <p className="text-xs text-muted-foreground" data-testid="profile-editor-signature-status">
                  {signatureAt === null
                    ? 'Not uploaded'
                    : `Uploaded at ${formatHHMMSS(signatureAt)}`}
                </p>
                {/* Phase 6 UAT G-06-3 — render the actual uploaded image so the
                    doctor can confirm the right file landed. Hidden when
                    nothing is uploaded yet. ~60px tall preview — large
                    enough to verify legibility, small enough to not
                    dominate the page. */}
                {signaturePreview !== null ? (
                  <img
                    src={signaturePreview}
                    alt="Uploaded signature preview"
                    className="mt-1 max-h-[60px] max-w-[200px] rounded border border-slate-200 bg-white object-contain p-1"
                    data-testid="profile-editor-signature-preview"
                  />
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => signatureInputRef.current?.click()}
                data-testid="profile-editor-signature-button"
              >
                <ImagePlus className="size-4 mr-1" aria-hidden="true" />
                Upload signature image
              </Button>
            </div>

            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => void handleUpload('logo', e)}
              data-testid="profile-editor-logo-input"
            />
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Clinic logo</p>
                <p className="text-xs text-muted-foreground" data-testid="profile-editor-logo-status">
                  {logoAt === null
                    ? 'Not uploaded'
                    : `Uploaded at ${formatHHMMSS(logoAt)}`}
                </p>
                {logoPreview !== null ? (
                  <img
                    src={logoPreview}
                    alt="Uploaded clinic logo preview"
                    className="mt-1 max-h-[60px] max-w-[200px] rounded border border-slate-200 bg-white object-contain p-1"
                    data-testid="profile-editor-logo-preview"
                  />
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => logoInputRef.current?.click()}
                data-testid="profile-editor-logo-button"
              >
                <ImagePlus className="size-4 mr-1" aria-hidden="true" />
                Upload clinic logo
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Phase 7 / Plan 07-03 — I18N-01 per-doctor language preference
            (D-17). EN/AR radio fires profile.update + audit.log
            ('language.changed') in parallel. Sits BELOW the Assets Card
            so the existing profile-editor tests for the upper Cards
            remain green. */}
        <Card data-testid="profile-editor-language-card">
          <CardHeader>
            <CardTitle>Language</CardTitle>
            <CardDescription>
              Choose the language for the clinic chrome. Report PDFs use
              the language chosen per-procedure.
            </CardDescription>
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
      </div>
    </main>
  );
}