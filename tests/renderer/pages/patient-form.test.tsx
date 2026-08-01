// @vitest-environment happy-dom
// Plan 02-03 Task 3 — PatientForm tests.
// Per PAT-01 (create) + PAT-03 (edit) + Fix 6: IPC_VALIDATION { field: 'mrn' }
// renders the inline "MRN already in use" error.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { initialRoute, setRoute } from '@/lib/router';
import { session } from '@/store/session';
import PatientForm from '@/pages/PatientForm';
import { IpcErrorException } from '@shared/errors';
import type { Patient } from '@shared/ipc-contract';

const existingPatient: Patient = {
  id: '00000000-0000-4000-8000-000000000010',
  fullName: 'Alice Carter',
  dob: '1980-04-12',
  gender: 'female',
  mrn: 'MRN-001',
  phone: '555-0001',
  notes: 'initial notes',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

function setAdminSession(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: '00000000-0000-4000-8000-000000000099',
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([
    {
      id: '00000000-0000-4000-8000-000000000099',
      fullName: 'Dr. Layla',
      isFirstAdmin: true,
      lastLoginAt: Date.now(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  ]);
}

beforeEach(() => {
  setRoute(initialRoute);
  setAdminSession();
  void session.refresh();
});

describe('PatientForm (create mode)', () => {
  it('submits valid fields and calls patients.create once', async () => {
    const api = getApi();
    api.patients.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000777',
      fullName: 'Carol Diaz',
      dob: '1990-01-15',
      gender: 'female',
      mrn: 'MRN-999',
      phone: '555-9999',
      notes: 'new',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    });
    const user = userEvent.setup();
    render(<PatientForm mode="create" />);
    await user.type(screen.getByLabelText(/full name/i), 'Carol Diaz');
    await user.type(screen.getByLabelText(/date of birth/i), '1990-01-15');
    await user.type(screen.getByLabelText(/^mrn$/i), 'MRN-999');
    await user.type(screen.getByLabelText(/^phone$/i), '555-9999');
    await user.type(screen.getByLabelText(/^notes$/i), 'new');
    await user.click(screen.getByRole('button', { name: /create patient/i }));
    await waitFor(() => expect(api.patients.create).toHaveBeenCalledTimes(1));
    expect(api.patients.create).toHaveBeenCalledWith({
      fullName: 'Carol Diaz',
      dob: '1990-01-15',
      gender: null,
      mrn: 'MRN-999',
      phone: '555-9999',
      notes: 'new',
    });
  });

  it('renders inline "MRN already in use" on IPC_VALIDATION { field: "mrn" }', async () => {
    const api = getApi();
    api.patients.create.mockRejectedValue(
      new IpcErrorException({
        code: 'IPC_VALIDATION',
        message: 'Duplicate MRN',
        field: 'mrn',
      }),
    );
    const user = userEvent.setup();
    render(<PatientForm mode="create" />);
    await user.type(screen.getByLabelText(/full name/i), 'Carol Diaz');
    await user.type(screen.getByLabelText(/date of birth/i), '1990-01-15');
    await user.type(screen.getByLabelText(/^mrn$/i), 'MRN-001');
    await user.click(screen.getByRole('button', { name: /create patient/i }));
    expect(await screen.findByText(/mrn already in use/i)).toBeInTheDocument();
  });
});

describe('PatientForm (edit mode)', () => {
  it('loads the existing patient via patients.get and submits a patch via patients.update', async () => {
    const api = getApi();
    api.patients.get.mockResolvedValue(existingPatient);
    api.patients.update.mockResolvedValue({ ...existingPatient, fullName: 'Alice C.' });
    const user = userEvent.setup();
    render(<PatientForm mode="edit" patientId={existingPatient.id} />);
    // wait for the form to load
    const fullNameInput = await screen.findByLabelText(/full name/i);
    await waitFor(() => expect(fullNameInput).toHaveValue('Alice Carter'));
    await user.clear(fullNameInput);
    await user.type(fullNameInput, 'Alice C.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.patients.update).toHaveBeenCalledTimes(1));
    const [idArg, patchArg] = api.patients.update.mock.calls[0] ?? [];
    expect(idArg).toBe(existingPatient.id);
    expect(patchArg).toMatchObject({ fullName: 'Alice C.' });
  });

  it('shows inline validation when DOB is empty (zod regex rejects it on submit)', async () => {
    const api = getApi();
    api.patients.get.mockResolvedValue(existingPatient);
    const user = userEvent.setup();
    render(<PatientForm mode="edit" patientId={existingPatient.id} />);
    const dob = await screen.findByLabelText(/date of birth/i);
    await user.clear(dob);
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.getByLabelText(/date of birth/i)).toHaveAttribute('aria-invalid', 'true'));
    expect(api.patients.update).not.toHaveBeenCalled();
  });
});
