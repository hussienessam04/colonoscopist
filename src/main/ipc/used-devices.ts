// Doctor profile — used-devices IPC handlers.
// Quick task 260812-ns0 — used_devices CRUD (1:N with doctor_profile).
//
// Renderer-facing keys are userId-keyed (the renderer never sees
// profile.id directly). The handler resolves userId → profile.id via
// doctorProfileRepo.get() — if no doctor_profile row exists for the
// current session (rare; the wizard creates one), it returns
// IPC_NOT_FOUND. List + Add use the resolved profile.id for FK; Remove
// is by used_device.id (renderer already has it from the list response).
//
// Audit surface (per CONTEXT.md §Audit surface):
//   used_devices.added
//   used_devices.removed
//   used_devices.listed

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, type UsedDevice } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';

import { usedDeviceAddInput, usedDeviceIdInput } from '@shared/validators';
import { usedDevicesRepo } from '../db/used-devices-repo';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_AUTH_REQUIRED', 'Not authenticated'));
  }
  return id;
}

// Helper: renderer surfaces userId; used_devices.profile_id points at the
// doctor_profile.id PK. Translates via the repo. Returns null when the
// caller has not yet bootstrapped a doctor_profile row (the wizard
// creates one on first launch — this branch is a defense-in-depth
// guard for tests + future paths that bypass the wizard).
function resolveProfileId(userId: string): string {
  const profile = doctorProfileRepo.get(userId);
  if (!profile) {
    throw new IpcErrorException(
      ipcError('IPC_NOT_FOUND', 'Doctor profile not found — complete the wizard first'),
    );
  }
 return profile.id;
}

function safeParse<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const field = (issue?.path[0] as string | undefined) ?? undefined;
      throw new IpcErrorException(
        ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
      );
    }
    throw err;
  }
}

function asIpcError(err: unknown): Error {
  if (err instanceof z.ZodError) {
    const wrapped = new Error(err.issues[0]?.message ?? 'Invalid input') as Error & { ipcError?: unknown };
    wrapped.ipcError = {
      code: 'IPC_VALIDATION',
      message: err.issues[0]?.message ?? 'Invalid input',
    };
    return wrapped;
  }
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export function registerUsedDevicesIpc(): void {
  ipcMain.handle(IPC.USED_DEVICES_LIST, () => {
    try {
      const userId = requireSession();
      const profileId = resolveProfileId(userId);
      const devices = usedDevicesRepo.listByProfile(profileId);
      audit({
        action: 'used_devices.listed',
        entityType: 'used_device',
        entityId: profileId,
        userId,
        metadata: { count: devices.length },
      });
      return devices as UsedDevice[];
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.USED_DEVICES_ADD, (_e, raw) => {
    try {
      const userId = requireSession();
      const profileId = resolveProfileId(userId);
      const input = safeParse(usedDeviceAddInput, raw);
      const created = usedDevicesRepo.add({
        profileId,
        name: input.name,
        notes: input.notes ?? null,
        sortOrder: input.sortOrder,
      });
      audit({
        action: 'used_devices.added',
        entityType: 'used_device',
        entityId: created.id,
        userId,
        metadata: { name: created.name },
      });
      return created as UsedDevice;
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.USED_DEVICES_REMOVE, (_e, raw) => {
    try {
      const userId = requireSession();
      const { id } = safeParse(usedDeviceIdInput, raw);
      const removed = usedDevicesRepo.remove(id);
      audit({
        action: 'used_devices.removed',
        entityType: 'used_device',
        entityId: id,
        userId,
        outcome: removed ? 'ok' : 'failed',
      });
      return { ok: true as const };
    } catch (err) {
      throw asIpcError(err);
    }
  });
}