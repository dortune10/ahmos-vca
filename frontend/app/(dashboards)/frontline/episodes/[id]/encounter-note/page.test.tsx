import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EncounterNotePage from './page';
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
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: 'e1' }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

describe('EncounterNotePage as CHW', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina',
      email: 'amina@example.com',
    });
  });

  it('shows only the note field, no vitals fields', () => {
    render(<EncounterNotePage />);

    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(screen.queryByLabelText('BP systolic')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hemoglobin (g/dL)')).not.toBeInTheDocument();
  });

  it('submits noteText only, with no vitals key, to the episode from the URL', async () => {
    mockedApiFetch.mockResolvedValueOnce({ id: 'note-1' });

    render(<EncounterNotePage />);
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Mother reports feeling well.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/frontline'));
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: { noteText: 'Mother reports feeling well.' },
    });
  });
});

describe('EncounterNotePage as Nurse', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u2',
      tenantId: 't1',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Joy',
      email: 'joy@example.com',
    });
  });

  it('shows the note field and all four vitals fields', () => {
    render(<EncounterNotePage />);

    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(screen.getByLabelText('BP systolic')).toBeInTheDocument();
    expect(screen.getByLabelText('BP diastolic')).toBeInTheDocument();
    expect(screen.getByLabelText('Temperature (C)')).toBeInTheDocument();
    expect(screen.getByLabelText('Hemoglobin (g/dL)')).toBeInTheDocument();
  });

  it('submits noteText and a numeric vitals object', async () => {
    mockedApiFetch.mockResolvedValueOnce({ id: 'note-2' });

    render(<EncounterNotePage />);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'BP slightly high.' } });
    fireEvent.change(screen.getByLabelText('BP systolic'), { target: { value: '135' } });
    fireEvent.change(screen.getByLabelText('BP diastolic'), { target: { value: '88' } });
    fireEvent.change(screen.getByLabelText('Temperature (C)'), { target: { value: '37.2' } });
    fireEvent.change(screen.getByLabelText('Hemoglobin (g/dL)'), { target: { value: '11.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/frontline'));
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: {
        noteText: 'BP slightly high.',
        vitals: { bpSystolic: 135, bpDiastolic: 88, temperatureC: 37.2, hemoglobinGdl: 11.4 },
      },
    });
  });
});
