import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LabelColorSet, LabelPalette } from '@/lib/colors';
import { LabelChip } from './LabelChip';

/**
 * Two rows of what `GET /api/meta` publishes as `label_colors` (Section 2.9.2). The values are
 * tokens rather than hexes for the reason `src/test/handlers.ts` gives: the palette is server
 * data and CLAUDE.md section 3 keeps every literal in styles/tokens.css. Nothing here asserts a
 * colour — only that the fill is written as `background-color` and survives a pattern.
 */
const row: LabelColorSet = {
  subtle: 'var(--hover)',
  normal: 'var(--success)',
  bold: 'var(--primary)',
  text: 'var(--text)',
  text_bold: 'var(--text-inverse)',
};

const PALETTE: LabelPalette = { green: row, yellow: row };

describe('LabelChip', () => {
  it('paints the palette fill without clearing a pattern the stylesheet added', () => {
    // `background: <colour>` would be the shorthand, which resets `background-image` to none
    // and outranks the `.stripeN` class, so the colourblind mode of Section 2.6.5 would set
    // its class and change nothing on screen. The inline fill has to be `background-color`.
    const { rerender } = render(
      <LabelChip name="Ready" color="green" tone="normal" palette={PALETTE} />,
    );
    const plain = screen.getByTitle('Ready');
    expect(plain.style.backgroundColor).not.toBe('');
    expect(plain.getAttribute('style')).toMatch(/(^|;)\s*background-color:/);
    expect(plain.getAttribute('style')).not.toMatch(/(^|;)\s*background:/);
    expect(plain.className).not.toMatch(/stripe/);

    rerender(<LabelChip name="Ready" color="green" tone="normal" palette={PALETTE} patterned />);
    const striped = screen.getByTitle('Ready');
    expect(striped.style.backgroundColor).toBe(plain.style.backgroundColor);
    expect(striped.className).toMatch(/stripe/);
  });

  it('gives each palette key its own pattern, and an unknown key none', () => {
    const { rerender } = render(
      <LabelChip name="Ready" color="green" tone="normal" palette={PALETTE} patterned />,
    );
    const green = screen.getByTitle('Ready').className;

    rerender(<LabelChip name="Ready" color="yellow" tone="normal" palette={PALETTE} patterned />);
    expect(screen.getByTitle('Ready').className).not.toBe(green);

    rerender(<LabelChip name="Ready" color="teal" tone="normal" palette={PALETTE} patterned />);
    expect(screen.getByTitle('Ready').className).not.toMatch(/stripe/);
  });

  it('is a named button only when it toggles something', () => {
    const { rerender } = render(
      <LabelChip name="" color="green" tone="normal" palette={PALETTE} size="large" />,
    );
    // An unnamed label — the six a board is seeded with — shows its colour key.
    expect(screen.getByTitle('green').tagName).toBe('SPAN');
    expect(screen.getByText('green')).toBeInTheDocument();

    rerender(
      <LabelChip
        name=""
        color="green"
        tone="normal"
        palette={PALETTE}
        size="large"
        pressed
        onClick={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: 'Label green' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
