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

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`);
}