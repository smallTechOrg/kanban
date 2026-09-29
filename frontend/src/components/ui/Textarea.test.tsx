import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('submits on Enter and adds a newline on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<Textarea aria-label="Card title" onSubmit={onSubmit} onCancel={onCancel} />);
    const input = screen.getByRole('textbox', { name: 'Card title' });

    await user.type(input, 'Ship it{Shift>}{Enter}{/Shift}now');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('Ship it\nnow');

    await user.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.type(input, '{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('waits for Ctrl/Cmd+Enter when that is the submit key', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Textarea aria-label="Description" submitKey="mod-enter" onSubmit={onSubmit} />);
    const input = screen.getByRole('textbox', { name: 'Description' });

    await user.type(input, 'Looks good{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('Looks good\n');

    await user.type(input, '{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
