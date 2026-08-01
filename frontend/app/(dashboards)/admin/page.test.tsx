import { render, screen } from '@testing-library/react';
import AdminHomePage from './page';

describe('AdminHomePage', () => {
  it('links to the three admin management screens', () => {
    render(<AdminHomePage />);

    expect(screen.getByRole('link', { name: /facilities/i })).toHaveAttribute(
      'href',
      '/admin/facilities',
    );
    expect(screen.getByRole('link', { name: /^staff$/i })).toHaveAttribute(
      'href',
      '/admin/staff',
    );
    expect(screen.getByRole('link', { name: /audit log/i })).toHaveAttribute(
      'href',
      '/admin/audit',
    );
  });
});
