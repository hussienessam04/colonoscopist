// zod schemas for IPC input validation. Renderer + main both parse from these.
// Per Fix 5 + AUTH-02/03/04 + D-01/02/03 + AUDIT-01.

import { z } from 'zod';

export const wizardInput = z.object({
  fullName: z.string().min(1).max(120),
  clinicName: z.string().min(1).max(120),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  confirmPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  // Phase 7 / Plan 07-01 — I18N-01: workstation-level default language
  // (per D-18). 'ar' enables RTL in the renderer; defaults to 'en' if
  // omitted. Stored on users.language.
  language: z.enum(['en', 'ar']).optional(),
}).refine((d) => d.pin === d.confirmPin, { message: 'PIN and confirmation must match', path: ['confirmPin'] });

export const pinInput = z.object({
  userId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export const userInput = z.object({
  fullName: z.string().min(1).max(120),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  // Phase 7 / Plan 07-01 — I18N-01: per-doctor language preference.
  // Stored on users.language; defaults to 'en' if omitted.
  language: z.enum(['en', 'ar']).optional(),
});

export const userRemoveInput = z.object({
  userId: z.string().uuid(),
});

export const resetPinInput = z.object({
  userId: z.string().uuid(),
  newPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export const auditFilterInput = z.object({
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  action: z.string().min(1).max(120).optional(),
  userId: z.string().uuid().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
});

// Plan 02-02 patient schemas — re-validated in main (per Fix 5 + V5 Input Validation).
export const idInput = z.object({
  id: z.string().uuid(),
});

export const patientInput = z.object({
  fullName: z.string().min(1).max(120),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be ISO yyyy-mm-dd'),
  gender: z.enum(['male', 'female', 'other']).nullish(),
  mrn: z.string().min(1).max(50).nullish(),
  phone: z.string().min(1).max(30).nullish(),
  notes: z.string().min(1).max(2000).nullish(),
});

export const patientPatchInput = z
  .object({
    fullName: z.string().min(1).max(120).optional(),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be ISO yyyy-mm-dd').optional(),
    gender: z.enum(['male', 'female', 'other']).nullish(),
    mrn: z.string().min(1).max(50).nullish(),
    phone: z.string().min(1).max(30).nullish(),
    notes: z.string().min(1).max(2000).nullish(),
  })
  .strict();

export const patientListQueryInput = z
  .object({
    search: z.string().min(1).max(120).optional(),
    mrn: z.string().min(1).max(50).optional(),
    includeDeleted: z.boolean().optional(),
    // Phase 7 / Plan 07-02 — SRCH-01..03 + D-01..D-03: cross-cutting
    // Patient List filters. dateFrom/dateTo are yyyy-mm-dd strings parsed
    // by main into ms-range bounds against procedures.started_at.
    // doctorId is a UUID filter against procedures.doctor_id.
    // procedureStatus is a multi-select across the canonical ProcedureStatus
    // enum (per D-02). All four are AND-combined per D-02 verbatim.
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be ISO yyyy-mm-dd').optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be ISO yyyy-mm-dd').optional(),
    doctorId: z.string().uuid().optional(),
    procedureStatus: z
      .array(z.enum(['recording', 'completed', 'partial', 'crashed']))
      .optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(200).optional(),
  })
  .strict();

export type WizardInput = z.infer<typeof wizardInput>;
export type PinInput = z.infer<typeof pinInput>;
export type UserInput = z.infer<typeof userInput>;
export type UserRemoveInput = z.infer<typeof userRemoveInput>;
export type ResetPinInput = z.infer<typeof resetPinInput>;
export type AuditFilterInput = z.infer<typeof auditFilterInput>;
export type IdInput = z.infer<typeof idInput>;
export type PatientInput = z.infer<typeof patientInput>;
export type PatientPatchInput = z.infer<typeof patientPatchInput>;
export type PatientListQueryInput = z.infer<typeof patientListQueryInput>;

// Plan 03-01 capture schemas (CAPT-01/02/10, SET-01/02).
// D-05 — custom resolution matches `W[ x ×]H` with 2–5 digit sides; framerate
// exactly 25/30/50/60 (standard NTSC/PAL/EU/HD). No bitrate/pixel-format/GOP:
// those are Phase 4 ffmpeg concerns.
export const captureDeviceIdInput = z.object({
  deviceId: z.string().min(1).max(500),
});

export const qualityPresetSchema = z.discriminatedUnion('preset', [
  z.object({ preset: z.literal('sd') }),
  z.object({ preset: z.literal('hd') }),
  z.object({
    preset: z.literal('custom'),
    resolution: z.string().regex(/^\d{2,5}[x×]\d{2,5}$/, 'Resolution must be WxH like 1920x1080'),
    framerate: z.number().int().refine((n) => [25, 30, 50, 60].includes(n), 'Framerate must be 25/30/50/60'),
  }),
]);

export const capturePresetInput = z.object({
  deviceId: z.string().min(1).max(500),
  preset: qualityPresetSchema,
});

export const capturePresetQueryInput = z.object({
  deviceId: z.string().min(1).max(500),
});

// Per D-02 + Q-A: `noDeviceAudit` is a renderer-side marker; no payload required.
export const noDeviceAuditInput = z.object({}).strict();

export type CaptureDeviceIdInput = z.infer<typeof captureDeviceIdInput>;
export type QualityPresetInput = z.infer<typeof qualityPresetSchema>;
export type CapturePresetInput = z.infer<typeof capturePresetInput>;
export type CapturePresetQueryInput = z.infer<typeof capturePresetQueryInput>;
export type NoDeviceAuditInput = z.infer<typeof noDeviceAuditInput>;

// Plan 04-01 — procedures + procedure-notes + recording schemas (CAPT-04/05/06/07).
// Per BLOCKER 4 + D-01: payloads do NOT include a doctorId field. Main derives
// the doctorId from `requireSession()` exclusively.
export const proceduresCreateInput = z.object({
  patientId: z.string().uuid(),
});

export const proceduresGetInput = z.object({
  id: z.string().uuid(),
});

export const proceduresListQueryInput = z
  .object({
    patientId: z.string().uuid().optional(),
    status: z.enum(['recording', 'completed', 'partial', 'crashed']).optional(),
    // Phase 7 / Plan 07-02 — D-04 verbatim: extend the procedures.list
    // query with the same date range + doctor filters as patients.list.
    // procedureStatus is per-patient (filter sidebar); procedure.list
    // takes status (single value) per Phase 4. Date range applies to
    // procedures.started_at (per Phase 4 D-10 canonical date).
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be ISO yyyy-mm-dd').optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be ISO yyyy-mm-dd').optional(),
    doctorId: z.string().uuid().optional(),
    page: z.number().int().positive().max(200).optional(),
    pageSize: z.number().int().positive().max(200).optional(),
  })
  .strict();

export const proceduresFinalizeInput = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['completed', 'partial']),
    endedAt: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
    videoPath: z.string().min(1).max(2000),
    partialJson: z
      .object({
        lastKnownTimestampMs: z.number().int().nonnegative(),
        deviceLostAt: z.number().int().nonnegative(),
        deviceName: z.string().min(1).max(500),
      })
      .optional(),
  })
  .strict();

