// zod schemas for IPC input validation. Renderer + main both parse from these.
// Per Fix 5 + AUTH-02/03/04 + D-01/02/03 + AUDIT-01.

import { z } from 'zod';

export const wizardInput = z.object({
  fullName: z.string().min(1).max(120),
  clinicName: z.string().min(1).max(120),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  confirmPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
}).refine((d) => d.pin === d.confirmPin, { message: 'PIN and confirmation must match', path: ['confirmPin'] });

export const pinInput = z.object({
  userId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export const userInput = z.object({
  fullName: z.string().min(1).max(120),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
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

export const recordingStartInput = z.object({
  patientId: z.string().uuid(),
  deviceId: z.string().min(1).max(500),
  preset: qualityPresetSchema,
});

export type ProceduresCreateInput = z.infer<typeof proceduresCreateInput>;
export type ProceduresGetInput = z.infer<typeof proceduresGetInput>;
export type ProceduresListQueryInput = z.infer<typeof proceduresListQueryInput>;
export type ProceduresFinalizeInput = z.infer<typeof proceduresFinalizeInput>;
export type ProcedureNoteCreateInput = z.infer<typeof procedureNoteCreateInput>;
export type ProcedureNoteListInput = z.infer<typeof procedureNoteListInput>;
export type RecordingStartInput = z.infer<typeof recordingStartInput>;

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`);
}