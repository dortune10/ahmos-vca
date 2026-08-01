import { render, screen } from '@testing-library/react';
import { Table } from './table';

describe('Table', () => {
  it('renders a native table element with the given thead/tbody children', () => {
    render(
      <Table>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Amina</td>
          </tr>
        </tbody>
      </Table>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Amina')).toBeInTheDocument();
  });
});
