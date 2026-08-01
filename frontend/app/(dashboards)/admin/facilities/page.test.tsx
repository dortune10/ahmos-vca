import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FacilitiesPage from './page';
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

describe('FacilitiesPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('lists facilities returned by GET /facilities', async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: 'f1',
        tenantId: 't1',
        name: 'Test Clinic',
        type: 'clinic',
        contactPhone: '+254700000000',
        acceptingReferrals: false,
      },
    ]);

    render(<FacilitiesPage />);

    expect(await screen.findByText('Test Clinic')).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith('/facilities');
  });

  it('submits the create-facility form and reloads the list', async () => {
    mockedApiFetch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: 'f2',
        tenantId: 't1',
        name: 'New Facility',
        type: 'clinic',
        contactPhone: null,
        acceptingReferrals: false,
      })
      .mockResolvedValueOnce([
        {
          id: 'f2',
          tenantId: 't1',
          name: 'New Facility',
          type: 'clinic',
          contactPhone: null,
          acceptingReferrals: false,
        },
      ]);

    render(<FacilitiesPage />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Facility' } });
    fireEvent.click(screen.getByRole('button', { name: /create facility/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/facilities', {
        method: 'POST',
        body: { name: 'New Facility', type: 'clinic', contactPhone: undefined },
      }),
    );
    expect(await screen.findByText('New Facility')).toBeInTheDocument();
  });

  it('toggles acceptingReferrals via PATCH when the button is clicked', async () => {
    mockedApiFetch
      .mockResolvedValueOnce([
        {
          id: 'f1',
          tenantId: 't1',
          name: 'Test Clinic',
          type: 'clinic',
          contactPhone: null,
          acceptingReferrals: false,
        },
      ])
      .mockResolvedValueOnce({
        id: 'f1',
        tenantId: 't1',
        name: 'Test Clinic',
        type: 'clinic',
        contactPhone: null,
        acceptingReferrals: true,
      })
      .mockResolvedValueOnce([
        {
          id: 'f1',
          tenantId: 't1',
          name: 'Test Clinic',
          type: 'clinic',
          contactPhone: null,
          acceptingReferrals: true,
        },
      ]);

    render(<FacilitiesPage />);
    await screen.findByText('Test Clinic');

    fireEvent.click(screen.getByRole('button', { name: /start accepting/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/facilities/f1', {
        method: 'PATCH',
        body: { acceptingReferrals: true },
      }),
    );
    expect(await screen.findByRole('button', { name: /stop accepting/i })).toBeInTheDocument();
  });
});
