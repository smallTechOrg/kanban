import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox, Field, Select, TextInput } from './Form';

const HELPER = 'lowercase letters, numbers and _ only, 3-32';
const ERROR = 'Board title is required';

/** The register-form pattern: the helper is replaced by the error once validation fails. */
function Harness(): ReactElement {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const error = submitted && value === '' ? ERROR : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <Field label="Username" helper={HELPER} error={error}>
        {(control) => (
          <TextInput
            {...control}
            invalid={error !== undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
      <button type="submit">Create</button>
    </form>
  );
}

describe('Form', () => {
  it('shows the helper until validation fails, then the error', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Username');

    expect(input).toHaveAccessibleDescription(HELPER);
    expect(input).not.toHaveAttribute('aria-invalid');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText(ERROR)).toBeInTheDocument();
    expect(screen.queryByText(HELPER)).not.toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(ERROR);
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.type(input, 'sprint_42');

    expect(screen.queryByText(ERROR)).not.toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(HELPER);
  });

  it('labels a select and a checkbox', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Field label="List">
          {(control) => (
            <Select {...control} defaultValue="todo">
              <option value="todo">To Do</option>
              <option value="doing">Doing</option>
            </Select>
          )}
        </Field>
        <Checkbox label="Start with default lists" defaultChecked />
      </>,
    );

    await user.selectOptions(screen.getByLabelText('List'), 'doing');
    expect(screen.getByLabelText('List')).toHaveValue('doing');

    const checkbox = screen.getByRole('checkbox', { name: 'Start with default lists' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
});
