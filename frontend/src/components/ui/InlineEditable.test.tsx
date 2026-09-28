import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineEditable } from './InlineEditable';

/** Mirrors a real caller: the value stays the server's until the mutation reports back. */
function Harness({ onSave }: { onSave: (next: string) => void }): ReactElement {
  const [value, setValue] = useState('Sprint 42');
  return (
    <>
      <InlineEditable
        value={value}
        label="Board name"
        onSave={(next) => {
          onSave(next);
          setValue(next);
        }}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('InlineEditable', () => {
  it('commits the new text on Enter', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Board name' }));
    const input = screen.getByRole('textbox', { name: 'Board name' });
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, '  Sprint 43  {Enter}');

    expect(onSave).toHaveBeenCalledWith('Sprint 43');
    expect(screen.getByRole('button', { name: 'Board name' })).toHaveTextContent('Sprint 43');
  });

  it('reverts on Escape and saves nothing', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Board name' }));
    await user.type(screen.getByRole('textbox', { name: 'Board name' }), 'nope{Escape}');

    expect(onSave).not.toHaveBeenCalled();
    const trigger = screen.getByRole('button', { name: 'Board name' });
    expect(trigger).toHaveTextContent('Sprint 42');
    expect(trigger).toHaveFocus();
  });

  it('keeps a mousedown inside the editor away from an enclosing drag handle', async () => {
    const user = userEvent.setup();
    // `@hello-pangea/dnd` binds its mouse sensor to `window`, so that is what has to stay
    // unreached (CLAUDE.md section 8).
    const sensor = vi.fn();
    window.addEventListener('mousedown', sensor);
    render(<Harness onSave={vi.fn()} />);

    // The trigger is part of the handle, so grabbing the title drags the list (Section 2.4.2).
    await user.click(screen.getByRole('button', { name: 'Board name' }));
    expect(sensor).toHaveBeenCalledTimes(1);

    // The open editor is not: `ListHeader` sits inside a `Draggable` with the library's
    // interactive-element blocking turned off, and a mousedown the sensor claims is
    // `preventDefault`ed, so the caret would not move and a 5px drag would lift the column.
    await user.click(screen.getByRole('textbox', { name: 'Board name' }));
    expect(sensor).toHaveBeenCalledTimes(1);

    window.removeEventListener('mousedown', sensor);
  });

  it('commits on blur but discards an empty title', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Board name' }));
    await user.type(screen.getByRole('textbox', { name: 'Board name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onSave).toHaveBeenCalledWith('Sprint 42!');

    await user.click(screen.getByRole('button', { name: 'Board name' }));
    await user.clear(screen.getByRole('textbox', { name: 'Board name' }));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Board name' })).toHaveTextContent('Sprint 42!');
  });
});