export const procedureNoteCreateInput = z.object({
  procedureId: z.string().uuid(),
  body: z.string().min(1).max(1000),
});

export const procedureNoteListInput = z.object({
  procedureId: z.string().uuid(),
});

export const procedureIdInput = z.object({
  procedureId: z.string().uuid(),
});

export const recordingStartInput = z.object({
  patientId: z.string().uuid(),
  procedureId: z.string().uuid().optional(),
  deviceId: z.string().min(1).max(500),
  preset: qualityPresetSchema,
});

// Phase 5 / Plan 01 screenshots + trim validators. The trim input is
// declared now so the IPC surface is final; the validator still rejects
// malformed payloads even though Plan 01's stub handler returns
// IPC_NOT_IMPLEMENTED. `.refine` enforces the half-open interval
// [inMs, outMs) per D-08 trim semantics.
export const screenshotsAddInput = z.object({
  procedureId: z.string().uuid(),
  // ponytail: maxLongEdge=1280 + JPEG q=0.85 produces ~80–400 KB decoded
  // for typical 1920x1080 / 720x480 input. 8 MB base64 cap
  // (≈6 MB decoded) leaves headroom for the doctor's worst case while
  // bounding the JS heap + disk-usage DoS surface.
  timestampInVideoMs: z.number().int().nonnegative(),
  jpegBase64: z.string().min(1).max(8_000_000),
});

