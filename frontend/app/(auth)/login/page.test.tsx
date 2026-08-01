import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';
import { createClient } from '@/lib/supabase/client';

jest.mock('@/lib/supabase/client');

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('LoginPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRefresh.mockClear();
  });

  it('signs in with the entered credentials and redirects to / on success', async () => {
    const signInWithPassword = jest.fn().mockResolvedValue({ error: null });
    mockedCreateClient.mockReturnValue({ auth: { signInWithPassword } } as any);

    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nurse@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'nurse@example.com',
      password: 'secret123',
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows the error message and does not redirect on failed sign-in', async () => {
    const signInWithPassword = jest
      .fn()
      .mockResolvedValue({ error: { message: 'Invalid credentials' } });
    mockedCreateClient.mockReturnValue({ auth: { signInWithPassword } } as any);

    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nurse@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
