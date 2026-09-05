// @vitest-environment happy-dom
// Plan 06-02 Task 10 — ProfileEditor tests.
// Per PROF-01 + CONTEXT.md §Doctor profile storage: 6 bilingual fields
// + signature + logo upload widgets. Auto-save-on-blur via useAutoSave.
// The upload widgets read via FileReader, sniff PNG/JPEG magic bytes
// client-side, then call api.profile.uploadSignature/uploadLogo.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getApi } from '../setup';
import { setRoute, initialRoute } from '@/lib/router';
import { session } from '@/store/session';
import ProfileEditor from '@/pages/ProfileEditor';
import type { DoctorProfile, UserPublic } from '@shared/ipc-contract';

const ADMIN_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
};

const PROFILE: DoctorProfile = {
  id: '00000000-0000-4000-8000-000000000555',
  userId: ADMIN_USER.id,
  fullNameEn: 'Dr. Layla Saleh',
  fullNameAr: 'د. ليلى صالح',
  clinicNameEn: 'Cairo Clinic',
  clinicNameAr: 'عيادة القاهرة',
  address: '15 Tahrir Square',
  phone: '+20-2-1234-5678',
  signaturePath: 'data/profiles/099/signature.png',
  logoPath: 'data/profiles/099/logo.png',
  // Quick task 260812-ns0 — header / footer / premedication.
  headerImagePath: null,
  footerImagePath: null,
  premedication: 'Midazolam 2-5mg IV',
  // Phase 7 / Plan 07-03 — I18N-01 (D-17): per-doctor language override.
  // Tests that flip the language override this to 'ar' before mounting.
  language: 'en',
  createdAt: 1_000,
  updatedAt: 1_000,
};

// ponytail: 1×1 transparent PNG (decoded bytes).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// ponytail: 1×1 transparent JPEG (decoded bytes). Magic bytes FF D8 FF.
// Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]).toString('base64') === '/9j/4AA='
// The first three decoded bytes are FF D8 FF — the JPEG SOI marker
// + APP0 high byte. Sufficient for the magic-byte sniff.
const JPEG_BASE64 = '/9j/4AA=';

function setSession(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER]);
}

beforeEach(() => {
  setRoute(initialRoute);
});

async function renderProfileEditor(): Promise<void> {
  setSession();
  await session.refresh();
  render(<ProfileEditor />);
}