export const screenshotsListInput = z.object({
  procedureId: z.string().uuid(),
});

export const screenshotsDeleteInput = z.object({
  id: z.number().int().positive(),
});

export const screenshotsUpdateAnnotationInput = z.object({
  id: z.number().int().positive(),
  annotation: z.string().min(1).max(1000).nullable(),
});

export const proceduresTrimInput = z
  .object({
    id: z.string().uuid(),
    inMs: z.number().int().nonnegative(),
    outMs: z.number().int().positive(),
  })
  .refine((d) => d.outMs > d.inMs, {
    message: 'outMs must be greater than inMs',
    path: ['outMs'],
  });

export const proceduresRestoreInput = z.object({
  id: z.string().uuid(),
});

export type ProceduresCreateInput = z.infer<typeof proceduresCreateInput>;
export type ProceduresGetInput = z.infer<typeof proceduresGetInput>;
export type ProceduresListQueryInput = z.infer<typeof proceduresListQueryInput>;
export type ProceduresFinalizeInput = z.infer<typeof proceduresFinalizeInput>;
export type ProcedureNoteCreateInput = z.infer<typeof procedureNoteCreateInput>;
export type ProcedureNoteListInput = z.infer<typeof procedureNoteListInput>;
export type RecordingStartInput = z.infer<typeof recordingStartInput>;
export type ScreenshotsAddInput = z.infer<typeof screenshotsAddInput>;
export type ScreenshotsListInput = z.infer<typeof screenshotsListInput>;
export type ScreenshotsDeleteInput = z.infer<typeof screenshotsDeleteInput>;
export type ScreenshotsUpdateAnnotationInput = z.infer<typeof screenshotsUpdateAnnotationInput>;
export type ProceduresTrimInput = z.infer<typeof proceduresTrimInput>;
export type ProceduresRestoreInput = z.infer<typeof proceduresRestoreInput>;

// Phase 6 / Plan 01 — Doctor profile + reports input validators (PROF-01,
// RPT-01..05). userId / doctorId are NEVER accepted as input — main
// derives them from requireSession() per Phase 2 BLOCKER 4.
//
// doctorProfileUpdateSchema:
export const doctorProfileUpdateSchema = z
  .object({
    fullNameEn: z.string().min(1).max(120),
    fullNameAr: z.string().max(120).nullable(),
    clinicNameEn: z.string().min(1).max(160),
    clinicNameAr: z.string().max(160).nullable(),
    address: z.string().max(500).nullable(),
    phone: z.string().max(40).nullable(),
    // Phase 7 / Plan 07-01 — I18N-01 (per D-17): doctor-profile-level
    // language preference. NULL means "follow users.language" (the
    // doctor has not picked their own preference yet). The renderer
    // reads doctor_profile.language first, then falls back to
    // users.language for the active session.
    language: z.enum(['en', 'ar']).nullable().optional(),
  })
  .strict();

// reportUpdateSchema: patch only the four free-text fields. Per D-07 these
// are the only patchable columns post-finalize. Status, procedure_id,
// doctor_id, finalized_at, created_at are immutable post-insert.
export const reportUpdateSchema = z
  .object({
    findings: z.string().max(8000).optional(),
    diagnosis: z.string().max(4000).optional(),
    recommendations: z.string().max(4000).optional(),
    procedureDetails: z.string().max(4000).optional(),
  })
  .strict();

// profileUploadSchema: the renderer's FileReader → base64 → IPC payload.
// Either jpegBase64 OR pngBase64 is accepted (not both, not neither) so
// the IPC handler can pick the right disk extension. The magic-byte
// sniff in embed-image.ts is the second gate — zod only narrows the
// shape, the actual format detection is zero-dep at the read side.
export const profileUploadSchema = z
  .object({
    jpegBase64: z.string().min(1).optional(),
    pngBase64: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.jpegBase64) !== Boolean(v.pngBase64), {
    message: 'exactly one of jpegBase64 or pngBase64 is required',
  });

// reportIdSchema: shared id validator for finalize / openPdf / regenPdf /
// updateDraft / updateFinalized / attachScreenshot / etc.
export const reportIdSchema = z.object({ id: z.string().min(1) }).strict();

