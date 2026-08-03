import { render, screen, within } from '@testing-library/react';
import { LandingPage } from './landing-page';
import { PATHWAY_STEPS, ROLE_ROWS } from '@/lib/landing-content';

describe('LandingPage', () => {
  it('leads with what the platform is', () => {
    render(<LandingPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: /every pregnancy registered/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/care-coordination platform for maternal and newborn health/i),
    ).toBeInTheDocument();
  });

  it('renders every pathway step and every staff role', () => {
    render(<LandingPage />);

    PATHWAY_STEPS.forEach((step) => {
      expect(screen.getByRole('heading', { name: step.label })).toBeInTheDocument();
    });
    ROLE_ROWS.forEach((row) => {
      expect(screen.getByRole('heading', { name: row.role })).toBeInTheDocument();
    });
  });

  it('shows the referral lifecycle taken from the state machine', () => {
    render(<LandingPage />);

    ['Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed'].forEach(
      (status) => expect(screen.getByText(status)).toBeInTheDocument(),
    );
  });

  it('points every call to action at the staff login', () => {
    render(<LandingPage />);

    screen
      .getAllByRole('link', { name: /^sign in$/i })
      .forEach((link) => expect(link).toHaveAttribute('href', '/login'));
  });

  it('labels the example record as an example and says no patient data exists', () => {
    render(<LandingPage />);

    const figure = screen.getByRole('figure');
    expect(within(figure).getByText(/pregnancy episode · example/i)).toBeInTheDocument();
    expect(within(figure).getByText(/AMHOS holds no patient data/i)).toBeInTheDocument();
  });

  it('states the pre-pilot status and the clinical limits of the risk score', () => {
    render(<LandingPage />);

    expect(screen.getByText(/pre-pilot/i)).toBeInTheDocument();
    expect(screen.getByText(/no live deployment/i)).toBeInTheDocument();
    expect(screen.getByText(/not been clinically validated/i)).toBeInTheDocument();
    expect(
      screen.getByText(/replaces a clinician/i, { exact: false }),
    ).toBeInTheDocument();
  });

  it('frames patient messaging as designed but not built', () => {
    render(<LandingPage />);

    expect(screen.getByText(/designed but not yet built/i)).toBeInTheDocument();
  });

  it('exposes a single main landmark and a skip link for keyboard users', () => {
    render(<LandingPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main',
    );
  });
});
