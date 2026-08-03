import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReferralCreateForm } from './referral-create-form';
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

const FACILITIES = [
  {
    id: 'f2',
    tenantId: 't1',
    name: 'District Referral Hospital',
    type: 'hospital',
    contactPhone: null,
    acceptingReferrals: true,
  },
];

describe('ReferralCreateForm', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Wanjiku',
      email: 'wanjiku@example.com',
    });
  });

  it('loads only facilities that are accepting referrals', async () => {
    mockedApiFetch.mockResolvedValue(FACILITIES);

    render(<ReferralCreateForm episodeId="e1" episodeStatus="Active" />);

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );
    expect(mockedApiFetch).toHaveBeenCalledWith('/facilities?acceptingReferrals=true');
  });

  it('creates a referral carrying the acting user\'s facility as fromFacilityId', async () => {
    mockedApiFetch.mockResolvedValue(FACILITIES);

    render(<ReferralCreateForm episodeId="e1" episodeStatus="Active" />);
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
    });

    fireEvent.change(screen.getByLabelText('Receiving facility'), { target: { value: 'f2' } });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Suspected preeclampsia' },
    });
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

  it('requires a receiving facility before calling the API', async () => {
    mockedApiFetch.mockResolvedValue(FACILITIES);

    render(<ReferralCreateForm episodeId="e1" episodeStatus="Active" />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    expect(await screen.findByText('Select a receiving facility.')).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith('/referrals', expect.anything());
  });

  it('requires a reason before calling the API', async () => {
    mockedApiFetch.mockResolvedValue(FACILITIES);

    render(<ReferralCreateForm episodeId="e1" episodeStatus="Active" />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('Receiving facility'), { target: { value: 'f2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    expect(await screen.findByText('A reason is required.')).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith('/referrals', expect.anything());
  });

  it('explains why the form is unavailable for an ineligible episode and skips the facility load', () => {
    render(<ReferralCreateForm episodeId="e1" episodeStatus="Closed" />);

    expect(
      screen.getByText('Referral creation is not available while this episode is Closed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create referral' })).not.toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('surfaces a backend error from the create call', async () => {
    mockedApiFetch.mockResolvedValue(FACILITIES);

    render(<ReferralCreateForm episodeId="e1" episodeStatus="Active" />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    mockedApiFetch.mockRejectedValueOnce(new Error('receiving facility is not accepting referrals'));

    fireEvent.change(screen.getByLabelText('Receiving facility'), { target: { value: 'f2' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Obstructed labour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    expect(
      await screen.findByText('receiving facility is not accepting referrals'),
    ).toBeInTheDocument();
  });
});
