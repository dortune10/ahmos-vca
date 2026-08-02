import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClinicianEpisodeDetailPage from './page';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'e1' }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const SAMPLE_EPISODE = {
  id: 'e1',
  personId: 'p1',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-12-01',
  gestationalAgeWeeks: 20,
  riskBand: 'high',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const SAMPLE_RISK_ASSESSMENT = {
  id: 'ra1',
  pregnancyEpisodeId: 'e1',
  assessmentTime: '2026-08-01T00:00:00.000Z',
  ruleScore: 2,
  mlScore: 2,
  finalRiskBand: 'high',
  explanation: {
    ruleFactors: [
      { factor: 'bloodPressure', band: 'high', detail: 'severe hypertension: systolic 165 mmHg (>=160)' },
    ],
    mlReasoning: 'Elevated BP consistent with preeclampsia risk.',
  },
  overriddenBy: null,
  overrideReason: null,
  status: 'Computed',
  createdAt: '2026-08-01T00:00:00.000Z',
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

describe('ClinicianEpisodeDetailPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and renders the episode overview and latest risk assessment with the provisional-thresholds caveat shown prominently', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);

    expect(screen.getByText('Loading episode...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());

    expect(
      screen.getByText(/provisional and have not received clinical sign-off/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/severe hypertension/)).toBeInTheDocument();
    expect(screen.getByText(/Elevated BP consistent with preeclampsia risk\./)).toBeInTheDocument();
  });

  it('shows a placeholder when no risk assessment exists yet', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('No risk assessment yet for this episode.')).toBeInTheDocument(),
    );
  });

  it('submits the encounter note with noteText and all four vitals fields, with no role branching', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByLabelText('Note')).toBeInTheDocument());

    expect(screen.getByLabelText('BP systolic')).toBeInTheDocument();
    expect(screen.getByLabelText('BP diastolic')).toBeInTheDocument();
    expect(screen.getByLabelText('Temperature (C)')).toBeInTheDocument();
    expect(screen.getByLabelText('Hemoglobin (g/dL)')).toBeInTheDocument();

    mockedApiFetch.mockResolvedValueOnce({ id: 'note-1' });

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'BP elevated on exam.' } });
    fireEvent.change(screen.getByLabelText('BP systolic'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('BP diastolic'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('Temperature (C)'), { target: { value: '37.0' } });
    fireEvent.change(screen.getByLabelText('Hemoglobin (g/dL)'), { target: { value: '11.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(screen.getByText('Encounter note saved.')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: {
        noteText: 'BP elevated on exam.',
        vitals: { bpSystolic: 150, bpDiastolic: 95, temperatureC: 37, hemoglobinGdl: 11 },
      },
    });
  });

  it('shows an error message when the episode load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
