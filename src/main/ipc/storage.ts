// storage IPC — quick task 20260912-shared-database-optional.
//
// Three channels that drive the Settings → Storage page:
//
//   STORAGE_GET_LOCATION   — read the current toggle + paths
//                            (always available, no session needed).
//   STORAGE_SET_LOCATION   — write the toggle + shared path to
//                            `<userData>/data-location.json`.
//                            Takes effect on the next app launch.
//   STORAGE_PICK_FOLDER    — open the OS folder picker; returns
//                            the chosen absolute path or null.
//
// All three are EXEMPT from the IPC gate (the doctor needs to
// configure storage BEFORE a session exists — the toggle is a
// one-shot admin action during the wizard or first-launch flow).
// The renderer never composes paths; the main-side handler
// owns the picker dialog.

import { dialog, ipcMain, app } from 'electron';
import {
  getDataLocationConfig,
  setDataLocationConfig,
  validateSharedPath,
} from '../storage/data-location-config';
import { dataRoot } from '../paths';
import {
  IPC,
  type StorageLocationResult,
  type StorageSetLocationResult,
  type StoragePickFolderResult,
} from '@shared/ipc-contract';
import { z } from 'zod';

// ponytail: local safeParse — mirrors the per-file pattern used
// by every other ipc/*.ts module (audit.ts, profile.ts, etc.).
// Trivial schema so a one-line inline helper is enough.
function safeParse<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fallbackField?: string,
): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw new Error(
    `Invalid ${fallbackField ?? 'payload'}: ${first?.message ?? 'validation failed'}`,
  );
}

const storageSetLocationInput = z.object({
  enabled: z.boolean(),
  sharedPath: z.string().nullable(),
});

export function registerStorageIpc(): void {
  ipcMain.handle(IPC.STORAGE_GET_LOCATION, () => {
    try {
      const cfg = getDataLocationConfig();
      // `dataRoot()` reads the same config (cached), so this
      // matches what the running app is using on this boot.
      // Useful for the renderer's "currently using X" hint.
      const effectivePath = dataRoot();
      const localPath = app.getPath('userData');
      const result: StorageLocationResult = {
        enabled: cfg.enabled,
        sharedPath: cfg.sharedPath,
        effectivePath,
        localPath,
      };
      return result;
    } catch (err) {
      throw err;
    }
  });

  ipcMain.handle(IPC.STORAGE_SET_LOCATION, (_e, raw) => {
    try {
      const { enabled, sharedPath } = safeParse(
        storageSetLocationInput,
        raw,
        'storage:set-location',
      );
      const next = { enabled, sharedPath: enabled ? sharedPath : null };
      // Validate the path BEFORE writing. When the doctor turns
      // sharing on with a missing / non-writable folder, fail
      // loud instead of silently leaving the toggle on with a
      // path that crashes the next launch.
      if (next.enabled && next.sharedPath) {
        const v = validateSharedPath(next.sharedPath);
        if (!v.ok) {
          const result: StorageSetLocationResult = {
            ok: false,
            reason: v.reason,
            requiresRestart: true,
          };
          return result;
        }
      }
      setDataLocationConfig(next);
      const result: StorageSetLocationResult = {
        ok: true,
        requiresRestart: true,
      };
      return result;
    } catch (err) {
      throw err;
    }
  });

  ipcMain.handle(IPC.STORAGE_PICK_FOLDER, async () => {
    // ponytail: same shape as LICENSE_PICK_AND_ACTIVATE (Plan 04
    // / Phase 8). The OS dialog is the only legitimate source
    // of the shared path; the renderer never composes it.
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select shared Colonoscopist data folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      const picked: StoragePickFolderResult = {
        path: result.canceled || result.filePaths.length === 0
          ? null
          : result.filePaths[0],
      };
      return picked;
    } catch (err) {
      throw err;
    }
  });
}