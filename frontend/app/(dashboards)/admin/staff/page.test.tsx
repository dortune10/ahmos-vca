import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import StaffPage from './page';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function setupApiFetchMock(options: { staff?: any[]; facilities?: any[] }) {
  let currentStaff = options.staff ?? [];
  const facilities = options.facilities ?? [];
  mockedApiFetch.mockImplementation(((path: string, reqOptions?: any) => {
    if (path === '/facilities') {
      return Promise.resolve(facilities);
    }
    if (path === '/users' && reqOptions?.method === 'POST') {
      const created = { id: 'new-user', ...reqOptions.body };
      currentStaff = [...currentStaff, created];
      return Promise.resolve(created);
    }
    if (path === '/users') {
      return Promise.resolve(currentStaff);
    }
    return Promise.resolve(undefined);
  }) as typeof apiFetch);
}

describe('StaffPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('lists staff with resolved facility names', async () => {
    setupApiFetchMock({
      staff: [
        {
          id: 'u1',
          tenantId: 't1',
          email: 'nurse@example.com',
          role: 'nurse',
          facilityId: 'f1',
          fullName: 'Nurse Joy',
        },
      ],
      facilities: [{ id: 'f1', name: 'Test Clinic' }],
    });

    render(<StaffPage />);

    expect(await screen.findByText('Nurse Joy')).toBeInTheDocument();
    // 'Test Clinic' legitimately appears twice on this page: once as the resolved
    // facility name in the staff table, and once as an <option> in the create-staff
    // form's facility dropdown. Scope the assertion to the table to disambiguate.
    expect(within(screen.getByRole('table')).getByText('Test Clinic')).toBeInTheDocument();
  });

  it('submits the create-staff form with the selected role and facility, then reloads', async () => {
    setupApiFetchMock({ staff: [], facilities: [{ id: 'f1', name: 'Test Clinic' }] });

    render(<StaffPage />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/facilities'));

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Nurse Joy' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nurse@example.com' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'temp-password-123' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'f1' } });
    fireEvent.click(screen.getByRole('button', { name: /create staff account/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/users', {
        method: 'POST',
        body: {
          email: 'nurse@example.com',
          password: 'temp-password-123',
          role: 'nurse',
          facilityId: 'f1',
          fullName: 'Nurse Joy',
        },
      }),
    );
    expect(await screen.findByText('Nurse Joy')).toBeInTheDocument();
  });
});
