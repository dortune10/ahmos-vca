import { render, screen, waitFor } from '@testing-library/react';
import FrontlineEpisodeDetailPage from './page';
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
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'e1' }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

const SAMPLE_EPISODE = {
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
};

const SAMPLE_PERSON = {
  id: 'person-1234567890',
  tenantId: 't1',
  firstName: 'Amara',
  lastName: 'Okafor',
  phonePrimary: null,
  dateOfBirth: null,
};

const SAMPLE_NOTE = {
  id: 'n1',
  pregnancyEpisodeId: 'e1',
  recordedBy: 'u1',
  recordedAt: '2026-08-02T09:00:00.000Z',
  noteText: 'Reports mild swelling in ankles.',
  vitals: { bpSystolic: 128, bpDiastolic: 84, temperatureC: null, hemoglobinGdl: null },
  createdAt: '2026-08-02T09:00:00.000Z',
};

function mockFetchByPath(map: Record<string, unknown>) {
  const entries = Object.entries({
    '/pregnancy-episodes/e1/encounter-notes': [],
    '/persons': [SAMPLE_PERSON],
    ...map,
    // Longest key first so `.../e1/encounter-notes` wins over its `.../e1` prefix.
  }).sort(([a], [b]) => b.length - a.length);

  mockedApiFetch.mockImplementation((path: string) => {
    for (const [key, value] of entries) {
      if (path.startsWith(key)) {
        return Promise.resolve(value);
      }
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function setUser(role: string) {
  mockedUseCurrentUser.mockReturnValue({
    id: 'u1',
    tenantId: 't1',
    role,
    facilityId: 'f1',
    fullName: role === 'nurse' ? 'Nurse Wanjiku' : 'Amina',
    email: 'user@example.com',
  });
}

describe('FrontlineEpisodeDetailPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    setUser('chw');
  });

  it('loads the episode overview and resolves the person name for the header', async () => {
    mockFetchByPath({ '/pregnancy-episodes/e1': SAMPLE_EPISODE });

    render(<FrontlineEpisodeDetailPage />);

    expect(screen.getByText('Loading episode...')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Amara Okafor' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('2026-12-01')).toBeInTheDocument();
  });

  it('falls back to the short person reference when the name lookup fails', async () => {
    mockedApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/pregnancy-episodes/e1/encounter-notes')) return Promise.resolve([]);
      if (path.startsWith('/pregnancy-episodes/e1')) return Promise.resolve(SAMPLE_EPISODE);
      if (path.startsWith('/persons')) return Promise.reject(new Error('person lookup down'));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<FrontlineEpisodeDetailPage />);

    expect(await screen.findByRole('heading', { name: '#34567890' })).toBeInTheDocument();
    // The episode itself loaded, so a failed name lookup must not blank the page.
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  // Bug 2: the encounter-note page existed but its URL could not be constructed from anywhere.
  // Caseload row (click 1) -> here -> this link (click 2) is the two-click path.
  it('links to the encounter-note form for this episode', async () => {
    mockFetchByPath({ '/pregnancy-episodes/e1': SAMPLE_EPISODE });

    render(<FrontlineEpisodeDetailPage />);

    const link = await screen.findByRole('link', { name: 'Record encounter note' });
    expect(link).toHaveAttribute('href', '/frontline/episodes/e1/encounter-note');
  });

  it('links back to the caseload', async () => {
    mockFetchByPath({ '/pregnancy-episodes/e1': SAMPLE_EPISODE });

    render(<FrontlineEpisodeDetailPage />);

    expect(await screen.findByRole('link', { name: 'Back to caseload' })).toHaveAttribute(
      'href',
      '/frontline',
    );
  });

  // Bug 3, frontline side: notes were write-only for every role.
  it('reads recorded encounter notes back for a CHW', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/pregnancy-episodes/e1/encounter-notes': [SAMPLE_NOTE],
    });

    render(<FrontlineEpisodeDetailPage />);

    expect(await screen.findByText('Reports mild swelling in ankles.')).toBeInTheDocument();
    expect(screen.getByText(/BP systolic 128 mmHg · BP diastolic 84 mmHg/)).toBeInTheDocument();
  });

  it('shows an empty state when the episode has no notes yet', async () => {
    mockFetchByPath({ '/pregnancy-episodes/e1': SAMPLE_EPISODE });

    render(<FrontlineEpisodeDetailPage />);

    expect(await screen.findByText('No encounter notes recorded yet.')).toBeInTheDocument();
  });

  // Bug 4: referral creation is a clinician/nurse action, but the only form lived under
  // /clinician, which resolveRedirectForRole bounces nurses away from.
  it('offers referral creation to a nurse', async () => {
    setUser('nurse');
    mockFetchByPath({
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': [
        {
          id: 'f2',
          tenantId: 't1',
          name: 'District Referral Hospital',
          type: 'hospital',
          contactPhone: null,
          acceptingReferrals: true,
        },
      ],
    });

    render(<FrontlineEpisodeDetailPage />);

    expect(await screen.findByRole('button', { name: 'Create referral' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );
  });

  // Role separation: widening this to CHWs is exactly what the fix must not do.
  it('does not offer referral creation to a CHW', async () => {
    setUser('chw');
    mockFetchByPath({ '/pregnancy-episodes/e1': SAMPLE_EPISODE });

    render(<FrontlineEpisodeDetailPage />);

    await screen.findByText('Overview');
    expect(screen.queryByText('Create Referral')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create referral' })).not.toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/facilities'),
    );
  });

  it('offers a WhatsApp enrolment code for the person on this episode', async () => {
    setUser('chw');
    mockFetchByPath({ '/pregnancy-episodes/e1': SAMPLE_EPISODE });

    render(<FrontlineEpisodeDetailPage />);

    await waitFor(() => expect(screen.getByText('WhatsApp enrolment code')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Issue enrolment code' })).toBeInTheDocument();
  });

  it('shows an error when the episode fails to load', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<FrontlineEpisodeDetailPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
