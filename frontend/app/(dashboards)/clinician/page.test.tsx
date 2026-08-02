import { render, screen, waitFor } from '@testing-library/react';
import ClinicianTriageBoardPage from './page';
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

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

const HIGH_RISK_EPISODE = {
  id: 'e-high',
  personId: 'person-high-0001',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-09-01',
  gestationalAgeWeeks: 30,
  riskBand: 'high',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const LOW_RISK_EPISODE = {
  id: 'e-low',
  personId: 'person-low-00002',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-08-15',
  gestationalAgeWeeks: 25,
  riskBand: 'low',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function mockFetchByPath(map: Record<string, unknown>) {
  mockedApiFetch.mockImplementation((path: string) => {
    for (const key of Object.keys(map)) {
      if (path.startsWith(key)) {
        return Promise.resolve(map[key]);
      }
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('ClinicianTriageBoardPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: 'f1',
      fullName: 'Dr. Njoroge',
      email: 'njoroge@example.com',
    });
  });

  it('lists episodes sorted high-risk first and shows names from the batch person lookup', async () => {
    mockFetchByPath({
      '/pregnancy-episodes': [LOW_RISK_EPISODE, HIGH_RISK_EPISODE],
      '/persons': [
        { id: 'person-high-0001', tenantId: 't1', firstName: 'Amina', lastName: 'Njeri', phonePrimary: null, dateOfBirth: null },
        { id: 'person-low-00002', tenantId: 't1', firstName: 'Beatrice', lastName: 'Wanjiru', phonePrimary: null, dateOfBirth: null },
      ],
    });

    render(<ClinicianTriageBoardPage />);

    expect(screen.getByText('Loading triage board...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Amina Njeri')).toBeInTheDocument());

    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(rows[0]).toHaveTextContent('Amina Njeri');
    expect(rows[0]).toHaveTextContent('high');
    expect(rows[1]).toHaveTextContent('Beatrice Wanjiru');
    expect(rows[1]).toHaveTextContent('low');

    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes?facilityId=f1');
    expect(mockedApiFetch).toHaveBeenCalledWith('/persons?ids=person-low-00002,person-high-0001');
  });

  it('skips the person-lookup call when the facility has no active episodes', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);

    render(<ClinicianTriageBoardPage />);

    await waitFor(() =>
      expect(screen.getByText('No active episodes at this facility.')).toBeInTheDocument(),
    );
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
  });

  it('shows a message and never calls the API when the user has no facility assigned', async () => {
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: null,
      fullName: 'Dr. No Facility',
      email: 'nf@example.com',
    });

    render(<ClinicianTriageBoardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no facility assigned');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('shows an error message when the episode load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<ClinicianTriageBoardPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
