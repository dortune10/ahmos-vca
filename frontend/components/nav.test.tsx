import { render, screen } from '@testing-library/react';
import { Nav } from './nav';
import type { AppUser } from '@/lib/current-user';

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
});
