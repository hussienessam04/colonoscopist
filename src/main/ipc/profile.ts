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
import { profileAssetPath, profileDir, dataDir } from '../paths';
import { detectImageFormat, extensionForFormat } from '../pdf/embed-image';

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

export function registerProfileIpc(): void {
  ipcMain.handle(IPC.PROFILE_GET, () => {
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
  });

  ipcMain.handle(IPC.PROFILE_UPDATE, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(doctorProfileUpdateSchema, raw);
      const updated: DoctorProfile = doctorProfileRepo.upsert({
        userId,
        fullNameEn: input.fullNameEn,
        fullNameAr: input.fullNameAr,
        clinicNameEn: input.clinicNameEn,
        clinicNameAr: input.clinicNameAr,
        address: input.address,
        phone: input.phone,
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
  });

  ipcMain.handle(IPC.PROFILE_UPLOAD_SIGNATURE, (_e, raw) => {
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
  });

  ipcMain.handle(IPC.PROFILE_UPLOAD_LOGO, (_e, raw) => {
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
  });

  // Phase 6 UAT G-06-3 — image preview. ProfileEditor needs to render
  // the actual uploaded signature + logo as `<img>` previews. The
  // signature/logo_path columns store userData-relative paths; the
  // MediaServer only handles `/media/<patientId>/...` for screenshots,
  // not profile assets. Cheapest path: a new IPC that returns the
  // bytes as a base64 data URL. The renderer can drop this straight
  // into `<img src=...>`. Limited to ~2MB per asset (matches the
  // MediaServer's screenshot cap) — adequate for a 1-2MB signature
  // PNG or logo.
  ipcMain.handle(IPC.PROFILE_GET_ASSET_DATA_URL, (_e, raw: unknown) => {
    try {
      const userId = requireSession();
      const input = safeParse(
        z.object({ kind: z.enum(['signature', 'logo']) }),
        raw,
      );
      const row = doctorProfileRepo.get(userId);
      if (row === null) {
        return { dataUrl: null };
      }
      const relPath = input.kind === 'signature' ? row.signaturePath : row.logoPath;
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
  });
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
