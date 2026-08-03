import { render, screen, waitFor } from '@testing-library/react';
import { EncounterNoteList, formatVitals } from './encounter-note-list';
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

function buildNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    pregnancyEpisodeId: 'e1',
    recordedBy: 'u1',
    recordedAt: '2026-08-02T09:00:00.000Z',
    noteText: 'Patient stable.',
    vitals: null,
    createdAt: '2026-08-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('formatVitals', () => {
  it('returns null when there are no vitals at all', () => {
    expect(formatVitals(null)).toBeNull();
  });

  it('returns null when every vital is null, rather than an empty separator string', () => {
    expect(
      formatVitals({ bpSystolic: null, bpDiastolic: null, temperatureC: null, hemoglobinGdl: null }),
    ).toBeNull();
  });

  it('labels each recorded vital with its unit and skips the missing ones', () => {
    expect(formatVitals({ bpSystolic: 150, bpDiastolic: 95, hemoglobinGdl: 9.2 })).toBe(
      'BP systolic 150 mmHg · BP diastolic 95 mmHg · Hemoglobin 9.2 g/dL',
    );
  });

  it('does not drop a legitimate zero reading', () => {
    expect(formatVitals({ temperatureC: 0 })).toBe('Temperature 0 °C');
  });
});

describe('EncounterNoteList', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('fetches and renders the episode notes', async () => {
    mockedApiFetch.mockResolvedValue([
      buildNote({ id: 'n1', noteText: 'Second visit.', vitals: { bpSystolic: 118 } }),
      buildNote({ id: 'n2', noteText: 'First visit.', recordedAt: '2026-08-01T09:00:00.000Z' }),
    ]);

    render(<EncounterNoteList episodeId="e1" />);

    expect(await screen.findByText('Second visit.')).toBeInTheDocument();
    expect(screen.getByText('First visit.')).toBeInTheDocument();
    expect(screen.getByText('BP systolic 118 mmHg')).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes');
  });

  it('shows an empty state when no notes exist', async () => {
    mockedApiFetch.mockResolvedValue([]);

    render(<EncounterNoteList episodeId="e1" />);

    expect(await screen.findByText('No encounter notes recorded yet.')).toBeInTheDocument();
  });

  // A vitals-only note is legal: recordEncounterNote() accepts vitals with no noteText.
  it('marks a vitals-only note as having no narrative rather than rendering a blank row', async () => {
    mockedApiFetch.mockResolvedValue([buildNote({ noteText: null, vitals: { bpSystolic: 120 } })]);

    render(<EncounterNoteList episodeId="e1" />);

    expect(await screen.findByText('No narrative recorded.')).toBeInTheDocument();
    expect(screen.getByText('BP systolic 120 mmHg')).toBeInTheDocument();
  });

  it('surfaces a load failure as an alert', async () => {
    mockedApiFetch.mockRejectedValue(new Error('notes endpoint down'));

    render(<EncounterNoteList episodeId="e1" />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('re-fetches when refreshToken changes so a just-saved note appears', async () => {
    mockedApiFetch.mockResolvedValue([]);

    const { rerender } = render(<EncounterNoteList episodeId="e1" refreshToken={0} />);
    await screen.findByText('No encounter notes recorded yet.');
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    mockedApiFetch.mockResolvedValue([buildNote({ noteText: 'Just saved.' })]);
    rerender(<EncounterNoteList episodeId="e1" refreshToken={1} />);

    expect(await screen.findByText('Just saved.')).toBeInTheDocument();
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(2));
  });
});
