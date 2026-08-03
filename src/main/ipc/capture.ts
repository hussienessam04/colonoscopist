// Capture IPC handlers: enumeration + per-doctor default + per-(doctor, device)
// preset + no-device audit sink.
//
// BLOCKER 4: every handler derives `doctorId` from `requireSession()`. The
// payloads for `setPreset` / `setDefaultDevice` do NOT include a doctorId
// field (see `IpcContract.capture` in shared/ipc-contract.ts); the renderer
// cannot impersonate another doctor.

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, type CaptureDevice, type QualityPreset } from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';
import {
  captureDeviceIdInput,
  capturePresetInput,
  capturePresetQueryInput,
  noDeviceAuditInput,
} from '@shared/validators';
import { enumerateDshowDevices } from '../capture/devices';
import { presetRepo } from '../capture/preset-repo';
import { autoDetectPreset, type MatchedPattern } from '../capture/auto-detect-preset';
import { canonicalizeOrThrow } from '../capture/canonicalize';
import { audit } from '../db/audit';
import { session } from '../auth/session';

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Not authenticated'));
  }
  return id;
}

function fromZodError(err: z.ZodError, fallbackField?: string): IpcErrorException {
  const issue = err.issues[0];
  const field = (issue?.path[0] as string | undefined) ?? fallbackField;
  return new IpcErrorException(
    ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
  );
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

// ponytail: returns the existing preset if the matrix row already exists —
// auto-detect fires ONCE per (doctor, device) pair.
function getOrAutoDetectPreset(
  doctorId: string,
  deviceId: string,
): { preset: QualityPreset; matched?: MatchedPattern; isFirstSave: boolean } {
  const existing = presetRepo.getPreset(doctorId, deviceId);
  if (existing) return { preset: existing, isFirstSave: false };
  const inferred = autoDetectPreset(deviceId);
  const preset: QualityPreset = { preset: inferred.preset };
  presetRepo.setPreset(doctorId, deviceId, preset);
  return { preset, matched: inferred.matched, isFirstSave: true };
}

export function listDevices(): Promise<CaptureDevice[]> {
  return enumerateDshowDevices();
}

export function getDefaultDevice(): string | null {
  const doctorId = requireSession();
  const deviceId = presetRepo.getDefault(doctorId);
  audit({
    action: 'capture.device_changed',
    entityType: 'capture',
    entityId: null,
    metadata: { stage: 'read', deviceName: deviceId },
  });
  return deviceId;
}

export function setDefaultDevice(input: unknown): { ok: true } {
  const { deviceId } = captureDeviceIdInput.parse(input);
  const doctorId = requireSession();
  // ponytail: canonicalize BEFORE both the settings write and the audit row so
  // audit metadata always echoes the same form (D-11 — single canonical name).
  const canonical = canonicalizeOrThrow(deviceId);
  presetRepo.setDefault(doctorId, canonical);
  audit({
    action: 'capture.device_changed',
    entityType: 'capture',
    entityId: null,
    metadata: { stage: 'save', deviceName: canonical },
  });
  return { ok: true };
}

export function getPreset(input: unknown): QualityPreset | null {
  const { deviceId } = capturePresetQueryInput.parse(input);
  const doctorId = requireSession();
  const result = getOrAutoDetectPreset(doctorId, deviceId);
  // First save emits the matched regex in audit metadata (Q-A).
  // Subsequent reads emit only the preset.
  if (result.isFirstSave) {
    audit({
      action: 'capture.preset_changed',
      entityType: 'capture',
      entityId: deviceId,
      metadata: {
        deviceName: deviceId,
        preset: result.preset.preset,
        matched: result.matched,
      },
    });
  } else {
    audit({
      action: 'capture.preset_changed',
      entityType: 'capture',
      entityId: deviceId,
      metadata: { deviceName: deviceId, preset: result.preset.preset },
    });
  }
  // ponytail: drop the matched wrapper — Q-A audit metadata already lives in
  // the audit_log via the if/else branches above; only the IPC response shape
  // needed to match the declared `Promise<QualityPreset | null>` contract.
  return result.preset;
}

export function setPreset(input: unknown): { ok: true } {
  const { deviceId, preset } = capturePresetInput.parse(input);
  const doctorId = requireSession();
  // ponytail: canonicalize BEFORE both the settings write and the audit row
  // (D-11). presetRepo already canonicalizes, but the audit needs the same form.
  const canonical = canonicalizeOrThrow(deviceId);
  presetRepo.setPreset(doctorId, canonical, preset);
  audit({
    action: 'capture.preset_changed',
    entityType: 'capture',
    entityId: canonical,
    metadata: { deviceName: canonical, preset: preset.preset },
  });
  return { ok: true };
}

export function noDeviceAudit(input: unknown): { ok: true } {
  noDeviceAuditInput.parse(input ?? {});
  // ponytail: renderer-side marker; we still require a session so only
  // authenticated doctors can pollute the audit log.
  requireSession();
  audit({
    action: 'capture.no_device',
    entityType: 'capture',
    entityId: null,
    metadata: { source: 'renderer-empty-state' },
  });
  return { ok: true };
}

export function registerCaptureIpc(): void {
  ipcMain.handle(IPC.CAPTURE_LIST_DEVICES, async () => {
    try {
      return await listDevices();
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.CAPTURE_GET_DEFAULT_DEVICE, () => {
    try {
      return getDefaultDevice();
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.CAPTURE_SET_DEFAULT_DEVICE, (_e, raw) => {
    try {
      return setDefaultDevice(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.CAPTURE_GET_PRESET, (_e, raw) => {
    try {
      return getPreset(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.CAPTURE_SET_PRESET, (_e, raw) => {
    try {
      return setPreset(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });

  ipcMain.handle(IPC.CAPTURE_NO_DEVICE_AUDIT, (_e, raw) => {
    try {
      return noDeviceAudit(raw);
    } catch (err) {
      throw asIpcError(err);
    }
  });
}
