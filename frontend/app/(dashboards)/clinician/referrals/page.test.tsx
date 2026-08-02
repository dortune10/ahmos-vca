import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ClinicianReferralsPage from './page';
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

const INCOMING_REFERRAL = {
  id: 'r1',
  pregnancyEpisodeId: 'e1',
  fromFacilityId: 'f2',
  toFacilityId: 'f1',
  reasonCode: 'Suspected preeclampsia',
  urgency: 'urgent',
  status: 'Sent',
  createdAt: '2026-08-01T00:00:00.000Z',
  acceptedAt: null,
  departedAt: null,
  arrivedAt: null,
  closedAt: null,
};

const OUTGOING_REFERRAL = {
  id: 'r2',
  pregnancyEpisodeId: 'e2',
  fromFacilityId: 'f1',
  toFacilityId: 'f3',
  reasonCode: 'Routine specialist review',
  urgency: 'routine',
  status: 'Accepted',
  createdAt: '2026-08-01T00:00:00.000Z',
  acceptedAt: '2026-08-02T00:00:00.000Z',
  departedAt: null,
  arrivedAt: null,
  closedAt: null,
};

function mockFetchByDirection(incoming: unknown[], outgoing: unknown[]) {
  mockedApiFetch.mockImplementation((path: string) => {
    if (path.includes('direction=incoming')) return Promise.resolve(incoming);
    if (path.includes('direction=outgoing')) return Promise.resolve(outgoing);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('ClinicianReferralsPage', () => {
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

  it('loads incoming and outgoing referrals and only offers transition buttons on incoming rows', async () => {
    mockFetchByDirection([INCOMING_REFERRAL], [OUTGOING_REFERRAL]);

    render(<ClinicianReferralsPage />);

    await waitFor(() => expect(screen.getByText('Suspected preeclampsia')).toBeInTheDocument());

    // 'Sent' -> valid next statuses are Accepted, Cancelled per the backend state machine.
    expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();

    const outgoingRow = screen.getByText('Routine specialist review').closest('tr')!;
    expect(within(outgoingRow).queryByRole('button')).not.toBeInTheDocument();

    expect(mockedApiFetch).toHaveBeenCalledWith('/referrals?facilityId=f1&direction=incoming');
    expect(mockedApiFetch).toHaveBeenCalledWith('/referrals?facilityId=f1&direction=outgoing');
  });

  it('transitions an incoming referral to the next status and updates its row', async () => {
    mockFetchByDirection([INCOMING_REFERRAL], []);

    render(<ClinicianReferralsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument());

    mockedApiFetch.mockResolvedValueOnce({
      ...INCOMING_REFERRAL,
      status: 'Accepted',
      acceptedAt: '2026-08-02T00:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accepted' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/referrals/r1/status', {
        method: 'PATCH',
        body: { status: 'Accepted' },
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dispatched' })).toBeInTheDocument());
  });

  it('shows an error when a transition is rejected by the backend', async () => {
    mockFetchByDirection([INCOMING_REFERRAL], []);

    render(<ClinicianReferralsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument());

    class ReferralApiError extends Error {
      code = 'REFERRAL_INVALID_STATE';
      details: unknown[] = [];
      correlationId = 'corr-2';
    }
    mockedApiFetch.mockRejectedValueOnce(
      new ReferralApiError('Referral cannot transition from Sent to Accepted'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accepted' }));

    expect(
      await screen.findByText('Referral cannot transition from Sent to Accepted'),
    ).toBeInTheDocument();
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

    render(<ClinicianReferralsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no facility assigned');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
