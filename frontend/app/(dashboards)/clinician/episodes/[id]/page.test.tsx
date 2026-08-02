import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClinicianEpisodeDetailPage from './page';
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

const CLOSED_EPISODE = { ...SAMPLE_EPISODE, status: 'Closed' };

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

const SAMPLE_FACILITIES = [
  { id: 'f2', tenantId: 't1', name: 'District Referral Hospital', type: 'hospital', contactPhone: null, acceptingReferrals: true },
];

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
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: 'f1',
      fullName: 'Dr. Njoroge',
      email: 'njoroge@example.com',
    });
  });

  it('loads and renders the episode overview and latest risk assessment with the provisional-thresholds caveat shown prominently', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
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
      '/facilities': SAMPLE_FACILITIES,
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
      '/facilities': SAMPLE_FACILITIES,
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

  it('requires an override reason before calling the API', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Override risk band'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    expect(await screen.findByText(/Override reason is required/)).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/override'),
      expect.anything(),
    );
  });

  it('submits a valid override and shows the updated band, status, and reason', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override risk band'));

    mockedApiFetch.mockResolvedValueOnce({
      ...SAMPLE_RISK_ASSESSMENT,
      finalRiskBand: 'medium',
      status: 'Overridden',
      overriddenBy: 'u1',
      overrideReason: 'Clinical exam does not support high risk.',
    });

    fireEvent.change(screen.getByLabelText('New risk band'), { target: { value: 'medium' } });
    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Clinical exam does not support high risk.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/risk-assessments/ra1/override', {
        method: 'PATCH',
        body: { finalRiskBand: 'medium', overrideReason: 'Clinical exam does not support high risk.' },
      }),
    );
    expect(
      await screen.findByText('Overridden. Reason: Clinical exam does not support high risk.'),
    ).toBeInTheDocument();
  });

  it('surfaces an error returned by the backend override call', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override risk band'));

    class OverrideApiError extends Error {
      code = 'BAD_REQUEST';
      details: unknown[] = [];
      correlationId = 'corr-1';
    }
    mockedApiFetch.mockRejectedValueOnce(
      new OverrideApiError('overrideReason must be longer than or equal to 3 characters'),
    );

    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Valid length reason passing client-side validation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    expect(
      await screen.findByText('overrideReason must be longer than or equal to 3 characters'),
    ).toBeInTheDocument();
  });

  it('shows the referral form with facilities loaded from the accepting-referrals list when the episode is Active', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );
    expect(mockedApiFetch).toHaveBeenCalledWith('/facilities?acceptingReferrals=true');
  });

  it('hides the referral form and explains why when the episode is not eligible (e.g. Closed)', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': CLOSED_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(
        screen.getByText('Referral creation is not available while this episode is Closed.'),
      ).toBeInTheDocument(),
    );
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/facilities'),
      expect.anything(),
    );
  });

  it('creates a referral with the clinician facility as fromFacilityId and shows the created status', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    mockedApiFetch.mockResolvedValueOnce({
      id: 'ref1',
      pregnancyEpisodeId: 'e1',
      fromFacilityId: 'f1',
      toFacilityId: 'f2',
      reasonCode: 'Suspected preeclampsia',
      urgency: 'urgent',
      status: 'Created',
      createdAt: '2026-08-01T00:00:00.000Z',
      acceptedAt: null,
      departedAt: null,
      arrivedAt: null,
      closedAt: null,
    });

    fireEvent.change(screen.getByLabelText('Receiving facility'), { target: { value: 'f2' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Suspected preeclampsia' } });
    fireEvent.change(screen.getByLabelText('Urgency'), { target: { value: 'urgent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/referrals', {
        method: 'POST',
        body: {
          pregnancyEpisodeId: 'e1',
          toFacilityId: 'f2',
          fromFacilityId: 'f1',
          reasonCode: 'Suspected preeclampsia',
          urgency: 'urgent',
        },
      }),
    );
    expect(await screen.findByText('Referral created (status: Created).')).toBeInTheDocument();
  });

  it('requires a receiving facility and a reason before calling the API', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    expect(await screen.findByText('Select a receiving facility.')).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith('/referrals', expect.anything());
  });
});
