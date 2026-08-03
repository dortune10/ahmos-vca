import { render, screen } from '@testing-library/react';
import RootPage from './page';
import { getCurrentAppUser } from '@/lib/current-user';

jest.mock('@/lib/current-user', () => ({
  getCurrentAppUser: jest.fn(),
}));

// Modelled on the real thing: `redirect()` throws NEXT_REDIRECT to abort rendering. Making
// the mock throw too is what lets these tests prove a signed-in user never reaches the
// landing markup, rather than only proving the function was called.
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const mockedGetCurrentAppUser = getCurrentAppUser as jest.MockedFunction<
  typeof getCurrentAppUser
>;

function appUser(overrides: Partial<Awaited<ReturnType<typeof getCurrentAppUser>>> = {}) {
  return {
    id: 'u1',
    tenantId: 't1',
    role: 'nurse' as const,
    facilityId: 'f1',
    fullName: 'Test User',
    email: 'user@example.com',
    ...overrides,
  };
}

describe('RootPage', () => {
  beforeEach(() => {
    mockedGetCurrentAppUser.mockReset();
  });

  describe('unauthenticated visitor', () => {
    beforeEach(() => {
      mockedGetCurrentAppUser.mockResolvedValue(null);
    });

    it('renders the landing page instead of redirecting', async () => {
      render(await RootPage());

      expect(
        screen.getByRole('heading', { level: 1, name: /every pregnancy registered/i }),
      ).toBeInTheDocument();
    });

    it('offers signing in as the only call to action, with no self-serve sign-up', async () => {
      render(await RootPage());

      const signInLinks = screen.getAllByRole('link', { name: /^sign in$/i });
      expect(signInLinks.length).toBeGreaterThan(0);
      signInLinks.forEach((link) => expect(link).toHaveAttribute('href', '/login'));

      expect(screen.queryByText(/sign up|start free|free trial/i)).not.toBeInTheDocument();
    });

    it('states plainly that the risk scoring is not clinically validated', async () => {
      render(await RootPage());

      expect(screen.getByText(/not been clinically validated/i)).toBeInTheDocument();
      expect(screen.getByText(/decision support, not diagnoses/i)).toBeInTheDocument();
    });
  });

  describe('authenticated staff', () => {
    // The regression this file exists for: adding a marketing page to `/` must not stop a
    // signed-in user being sent to their role's dashboard.
    it.each([
      ['chw', '/frontline'],
      ['nurse', '/frontline'],
      ['clinician', '/clinician'],
      ['supervisor', '/supervisor'],
      ['admin', '/admin'],
    ])('redirects a signed-in %s to %s', async (role, expectedRoute) => {
      mockedGetCurrentAppUser.mockResolvedValue(
        appUser({ role: role as 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin' }),
      );

      await expect(RootPage()).rejects.toThrow(`NEXT_REDIRECT:${expectedRoute}`);
    });

    it('shows the no-dashboard-yet fallback for a role with no home route', async () => {
      mockedGetCurrentAppUser.mockResolvedValue(
        appUser({ role: 'support' as unknown as 'admin', email: 'support@example.com' }),
      );

      render(await RootPage());

      expect(screen.getByText(/signed in as support@example.com/i)).toBeInTheDocument();
      expect(screen.getByText(/no dashboard built yet/i)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    });
  });
});
