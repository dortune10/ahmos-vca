import { render, screen } from '@testing-library/react';
import RootPage from './page';

describe('RootPage (placeholder)', () => {
  it('renders the platform name', () => {
    render(<RootPage />);
    expect(screen.getByText('AMHOS Staff Platform')).toBeInTheDocument();
  });
});
