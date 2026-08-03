import { render, screen, waitFor } from '@testing-library/react';
import FrontlinePage from './page';
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

describe('FrontlinePage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina',
      email: 'amina@example.com',
    });
  });

  it('loads and renders the caseload for the current facility, showing names from the batch person lookup', async () => {
    mockFetchByPath({
      '/pregnancy-episodes': [
        {
          id: 'e1',
          personId: 'person-1234567890',
          facilityId: 'f1',
          lmpDate: null,
          estimatedDeliveryDate: '2026-12-01',
          gestationalAgeWeeks: 20,
          riskBand: 'low',
          status: 'Active',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      '/persons': [
        {
          id: 'person-1234567890',
          tenantId: 't1',
          firstName: 'Amara',
          lastName: 'Okafor',
          phonePrimary: null,
          dateOfBirth: null,
        },
      ],
    });

    render(<FrontlinePage />);

    expect(screen.getByText('Loading caseload...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Amara Okafor')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes?facilityId=f1');
    expect(mockedApiFetch).toHaveBeenCalledWith('/persons?ids=person-1234567890');
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  // The caseload used to render plain text cells, leaving no way to reach an episode at all —
  // and therefore no way to construct the encounter-note URL, which needs an episode id.
  it('links each caseload row to that episode\'s frontline view', async () => {
    mockFetchByPath({
      '/pregnancy-episodes': [
        {
          id: 'e1',
          personId: 'person-1234567890',
          facilityId: 'f1',
          lmpDate: null,
          estimatedDeliveryDate: '2026-12-01',
          gestationalAgeWeeks: 20,
          riskBand: 'low',
          status: 'Active',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      '/persons': [
        {
          id: 'person-1234567890',
          tenantId: 't1',
          firstName: 'Amara',
          lastName: 'Okafor',
          phonePrimary: null,
          dateOfBirth: null,
        },
      ],
    });

    render(<FrontlinePage />);

    const link = await screen.findByRole('link', { name: 'Amara Okafor' });
    expect(link).toHaveAttribute('href', '/frontline/episodes/e1');
  });

  it('still links the row when the person name has not resolved', async () => {
    mockFetchByPath({
      '/pregnancy-episodes': [
        {
          id: 'e9',
          personId: 'person-1234567890',
          facilityId: 'f1',
          lmpDate: null,
          estimatedDeliveryDate: null,
          gestationalAgeWeeks: null,
          riskBand: null,
          status: 'Active',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      '/persons': [],
    });

    render(<FrontlinePage />);

    const link = await screen.findByRole('link', { name: '#34567890' });
    expect(link).toHaveAttribute('href', '/frontline/episodes/e9');
  });

  it('falls back to a short reference when the person lookup has no match yet', async () => {
    mockFetchByPath({
      '/pregnancy-episodes': [
        {
          id: 'e1',
          personId: 'person-1234567890',
          facilityId: 'f1',
          lmpDate: null,
          estimatedDeliveryDate: '2026-12-01',
          gestationalAgeWeeks: 20,
          riskBand: 'low',
          status: 'Active',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      '/persons': [],
    });

    render(<FrontlinePage />);

    await waitFor(() => expect(screen.getByText('#34567890')).toBeInTheDocument());
  });

  it('skips the person-lookup call when the facility has no episodes', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);

    render(<FrontlinePage />);

    await waitFor(() => expect(screen.getByText('No episodes yet.')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
  });

  it('shows a message and never calls the API when the user has no facility assigned', async () => {
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'supervisor',
      facilityId: null,
      fullName: 'Sup',
      email: 'sup@example.com',
    });

    render(<FrontlinePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no facility assigned');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('shows an error message when the load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<FrontlinePage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
