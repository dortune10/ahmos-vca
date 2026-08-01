import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskListPage from './page';
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

const SAMPLE_TASK = {
  id: 't1',
  pregnancyEpisodeId: 'e1',
  taskType: 'anc_visit',
  assignedUserId: 'u1',
  dueAt: '2026-08-15T00:00:00.000Z',
  completedAt: null,
  status: 'Scheduled',
  priority: 'routine',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('TaskListPage', () => {
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

  it('loads and renders the tasks assigned to the current user', async () => {
    mockedApiFetch.mockResolvedValueOnce([SAMPLE_TASK]);

    render(<TaskListPage />);

    expect(screen.getByText('Loading tasks...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('anc_visit')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/tasks?assignedUserId=u1');
  });

  it('marks a task complete and reloads the list', async () => {
    mockedApiFetch
      .mockResolvedValueOnce([SAMPLE_TASK])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ ...SAMPLE_TASK, status: 'Completed', completedAt: '2026-08-02T00:00:00.000Z' }]);

    render(<TaskListPage />);
    await waitFor(() => expect(screen.getByText('anc_visit')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(3));
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/tasks/t1/complete', { method: 'POST' });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(3, '/tasks?assignedUserId=u1');
  });

  it('shows a message when there are no tasks', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);

    render(<TaskListPage />);

    await waitFor(() => expect(screen.getByText('No tasks assigned.')).toBeInTheDocument());
  });
});
