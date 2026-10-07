import { useRef, useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover';

/** A trigger plus the popover it owns, the way a real caller wires it to uiStore. */
function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
        Create space
      </button>
      {open && triggerRef.current !== null ? (
        <Popover anchor={triggerRef.current} title="Create space" onClose={() => setOpen(false)}>
          {(nav) => (
            <>
              <input aria-label="Space title" />
              <button
                type="button"
                onClick={() =>
                  nav.push({ title: 'Change background', content: <p>Pick a colour</p> })
                }
              >
                Background
              </button>
            </>
          )}
        </Popover>
      ) : null}
    </>
  );
}

describe('Popover', () => {
  it('focuses the first control and returns focus to the trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Create space' });

    await user.click(trigger);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Space title')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on a click outside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Create space' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pushes a nested view and pops it with the back chevron', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Create space' }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Background' }));

    expect(screen.getByText('Change background')).toBeInTheDocument();
    expect(screen.getByText('Pick a colour')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Space title')).toBeInTheDocument();
    expect(screen.queryByText('Pick a colour')).not.toBeInTheDocument();
  });
});
