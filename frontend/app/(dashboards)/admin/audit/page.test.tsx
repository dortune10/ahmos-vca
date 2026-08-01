import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuditLogPage from './page';
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

describe('AuditLogPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and displays audit events on mount', async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: 'a1',
        tenantId: 't1',
        actorUserId: 'u1',
        entityType: 'facility',
        entityId: 'f1',
        action: 'created',
        eventTime: '2026-08-01T00:00:00.000Z',
        metadata: {},
      },
    ]);

    render(<AuditLogPage />);

    expect(await screen.findByText('facility:f1')).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith('/audit-events');
  });

  it('refetches with an entityType query param when the filter form is submitted', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: 'a2',
        tenantId: 't1',
        actorUserId: null,
        entityType: 'app_user',
        entityId: 'u2',
        action: 'created',
        eventTime: '2026-08-01T01:00:00.000Z',
        metadata: {},
      },
    ]);

    render(<AuditLogPage />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Entity type'), { target: { value: 'app_user' } });
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/audit-events?entityType=app_user'),
    );
    expect(await screen.findByText('app_user:u2')).toBeInTheDocument();
  });
});
