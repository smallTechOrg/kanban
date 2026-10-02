import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { board, global } from '@/lib/shortcuts';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

describe('KeyboardShortcutsModal', () => {
  it('prints every row of both tables, grouped', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    for (const group of ['Global', 'Board', 'Card', 'Editors', 'Drag with the keyboard']) {
      expect(screen.getByRole('heading', { name: group })).toBeInTheDocument();
    }
    // The sheet is generated from the handler's own tables, so it cannot drift from the app.
    for (const row of [...global, ...board]) {
      expect(screen.getByText(row.description)).toBeInTheDocument();
    }
  });

  it('reads a combination with a plus and alternatives with "or"', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    const submit = screen.getByText(/Submit the focused description/).closest('div');
    expect(submit?.textContent).toContain('Ctrl+Enter');

    const nextCard = screen.getByText('Select the next card in the same list').closest('div');
    expect(nextCard?.textContent).toContain('JorDown');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