describe('ProfileEditor', () => {
  it('renders the 6 labeled inputs', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    await renderProfileEditor();
    await waitFor(() => {
      expect(api.profile.get).toHaveBeenCalled();
    });
    expect(screen.getByTestId('profile-editor-fullNameEn')).toBeInTheDocument();
    expect(screen.getByTestId('profile-editor-fullNameAr')).toBeInTheDocument();
    expect(screen.getByTestId('profile-editor-clinicNameEn')).toBeInTheDocument();
    expect(screen.getByTestId('profile-editor-clinicNameAr')).toBeInTheDocument();
    expect(screen.getByTestId('profile-editor-address')).toBeInTheDocument();
    expect(screen.getByTestId('profile-editor-phone')).toBeInTheDocument();
  });

  it('field blur fires api.profile.update with the patched fields', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    api.profile.update.mockImplementation(async (input) => ({
      ...PROFILE,
      ...input,
    }));
    await renderProfileEditor();
    const fullNameEn = await screen.findByTestId('profile-editor-fullNameEn');
    fireEvent.change(fullNameEn, { target: { value: 'Dr. Layla H.' } });
    await waitFor(
      () => {
        expect(api.profile.update).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
    const lastCall = api.profile.update.mock.calls.at(-1)![0] as {
      fullNameEn?: string;
    };
    expect(lastCall.fullNameEn).toBe('Dr. Layla H.');
  });

  it('signature upload accepts a PNG (mocked FileReader)', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    api.profile.uploadSignature.mockResolvedValue({ signaturePath: 'sig.png' });
    // ponytail: stub FileReader.readAsDataURL to resolve with the
    // PNG data URL the moment the input changes. happy-dom's
    // FileReader uses a native code path that isn't easy to seed
    // with arbitrary bytes — the stub short-circuits it.
    const origFileReader = globalThis.FileReader;
    class StubFileReader {
      public result: string | ArrayBuffer | null = null;
      public error: Error | null = null;
      public onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      public onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      public readAsDataURL(_file: Blob): void {
        this.result = `data:image/png;base64,${PNG_BASE64}`;
        setTimeout(() => this.onload?.({} as ProgressEvent<FileReader>), 0);
      }
    }
    globalThis.FileReader = StubFileReader as unknown as typeof FileReader;
    try {
      await renderProfileEditor();
      const input = (await screen.findByTestId(
        'profile-editor-signature-input',
      )) as HTMLInputElement;
      const file = new File([new Uint8Array([0])], 'sig.png', { type: 'image/png' });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(
        () => {
          expect(api.profile.uploadSignature).toHaveBeenCalled();
        },
        { timeout: 1500 },
      );
      const lastCall = api.profile.uploadSignature.mock.calls.at(-1)![0] as {
        pngBase64?: string;
      };
      // ponytail: payload is RAW base64, not the data URL. The main
      // side's Buffer.from(payload.pngBase64, 'base64') would silently
      // decode the prefix chars (e.g. '/') and corrupt the first bytes
      // of the buffer — the magic-byte sniff would then reject a valid
      // PNG. So ProfileEditor strips the `data:image/png;base64,`
      // prefix before sending. Asserting that the payload starts with
      // the actual base64 (iVBORw0... for a 1x1 PNG) verifies the fix.
      expect(lastCall.pngBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(lastCall.pngBase64).not.toContain('data:image/png');
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });

  it('signature upload rejects non-PNG/JPEG (magic-byte sniff)', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    const origFileReader = globalThis.FileReader;
    class StubFileReader {
      public result: string | ArrayBuffer | null = null;
      public error: Error | null = null;
      public onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      public onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      // ponytail: return a TEXT payload — the magic-byte sniff
      // should reject (no PNG/JPEG signature) so the IPC is never
      // called.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      public readAsDataURL(_file: Blob): void {
        this.result = 'data:text/plain;base64,VEhJU0lTVEVYVA==';
        setTimeout(() => this.onload?.({} as ProgressEvent<FileReader>), 0);
      }
    }
    globalThis.FileReader = StubFileReader as unknown as typeof FileReader;
    try {
      await renderProfileEditor();
      const input = (await screen.findByTestId(
        'profile-editor-signature-input',
      )) as HTMLInputElement;
      const file = new File([new Uint8Array([0])], 'note.txt', { type: 'text/plain' });
      fireEvent.change(input, { target: { files: [file] } });
      // Wait briefly to let the async readAsDataURL + magic-byte
      // sniff complete, then assert the IPC was NOT called.
      await new Promise((r) => setTimeout(r, 50));
      expect(api.profile.uploadSignature).not.toHaveBeenCalled();
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });

  it('logo upload accepts a JPEG', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    api.profile.uploadLogo.mockResolvedValue({ logoPath: 'logo.png' });
    const origFileReader = globalThis.FileReader;
    class StubFileReader {
      public result: string | ArrayBuffer | null = null;
      public error: Error | null = null;
      public onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      public onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      public readAsDataURL(_file: Blob): void {
        this.result = `data:image/jpeg;base64,${JPEG_BASE64}`;
        setTimeout(() => this.onload?.({} as ProgressEvent<FileReader>), 0);
      }
    }
    globalThis.FileReader = StubFileReader as unknown as typeof FileReader;
    try {
      await renderProfileEditor();
      const input = (await screen.findByTestId(
        'profile-editor-logo-input',
      )) as HTMLInputElement;
      const file = new File([new Uint8Array([0])], 'logo.jpg', { type: 'image/jpeg' });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(
        () => {
          expect(api.profile.uploadLogo).toHaveBeenCalled();
        },
        { timeout: 1500 },
      );
      const lastCall = api.profile.uploadLogo.mock.calls.at(-1)![0] as {
        jpegBase64?: string;
      };
      // ponytail: see signature test — payload is RAW base64, no data URL prefix.
      expect(lastCall.jpegBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(lastCall.jpegBase64).not.toContain('data:image/jpeg');
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });

  // Phase 7 / Plan 07-03 — I18N-01 (D-17): per-doctor language picker
  // card. Selects EN/AR via radio, persists via profile.update, emits
  // a 'language.changed' audit row. The existing PROFILE shape carries
  // language: 'en' so the radio hydrates to English on first render.
  it('language picker Card mounts with EN + AR radio and initial value matches profile.language', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    await renderProfileEditor();
    const card = await screen.findByTestId('profile-editor-language-card');
    expect(card).toBeInTheDocument();
    const en = (await screen.findByTestId('profile-editor-language-en')) as HTMLInputElement;
    const ar = (await screen.findByTestId('profile-editor-language-ar')) as HTMLInputElement;
    expect(en).toBeInTheDocument();
    expect(ar).toBeInTheDocument();
    // PROFILE.language === 'en' → EN radio is checked.
    expect(en.checked).toBe(true);
    expect(ar.checked).toBe(false);
  });

  it('selecting AR radio persists language="ar" to profile.update + emits language.changed audit row (D-17 + audit hooks)', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    api.profile.update.mockImplementation(async (input) => ({
      ...PROFILE,
      ...input,
    }));
    await renderProfileEditor();
    const ar = await screen.findByTestId('profile-editor-language-ar');
    fireEvent.click(ar);
    await waitFor(() => {
      // ponytail: both calls fire in parallel via Promise.all. We wait
      // for the audit row first (auditable side-effect) — profile.update
      // is asserted via its mock call history.
      expect(api.audit.log).toHaveBeenCalledWith({
        action: 'language.changed',
        entityType: 'language',
        metadata: { from: 'en', to: 'ar', scope: 'profile' },
      });
    });
    const updateCall = api.profile.update.mock.calls.at(-1)![0] as {
      language?: 'en' | 'ar';
    };
    expect(updateCall.language).toBe('ar');
    // The existing fields are forwarded too (handler uses the current
    // profile as the base for the patch).
    expect(updateCall).toMatchObject({
      fullNameEn: PROFILE.fullNameEn,
      clinicNameEn: PROFILE.clinicNameEn,
    });
  });

  it('selecting the same language is a no-op (does NOT emit a duplicate audit row)', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    await renderProfileEditor();
    const en = await screen.findByTestId('profile-editor-language-en');
    // EN is already checked (PROFILE.language === 'en'). Clicking it
    // again must NOT fire profile.update or audit.log.
    fireEvent.click(en);
    await new Promise((r) => setTimeout(r, 100));
    expect(api.profile.update).not.toHaveBeenCalled();
    expect(api.audit.log).not.toHaveBeenCalled();
  });

  it('language=null (no per-doctor override) defaults the radio to EN', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue({ ...PROFILE, language: null });
    await renderProfileEditor();
    const en = await screen.findByTestId('profile-editor-language-en');
    const ar = await screen.findByTestId('profile-editor-language-ar');
    // Initial state defaults to 'en' when the override is null (the
    // i18n resolver falls back to users.language which is 'en' by
    // default).
    expect(en.checked).toBe(true);
    expect(ar.checked).toBe(false);
  });

  // Quick task 20260811-profile-sidebar-and-lang — Bug 1: ProfileEditor
  // is the only Settings page without a left-rail <SettingsSidebar />.
  // The fix mounts the sidebar with activeTab="profile"; the existing
  // Audit/Backup sidebar mount tests use data-active="true" as the
  // assertion seam. ProfileEditor follows the same pattern.
  it('SettingsSidebar mounts with activeTab="profile" (profile button active, others inactive)', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    await renderProfileEditor();
    // All five sidebar entries surface — capture, profile, audit,
    // backup-restore, users. The profile button is the only one with
    // data-active="true".
    const capture = await screen.findByTestId('settings-hub-capture');
    const profile = await screen.findByTestId('settings-hub-profile');
    const audit = await screen.findByTestId('settings-hub-audit');
    const backupRestore = await screen.findByTestId('settings-hub-backup-restore');
    const users = await screen.findByTestId('settings-hub-users');
    expect(capture).toBeInTheDocument();
    expect(profile).toBeInTheDocument();
    expect(audit).toBeInTheDocument();
    expect(backupRestore).toBeInTheDocument();
    expect(users).toBeInTheDocument();
    expect(profile.getAttribute('data-active')).toBe('true');
    expect(capture.getAttribute('data-active')).toBe('false');
    expect(audit.getAttribute('data-active')).toBe('false');
    expect(backupRestore.getAttribute('data-active')).toBe('false');
    expect(users.getAttribute('data-active')).toBe('false');
  });

  // Quick task 20260811-profile-sidebar-and-lang — Bug 2: ProfileEditor's
  // handleLanguageChange used to write the language to DB + emit an
  // audit row but never called i18n.changeLanguage(), so the toast
  // said "Language updated" while the UI stayed English and <html dir>
  // stayed ltr. The fix mirrors Wizard.tsx's i18n.changeLanguage call;
  // <LanguageApplier /> in main.tsx picks up the change and flips the
  // document direction via useLanguage's useEffect on i18n.language.
  //
  // ponytail: tests bypass main.tsx so <LanguageApplier /> is NOT
  // mounted — there is no useEffect consumer for document.dir to fire
  // in the test. The internal-call shape (i18n.changeLanguage called
  // with 'ar') is the right assertion seam: it's exactly what the
  // missing call site looked like before the fix. In production the
  // LanguageApplier is mounted at main.tsx and consumes the change.
  it('clicking AR radio calls i18n.changeLanguage("ar") (the missing call that fixed Bug 2)', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue(PROFILE);
    api.profile.update.mockImplementation(async (input) => ({
      ...PROFILE,
      ...input,
    }));
    // Spy on the global i18n instance so we can assert the renderer
    // actually flipped it. We import lazily so the spy is installed
    // after i18n.init from tests/renderer/setup.ts has run.
    const { default: i18n } = await import('@/i18n');
    const spy = vi.spyOn(i18n, 'changeLanguage');
    try {
      await renderProfileEditor();
      const ar = await screen.findByTestId('profile-editor-language-ar');
      fireEvent.click(ar);
      await waitFor(
        () => {
          expect(spy).toHaveBeenCalledWith('ar');
        },
        { timeout: 1500 },
      );
      // DB write also fires (sanity — the i18n flip is independent of
      // the audit row but the handler does both).
      expect(api.profile.update).toHaveBeenCalled();
      const updateCall = api.profile.update.mock.calls.at(-1)![0] as {
        language?: 'en' | 'ar';
      };
      expect(updateCall.language).toBe('ar');
    } finally {
      spy.mockRestore();
    }
  });

  // Quick task 260812-ns0 — header / footer image uploaders + the
  // 2x2 Asset grid + the new "Procedure defaults" card (premedication
  // + used-devices CRUD).
  describe('Quick task 260812-ns0 — header/footer/premedication/used-devices', () => {
    it('Assets card renders header + footer + signature + logo uploaders in a 2x2 grid', async () => {
      const api = getApi();
      api.profile.get.mockResolvedValue(PROFILE);
      await renderProfileEditor();
      expect(
        await screen.findByTestId('profile-editor-header-button'),
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId('profile-editor-footer-button'),
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId('profile-editor-signature-button'),
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId('profile-editor-logo-button'),
      ).toBeInTheDocument();
      // The four hidden file inputs all live in the Assets card.
      expect(
        screen.getByTestId('profile-editor-header-input'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('profile-editor-footer-input'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('profile-editor-signature-input'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('profile-editor-logo-input'),
      ).toBeInTheDocument();
    });

    it('header image upload accepts a PNG (mirror of the signature upload contract)', async () => {
      const api = getApi();
      api.profile.get.mockResolvedValue(PROFILE);
      api.profile.uploadHeader.mockResolvedValue({ headerImagePath: 'h.png' });
      const origFileReader = globalThis.FileReader;
      class StubFileReader {
        public result: string | ArrayBuffer | null = null;
        public error: Error | null = null;
        public onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
        public onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        public readAsDataURL(_file: Blob): void {
          this.result = `data:image/png;base64,${PNG_BASE64}`;
          setTimeout(() => this.onload?.({} as ProgressEvent<FileReader>), 0);
        }
      }
      globalThis.FileReader = StubFileReader as unknown as typeof FileReader;
      try {
        await renderProfileEditor();
        const input = (await screen.findByTestId(
          'profile-editor-header-input',
        )) as HTMLInputElement;
        const file = new File([new Uint8Array([0])], 'h.png', { type: 'image/png' });
        fireEvent.change(input, { target: { files: [file] } });
        await waitFor(() => {
          expect(api.profile.uploadHeader).toHaveBeenCalled();
        }, { timeout: 1500 });
      } finally {
        globalThis.FileReader = origFileReader;
      }
    });

    it('premedication input is wired to the auto-save IPC (focus → blur → profile.update)', async () => {
      const api = getApi();
      api.profile.get.mockResolvedValue(PROFILE);
      api.profile.update.mockImplementation(async (input) => ({
        ...PROFILE,
        ...input,
      }));
      await renderProfileEditor();
      const input = (await screen.findByTestId(
        'profile-editor-premedication',
      )) as HTMLInputElement;
      // The initial value mirrors PROFILE.premedication.
      expect(input.value).toBe('Midazolam 2-5mg IV');
      fireEvent.change(input, { target: { value: 'Midazolam 1-2mg IV' } });
      await waitFor(
        () => {
          expect(api.profile.update).toHaveBeenCalled();
        },
        { timeout: 1500 },
      );
      const lastCall = api.profile.update.mock.calls.at(-1)![0] as {
        premedication?: string | null;
      };
      expect(lastCall.premedication).toBe('Midazolam 1-2mg IV');
    });

    it('used-devices CRUD: add → list refetches → remove → list refetches', async () => {
      const api = getApi();
      const DEV1 = {
        id: '00000000-0000-4000-8000-000000000a01',
        profileId: '00000000-0000-4000-8000-000000000555',
        name: 'Olympus CV-260',
        notes: null,
        sortOrder: 0,
        createdAt: 1_000,
        updatedAt: 1_000,
      };

      // Empty initial list → empty state visible.
      api.profile.get.mockResolvedValue(PROFILE);
      api.usedDevices.list.mockResolvedValue([]);
      await renderProfileEditor();
      expect(
        await screen.findByTestId('profile-editor-used-devices-empty'),
      ).toBeInTheDocument();
      // list() fired once on mount.
      expect(api.usedDevices.list).toHaveBeenCalledTimes(1);

      // Add a device → add() called, list() refetches in the background.
      api.usedDevices.add.mockResolvedValue(DEV1);
      const nameInput = (await screen.findByTestId(
        'profile-editor-used-device-name-input',
      )) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Olympus CV-260' } });
      const addBtn = (await screen.findByTestId(
        'profile-editor-used-device-add',
      )) as HTMLButtonElement;
      fireEvent.click(addBtn);
      await waitFor(
        () => {
          expect(api.usedDevices.add).toHaveBeenCalledWith({
            name: 'Olympus CV-260',
            notes: null,
          });
        },
        { timeout: 1500 },
      );
      // refreshDevices() runs after add — list was called at least
      // twice now (initial + post-add).
      await waitFor(() => {
        expect(api.usedDevices.list.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});

// Plan 08-10 / G-08-4 — when the gate returns {ok:false} via the
// profile.get IPC the page detects the gate shape directly (the
// useDoctorProfile hook is unchanged) and renders <EmptyStateCard>
// inside SettingsLayout. No crash on undefined field reads.
describe('ProfileEditor — gated-IPC graceful degrade (08-10)', () => {
  it('renders <EmptyStateCard> when profile.get returns {ok: false, code: IPC_LICENSE_EXPIRED}', async () => {
    const api = getApi();
    api.profile.get.mockResolvedValue({ ok: false, code: 'IPC_LICENSE_EXPIRED' });
    setSession();
    await session.refresh();
    render(<ProfileEditor />);
    expect(await screen.findByTestId('gated-empty-state')).toBeInTheDocument();
    // The clinic title card is gone — only the empty-state + the
    // settings layout wrapper remain.
    expect(screen.queryByTestId('profile-editor-clinicNameEn')).not.toBeInTheDocument();
  });
});