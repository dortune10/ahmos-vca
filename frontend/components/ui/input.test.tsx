import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './input';

describe('Input', () => {
  it('associates the label with the input via htmlFor/id and reports changes', () => {
    const handleChange = jest.fn();
    render(<Input label="First name" value="" onChange={handleChange} />);

    const input = screen.getByLabelText('First name');
    fireEvent.change(input, { target: { value: 'Amina' } });

    expect(handleChange).toHaveBeenCalled();
  });

  it('renders an error message when error is provided', () => {
    render(<Input label="Phone" value="" onChange={() => {}} error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('forwards standard input attributes such as type and required', () => {
    render(<Input label="Password" type="password" required value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toBeRequired();
  });
});
