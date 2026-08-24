// Doctor profile IPC handlers (PROF-01).
// Per CONTEXT.md D-01..D-04 + Phase 2 BLOCKER 4 (renderer never sends a
// userId / doctorId — main derives both from `requireSession()`).
//
// Audit surface (per CONTEXT.md §Audit surface):
//   profile.updated
//   profile.signature_uploaded
//   profile.logo_uploaded
//
// Magic-byte sniff at the IPC boundary (Research §Pitfall 4): any payload
// whose first bytes don't match PNG or JPEG signatures is rejected with
// IPC_BAD_REQUEST before the file lands on disk.

import { ipcMain, app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import { IPC, type DoctorProfile } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';

import { doctorProfileUpdateSchema, profileUploadSchema } from '@shared/validators';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { profileAssetPath, profileDir } from '../paths';
import { detectImageFormat, extensionForFormat } from '../pdf/embed-image';
import { licenseGated } from '../license';

function fromZodError(err: z.ZodError, fallbackField?: string): IpcErrorException {
  const issue = err.issues[0];
  const field = (issue?.path[0] as string | undefined) ?? fallbackField;
  return new IpcErrorException(
    ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
  );
}

function safeParse<T>(schema: z.ZodType<T>, raw: unknown, fallbackField?: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) throw fromZodError(err, fallbackField);
    throw err;
  }
}

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_AUTH_REQUIRED', 'Not authenticated'));
  }
  return id;
}

function asIpcError(err: unknown): Error {
  if (err instanceof z.ZodError) return asIpcError(fromZodError(err));
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

// ponytail: helper decodes the base64 → Buffer, validates the magic
// bytes, picks the disk-extension that matches the sniffed format, and
// writes the file. Returns the userData-relative path the DB stores.
// One helper for both signature + logo keeps the magic-byte + write
// pair in one place so the two handlers can't drift.
function writeProfileAsset(
  userId: string,
  assetRel: string,
  base64: string,
): string {
  const buf = Buffer.from(base64, 'base64');
  const format = detectImageFormat(buf);
  if (!format) {
    throw new IpcErrorException(
      ipcError('IPC_BAD_REQUEST', 'image: invalid PNG/JPEG signature'),
    );
  }
  const ext = extensionForFormat(format);
  // ponytail: filename = assetRel minus any extension + the sniffed
  // extension. assetRel is 'signature' / 'logo' (no extension passed in).
  const filename = `${assetRel}.${ext}`;
  const absPath = profileAssetPath(userId, filename);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, buf);
  // userData-relative path for the DB column.
  const userData = app.getPath('userData');
  return path.relative(userData, absPath).split(path.sep).join('/');
}

// Quick task 260812-ns0 — header / footer image uploads. Same shape as
// signature / logo: base64 → magic-byte sniff → write → path writeback.
function uploadHeaderOrFooter(
  kind: 'header' | 'footer',
  userId: string,
  input: { jpegBase64?: string; pngBase64?: string },
): string {
  const base64 = input.jpegBase64 ?? input.pngBase64;
  if (!base64) {
    throw new IpcErrorException(
      ipcError('IPC_BAD_REQUEST', 'exactly one of jpegBase64 or pngBase64 is required'),
    );
  }
  return writeProfileAsset(userId, kind, base64);
}

