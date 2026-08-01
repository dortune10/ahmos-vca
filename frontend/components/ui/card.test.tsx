import { render, screen } from '@testing-library/react';
import { Card } from './card';

describe('Card', () => {
  it('renders its children inside a bordered container', () => {
    render(
      <Card>
        <p>Content</p>
      </Card>,
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
