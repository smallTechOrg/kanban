import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CardSummary } from '@/api/types';
import type { CardRow } from '@/lib/boardState';
import { normalizeBoard } from '@/lib/normalize';
import { boardPayloadFixture, makeCardSummary } from '@/test/handlers';
import { CardBadges } from './CardBadges';
import styles from './CardBadges.module.css';

/**
 * One class of the stylesheet. CSS-module members are `string | undefined` under
 * `noUncheckedIndexedAccess`, so the name is resolved once here and a missing class fails the
 * test loudly instead of asserting against `undefined`.
 */
function cls(name: string): string {
  const value = styles[name];
  if (value === undefined) throw new Error(`CardBadges.module.css has no .${name}`);
  return value;
}

/** Every due state below is measured against this instant, never against the wall clock. */
const NOW = new Date('2026-09-24T12:00:00.000Z');

const IN_TWO_HOURS = '2026-09-24T14:00:00.000Z';
const NEXT_WEEK = '2026-10-01T12:00:00.000Z';
const YESTERDAY = '2026-09-23T12:00:00.000Z';

/** The row as the board cache holds it, which is what a tile hands the badge row. */
function row(overrides: Partial<CardSummary> = {}): CardRow {
  const card = makeCardSummary(overrides);
  const state = normalizeBoard({ ...boardPayloadFixture, cards: [card] });
  const stored = state.cards[card.id];
  if (stored === undefined) throw new Error('fixture card missing');
  return stored;
}

describe('CardBadges', () => {
  it('renders nothing at all for a card with no badge data', () => {
    const { container } = render(<CardBadges card={row()} now={NOW} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows each badge only when the card carries its data', () => {
    render(
      <CardBadges
        card={row({
          due_at: NEXT_WEEK,
          badges: {
            description: true,
            item_done: 1,
            item_total: 3,
          },
        })}
        now={NOW}
      />,
    );

    expect(screen.getByTitle('Due date')).toHaveTextContent('Oct 1');
    expect(screen.getByLabelText('This card has a description.')).toBeInTheDocument();
    expect(screen.getByTitle('Items')).toHaveTextContent('1/3');
  });

  it('shows the start badge in the due slot when there is no due date', () => {
    render(<CardBadges card={row({ start_at: YESTERDAY })} now={NOW} />);

    expect(screen.getByTitle('Start date')).toHaveTextContent('Started Sep 23');
    expect(screen.queryByTitle('Due date')).not.toBeInTheDocument();
  });

  it('turns the items badge green once every item is checked', () => {
    const complete = {
      description: false,
      item_done: 3,
      item_total: 3,
    };
    render(<CardBadges card={row({ badges: complete })} now={NOW} />);

    expect(screen.getByTitle('Items')).toHaveClass(cls('complete'));
  });

  it.each([
    ['none', NEXT_WEEK, false, 'Due date', undefined],
    ['soon', IN_TWO_HOURS, false, 'Due soon', styles.soon],
    ['overdue', YESTERDAY, false, 'Overdue', styles.overdue],
    ['complete', YESTERDAY, true, 'Due date complete', styles.complete],
  ])('paints the %s due pill against the frozen clock', (_state, dueAt, done, title, painted) => {
    render(<CardBadges card={row({ due_at: dueAt, due_complete: done })} now={NOW} />);

    const badge = screen.getByTitle(title);
    if (painted === undefined) {
      // The default state is transparent: it wears none of the three colour classes.
      expect(badge).not.toHaveClass(cls('soon'), cls('overdue'), cls('complete'));
    } else {
      expect(badge).toHaveClass(painted);
    }
  });

  it('toggles due_complete from the badge without following the tile link', async () => {
    const user = userEvent.setup();
    const onToggleDueComplete = vi.fn();
    const onFollow = vi.fn();
    render(
      // The tile wraps the row in a link, and Section 2.5.3 says the checkbox must not open it.
      <a href="/b/7/c/101" onClick={onFollow}>
        <CardBadges
          card={row({ due_at: YESTERDAY })}
          now={NOW}
          onToggleDueComplete={onToggleDueComplete}
        />
      </a>,
    );

    const badge = screen.getByRole('button', { name: /Sep 23/ });
    expect(badge).toHaveAccessibleName(/Mark complete/);
    expect(badge).toHaveAttribute('aria-pressed', 'false');

    await user.click(badge);

    expect(onToggleDueComplete).toHaveBeenCalledWith(true);
    expect(onFollow).not.toHaveBeenCalled();
  });

  it('offers to undo a completed due date', async () => {
    const user = userEvent.setup();
    const onToggleDueComplete = vi.fn();
    render(
      <CardBadges
        card={row({ due_at: YESTERDAY, due_complete: true })}
        now={NOW}
        onToggleDueComplete={onToggleDueComplete}
      />,
    );

    const badge = screen.getByRole('button', { name: /Mark incomplete/ });
    expect(badge).toHaveAttribute('aria-pressed', 'true');

    await user.click(badge);

    expect(onToggleDueComplete).toHaveBeenCalledWith(false);
  });
});