// reportProcedureSchema: for getOrCreate — procedureId is the lookup key.
export const reportProcedureSchema = z
  .object({ procedureId: z.string().min(1) })
  .strict();

export type DoctorProfileUpdateInput = z.infer<typeof doctorProfileUpdateSchema>;
export type ReportUpdateInput = z.infer<typeof reportUpdateSchema>;
export type ProfileUploadInput = z.infer<typeof profileUploadSchema>;
export type ReportIdInput = z.infer<typeof reportIdSchema>;
export type ReportProcedureInput = z.infer<typeof reportProcedureSchema>;

// Phase 7 / Plan 07-01 — Backup/Restore + audit.log + language IPC
// input validators (SET-05/06, AUDIT-01, I18N-01).

// auditLogInput: payload for the audit:log IPC channel. Renderer-only
// path (no other write surface to audit_log); all other writes route
// through the audit() helper inside main. The metadata object is
// validated to Record<string, unknown> at the IPC boundary so a
// renderer-supplied payload can't smuggle function values that would
// fail JSON.stringify downstream.
export const auditLogInput = z
  .object({
    action: z.string().min(1).max(120),
    entityType: z.string().min(1).max(60).optional(),
    entityId: z.string().max(120).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// backupCreateInput: destPath is bounded by .max(2000) per T-07-06 to
// prevent DoS via long path strings. Renderer is sandboxed so the only
// realistic caller is the `dialog.showSaveDialog` path in Plan 07-05.
export const backupCreateInput = z.object({ destPath: z.string().min(1).max(2000) }).strict();

// backupRevealInput: payload for backup:reveal. No path traversal
// concerns (shell.showItemInFolder just highlights the file in the
// OS file manager; it doesn't read the contents).
export const backupRevealInput = z.object({ path: z.string().min(1).max(2000) }).strict();

// restorePreviewInput / restoreUnpackInput: zipPath + stagingDir are
// both userData-tree paths; no path-traversal concerns because the IPC
// callers pass canonical `restoreStagingDir(timestamp)` paths from main.
// Length cap is defense-in-depth against pathological renderer input.
export const restorePreviewInput = z
  .object({
    zipPath: z.string().min(1).max(2000),
    stagingDir: z.string().min(1).max(2000),
  })
  .strict();

export const restoreUnpackInput = z
  .object({
    zipPath: z.string().min(1).max(2000),
    stagingDir: z.string().min(1).max(2000),
  })
  .strict();

// Phase 7 / Plan 07-05 — D-11 verbatim: backup.pickDestination and
// restore.pickZip take NO payload (they wrap Electron's dialog
// pickers). The handlers return either an absolute path or null when
// the user cancels. The renderer calls them with no argument, which
// Electron's IPC layer delivers as `undefined`; the validator accepts
// either `undefined` or an empty object so a future renderer that
// passes `{}` explicitly still validates, while a stray non-object
// payload still fails the IPC_VALIDATION gate.
export const pickDestinationInput = z.union([z.object({}).strict(), z.undefined()]);
export const pickZipInput = z.union([z.object({}).strict(), z.undefined()]);

// Phase 7 / Plan 07-05 — restore.revealStaging: the renderer sends the
// staging directory (which the renderer itself composed as
// `data-restore-<timestamp>`). main resolves it to the userData-rooted
// absolute path via `restoreStagingDir(timestamp)`; the renderer's
// literal `data-restore-<timestamp>` string is forwarded for the
// shell.openPath call only (no zip-write paths feed from this).
export const restoreRevealStagingInput = z
  .object({
    stagingDir: z.string().min(1).max(2000),
  })
  .strict();

export type AuditLogInput = z.infer<typeof auditLogInput>;
export type BackupCreateInput = z.infer<typeof backupCreateInput>;
export type BackupRevealInput = z.infer<typeof backupRevealInput>;
export type RestorePreviewInput = z.infer<typeof restorePreviewInput>;
export type RestoreUnpackInput = z.infer<typeof restoreUnpackInput>;
export type PickDestinationInput = z.infer<typeof pickDestinationInput>;
export type PickZipInput = z.infer<typeof pickZipInput>;
export type RestoreRevealStagingInput = z.infer<typeof restoreRevealStagingInput>;

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`);
}