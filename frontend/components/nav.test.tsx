import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Nav } from './nav';
import type { AppUser } from '@/lib/current-user';
import { createClient } from '@/lib/supabase/client';

jest.mock('@/lib/supabase/client');

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

function buildUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 'u1',
    tenantId: 't1',
    role: 'chw',
    facilityId: 'f1',
    fullName: 'Amina',
    email: 'amina@example.com',
    ...overrides,
  };
}

describe('Nav', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRefresh.mockClear();
  });

  it("shows the CHW's frontline links and not the admin link", () => {
    render(<Nav user={buildUser({ role: 'chw' })} />);

    expect(screen.getByRole('link', { name: 'Caseload' })).toHaveAttribute(
      'href',
      '/frontline',
    );
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the admin link and full name for an admin user', () => {
    render(<Nav user={buildUser({ role: 'admin', fullName: 'Admin User' })} />);

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByText('Admin User (admin)')).toBeInTheDocument();
  });

  it('signs the user out and redirects to /login when Sign out is clicked', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    mockedCreateClient.mockReturnValue({ auth: { signOut } } as any);

    render(<Nav user={buildUser()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledWith('/login');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows both clinician links: Triage Board and Referrals', () => {
    render(<Nav user={buildUser({ role: 'clinician' })} />);

    expect(screen.getByRole('link', { name: 'Triage Board' })).toHaveAttribute(
      'href',
      '/clinician',
    );
    expect(screen.getByRole('link', { name: 'Referrals' })).toHaveAttribute(
      'href',
      '/clinician/referrals',
    );
  });

  it('shows both supervisor nav links for a supervisor user', () => {
    render(<Nav user={buildUser({ role: 'supervisor', fullName: 'Sup User' })} />);

    expect(screen.getByRole('link', { name: 'KPIs' })).toHaveAttribute('href', '/supervisor');
    expect(screen.getByRole('link', { name: 'Referral SLA' })).toHaveAttribute(
      'href',
      '/supervisor/referrals',
    );
  });
});
