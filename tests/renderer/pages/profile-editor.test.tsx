// @vitest-environment happy-dom
// Plan 06-02 Task 10 — ProfileEditor tests.
// Per PROF-01 + CONTEXT.md §Doctor profile storage: 6 bilingual fields
// + signature + logo upload widgets. Auto-save-on-blur via useAutoSave.
// The upload widgets read via FileReader, sniff PNG/JPEG magic bytes
// client-side, then call api.profile.uploadSignature/uploadLogo.

import { describe, expect, it, beforeEach } from 'vitest';
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
      expect(lastCall.pngBase64).toContain('data:image/png');
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
      expect(lastCall.jpegBase64).toContain('data:image/jpeg');
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });
});