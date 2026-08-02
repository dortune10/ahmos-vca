import { render, screen, waitFor } from '@testing-library/react';
import SupervisorPage from './page';
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

describe('SupervisorPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and renders the KPI summary', async () => {
    mockedApiFetch.mockResolvedValue({
      registeredPregnancies: 12,
      ancTaskCompletionRate: 0.75,
      highRiskCaseCount: 9,
      riskBandDistribution: { low: 5, medium: 3, high: 1 },
      referralSlaBreaches: 6,
      referralOutcomeBreakdown: { completed: 8, failed: 2, cancelled: 4 },
    });

    render(<SupervisorPage />);

    expect(screen.getByText('Loading KPI summary...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/reports/kpi-summary');
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/^5 \(/)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows an error message when the load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<SupervisorPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
