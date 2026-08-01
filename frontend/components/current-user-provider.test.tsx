import { render, screen } from '@testing-library/react';
import { CurrentUserProvider, useCurrentUser } from './current-user-provider';
import type { AppUser } from '@/lib/current-user';

const SAMPLE_USER: AppUser = {
  id: 'u1',
  tenantId: 't1',
  role: 'chw',
  facilityId: 'f1',
  fullName: 'Amina CHW',
  email: 'amina@example.com',
};

function Consumer() {
  const user = useCurrentUser();
  return <p>{user.fullName}</p>;
}

describe('CurrentUserProvider / useCurrentUser', () => {
  it('provides the given user to descendants', () => {
    render(
      <CurrentUserProvider user={SAMPLE_USER}>
        <Consumer />
      </CurrentUserProvider>,
    );

    expect(screen.getByText('Amina CHW')).toBeInTheDocument();
  });

  it('throws a clear error when used outside a provider', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Consumer />)).toThrow(
      'useCurrentUser must be used within a CurrentUserProvider',
    );

    consoleErrorSpy.mockRestore();
  });
});
