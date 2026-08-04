// fireEvent, not userEvent: @testing-library/user-event is NOT a dependency of this project
// (frontend/package.json carries only @testing-library/react and jest-dom), and every existing
// component test here — referral-create-form.test.tsx, encounter-note-list.test.tsx — clicks
// with fireEvent. Do not add the dependency for this one card.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WhatsAppEnrolmentCodeCard } from './whatsapp-enrolment-code-card';
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

describe('WhatsAppEnrolmentCodeCard', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('shows no code until one is issued', () => {
    render(<WhatsAppEnrolmentCodeCard personId="p1" />);

    expect(screen.queryByLabelText('WhatsApp enrolment code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue enrolment code' })).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('issues a code for this person and displays it', async () => {
    mockedApiFetch.mockResolvedValueOnce({ code: '482915', expiresAt: '2026-08-17T00:00:00.000Z' });

    render(<WhatsAppEnrolmentCodeCard personId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue enrolment code' }));

    await waitFor(() =>
      expect(screen.getByLabelText('WhatsApp enrolment code')).toHaveTextContent('482915'),
    );
    expect(mockedApiFetch).toHaveBeenCalledWith('/persons/p1/whatsapp-enrolment-code', {
      method: 'POST',
    });
  });

  // The code is shown once and only once — the server keeps a hash, not the code — so the
  // button has to keep offering a replacement rather than pretending the old one is still
  // readable somewhere.
  it('offers to issue a replacement after showing a code', async () => {
    mockedApiFetch.mockResolvedValue({ code: '482915', expiresAt: '2026-08-17T00:00:00.000Z' });

    render(<WhatsAppEnrolmentCodeCard personId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue enrolment code' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issue a new code' })).toBeInTheDocument(),
    );
  });

  it('surfaces a failure without clearing the screen', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('network down'));

    render(<WhatsAppEnrolmentCodeCard personId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue enrolment code' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not issue a code.'),
    );
    expect(screen.getByRole('button', { name: 'Issue enrolment code' })).toBeEnabled();
  });
});
