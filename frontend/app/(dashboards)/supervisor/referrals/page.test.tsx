import { render, screen, waitFor } from '@testing-library/react';
import SupervisorReferralsPage from './page';
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

describe('SupervisorReferralsPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and renders breaching referrals with computed hours open', async () => {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    mockedApiFetch.mockResolvedValue([
      {
        id: 'r1',
        pregnancyEpisodeId: 'episode-1234567890',
        fromFacilityId: null,
        toFacilityId: 'f1',
        reasonCode: 'high_risk_pregnancy',
        urgency: 'urgent',
        status: 'Sent',
        createdAt: fortyEightHoursAgo,
        acceptedAt: null,
        departedAt: null,
        arrivedAt: null,
        closedAt: null,
      },
    ]);

    render(<SupervisorReferralsPage />);

    expect(screen.getByText('Loading SLA breaches...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('#34567890')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/reports/sla-breaches');
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no breaches', async () => {
    mockedApiFetch.mockResolvedValue([]);

    render(<SupervisorReferralsPage />);

    await waitFor(() => expect(screen.getByText('No SLA breaches right now.')).toBeInTheDocument());
  });

  it('shows an error message when the load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<SupervisorReferralsPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
