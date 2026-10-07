import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmPopover } from './ConfirmPopover';

const BODY =
  'All lists, cards and actions will be deleted, and you won\u2019t be able to re-open the space.';

let anchor: HTMLButtonElement | null = null;

function renderConfirm(onConfirm: () => void, onClose: () => void): void {
  anchor = document.createElement('button');
  document.body.append(anchor);
  render(
    <ConfirmPopover
      anchor={anchor}
      title="Delete space?"
      body={BODY}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
}

afterEach(() => {
  anchor?.remove();
  anchor = null;
});

describe('ConfirmPopover', () => {
  it('shows the warning and confirms with the danger button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderConfirm(onConfirm, vi.fn());

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Delete space?');
    expect(screen.getByText(BODY)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('dismisses without confirming on Escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderConfirm(onConfirm, onClose);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('blocks a second click while the request is in flight', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    anchor = document.createElement('button');
    document.body.append(anchor);
    render(
      <ConfirmPopover
        anchor={anchor}
        title="Delete space?"
        body={BODY}
        confirmLabel="Delete"
        loading
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