export function registerProfileIpc(): void {
  // Phase 8 / Plan 03 — wrap every handler with `licenseGated`. PROFILE_*
  // channels are GATED; expired licenses cannot view / update the
  // doctor profile or upload signature/logo/header/footer images.
  ipcMain.handle(IPC.PROFILE_GET, licenseGated(IPC.PROFILE_GET, () => {
    try {
      const userId = requireSession();
      const row = doctorProfileRepo.get(userId);
      audit({
        action: 'profile.viewed',
        entityType: 'profile',
        entityId: userId,
        userId,
      });
      return row;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.PROFILE_UPDATE, licenseGated(IPC.PROFILE_UPDATE, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(doctorProfileUpdateSchema, raw);
      // Phase 7 / Plan 07-01 — I18N-01: forward the optional
      // `language` field. undefined means "leave the existing value";
      // null means "clear the per-doctor override so the resolver
      // falls back to users.language". The repo's upsert handles the
      // undefined-vs-explicit distinction.
      //
      // Quick task 260812-ns0 — `premedication` follows the same
      // undefined-vs-explicit contract.
      const updated: DoctorProfile = doctorProfileRepo.upsert({
        userId,
        fullNameEn: input.fullNameEn,
        fullNameAr: input.fullNameAr,
        clinicNameEn: input.clinicNameEn,
        clinicNameAr: input.clinicNameAr,
        address: input.address,
        phone: input.phone,
        language: input.language,
        premedication: input.premedication,
      });
      const changedFields = Object.keys(input).filter(
        (k) => (input as Record<string, unknown>)[k] !== undefined,
      );
      audit({
        action: 'profile.updated',
        entityType: 'profile',
        entityId: userId,
        userId,
        metadata: { changedFields },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.PROFILE_UPLOAD_SIGNATURE, licenseGated(IPC.PROFILE_UPLOAD_SIGNATURE, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(profileUploadSchema, raw);
      const base64 = input.jpegBase64 ?? input.pngBase64!;
      const relPath = writeProfileAsset(userId, 'signature', base64);
      doctorProfileRepo.updateSignaturePath(userId, relPath);
      audit({
        action: 'profile.signature_uploaded',
        entityType: 'profile',
        entityId: userId,
        userId,
        metadata: { signaturePath: relPath },
      });
      return { signaturePath: relPath };
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.PROFILE_UPLOAD_LOGO, licenseGated(IPC.PROFILE_UPLOAD_LOGO, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(profileUploadSchema, raw);
      const base64 = input.jpegBase64 ?? input.pngBase64!;
      const relPath = writeProfileAsset(userId, 'logo', base64);
      doctorProfileRepo.updateLogoPath(userId, relPath);
      audit({
        action: 'profile.logo_uploaded',
        entityType: 'profile',
        entityId: userId,
        userId,
        metadata: { logoPath: relPath },
      });
      return { logoPath: relPath };
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Quick task 260812-ns0 — header / footer image uploads (top / bottom
  // bands on the PDF report).
  ipcMain.handle(IPC.PROFILE_UPLOAD_HEADER, licenseGated(IPC.PROFILE_UPLOAD_HEADER, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(profileUploadSchema, raw);
      const relPath = uploadHeaderOrFooter('header', userId, input);
      doctorProfileRepo.updateHeaderImagePath(userId, relPath);
      audit({
        action: 'profile.header_uploaded',
        entityType: 'profile',
        entityId: userId,
        userId,
        metadata: { headerImagePath: relPath },
      });
      return { headerImagePath: relPath };
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.PROFILE_UPLOAD_FOOTER, licenseGated(IPC.PROFILE_UPLOAD_FOOTER, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(profileUploadSchema, raw);
      const relPath = uploadHeaderOrFooter('footer', userId, input);
      doctorProfileRepo.updateFooterImagePath(userId, relPath);
      audit({
        action: 'profile.footer_uploaded',
        entityType: 'profile',
        entityId: userId,
        userId,
        metadata: { footerImagePath: relPath },
      });
      return { footerImagePath: relPath };
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Phase 6 UAT G-06-3 — image preview. ProfileEditor needs to render
  // the actual uploaded signature + logo as `<img>` previews. The
  // signature/logo_path columns store userData-relative paths; the
  // MediaServer only handles `/media/<patientId>/...` for screenshots,
  // not profile assets. Cheapest path: a new IPC that returns the
  // bytes as a base64 data URL. The renderer can drop this straight
  // into `<img src=...>`. Limited to ~2MB per asset (matches the
  // MediaServer's screenshot cap) — adequate for a 1-2MB signature
  // PNG or logo.
  //
  // Quick task 260812-ns0 — extended for header / footer previews.
  ipcMain.handle(IPC.PROFILE_GET_ASSET_DATA_URL, licenseGated(IPC.PROFILE_GET_ASSET_DATA_URL, (_e, raw: unknown) => {
    try {
      const userId = requireSession();
      const input = safeParse(
        z.object({ kind: z.enum(['signature', 'logo', 'header', 'footer']) }),
        raw,
      );
      const row = doctorProfileRepo.get(userId);
      if (row === null) {
        return { dataUrl: null };
      }
      const relPath =
        input.kind === 'signature' ? row.signaturePath
        : input.kind === 'logo' ? row.logoPath
        : input.kind === 'header' ? row.headerImagePath
        : row.footerImagePath;
      if (relPath === null) {
        return { dataUrl: null };
      }
      const userData = app.getPath('userData');
      const absPath = path.join(userData, relPath.split('/').join(path.sep));
      if (!existsSync(absPath)) {
        return { dataUrl: null };
      }
      const buf = readFileSync(absPath);
      // ponytail: re-validate magic bytes on read (defense in depth — a
      // maliciously-renamed file should never reach the renderer).
      const format = detectImageFormat(buf);
      if (!format) {
        return { dataUrl: null };
      }
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      throw asIpcError(err);
    }
  }));
}

// Re-export for the test suite; not part of the IPC surface.
export const __test = {
  safeParse,
  fromZodError,
  asIpcError,
  requireSession,
  writeProfileAsset,
};

// ponytail: profileDir is exported for tests that need to seed the
// directory before invoking the upload handlers.
export { profileDir };
