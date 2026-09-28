import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function renderModal(onClose: () => void): void {
  render(
    <Modal title="Account settings" onClose={onClose}>
      <button type="button">Save</button>
      <button type="button">Cancel</button>
    </Modal>,
  );
}

describe('Modal', () => {
  it('keeps focus inside the dialog while tabbing', async () => {
    const user = userEvent.setup();
    renderModal(vi.fn());
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // FloatingFocusManager moves focus in a microtask after the dialog mounts.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Tab walks the three controls and wraps back round through the focus guard.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = screen.getByRole('dialog').parentElement;
    expect(overlay).not.toBeNull();
    if (overlay !== null) await user.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on the header close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
