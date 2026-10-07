import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('opens on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Item actions">
        <button type="button">Actions</button>
      </Tooltip>,
    );

    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Item actions');
  });

  it('closes on Escape and lets the key reach the dialog underneath', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Card" onClose={onClose} chrome={false}>
        <Tooltip content="Close card">
          <button type="button">Close</button>
        </Tooltip>
      </Modal>,
    );

    // The dialog hands focus to its first tabbable child, which is the tooltip's trigger — the
    // card modal's "Close card" button. Its tooltip must not swallow the Escape (Section 2.6.1).
    await user.tab();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
