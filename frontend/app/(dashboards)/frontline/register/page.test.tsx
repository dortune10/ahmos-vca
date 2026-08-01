import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

describe('RegisterPage as CHW', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina CHW',
      email: 'amina@example.com',
    });
  });

  it('shows only the minimal field set and no last name/DOB/LMP fields', () => {
    render(<RegisterPage />);

    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last menstrual period date')).not.toBeInTheDocument();
  });

  it('creates a person then an episode against the CHW own facilityId, and navigates to the caseload', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ id: 'p1', tenantId: 't1', firstName: 'Zawadi', lastName: null, phonePrimary: '+254700000001', dateOfBirth: null })
      .mockResolvedValueOnce({ id: 'e1', personId: 'p1', facilityId: 'f1', status: 'Active' });

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Zawadi' } });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+254700000001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/frontline'));

    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/persons', {
      method: 'POST',
      body: { firstName: 'Zawadi', phonePrimary: '+254700000001' },
    });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/pregnancy-episodes', {
      method: 'POST',
      body: { personId: 'p1', facilityId: 'f1' },
    });
  });
});

describe('RegisterPage as Nurse', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u2',
      tenantId: 't1',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Joy',
      email: 'joy@example.com',
    });
  });

  it('shows the full field set including last name, date of birth, and LMP date', () => {
    render(<RegisterPage />);

    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.getByLabelText('Last menstrual period date')).toBeInTheDocument();
  });

  it('includes lastName, dateOfBirth, and lmpDate in the two API calls', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ id: 'p2', tenantId: 't1', firstName: 'Zawadi', lastName: 'Mrema', phonePrimary: '+254700000002', dateOfBirth: '1998-01-01' })
      .mockResolvedValueOnce({ id: 'e2', personId: 'p2', facilityId: 'f1', status: 'Active' });

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Zawadi' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Mrema' } });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+254700000002' },
    });
    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '1998-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Last menstrual period date'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(2));

    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/persons', {
      method: 'POST',
      body: {
        firstName: 'Zawadi',
        lastName: 'Mrema',
        phonePrimary: '+254700000002',
        dateOfBirth: '1998-01-01',
      },
    });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/pregnancy-episodes', {
      method: 'POST',
      body: { personId: 'p2', facilityId: 'f1', lmpDate: '2026-06-01' },
    });
  });
});
