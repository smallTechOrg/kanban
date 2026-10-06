import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArchivedBanner } from './ArchivedBanner';

/**
 * Section 2.6.1 gives this band one job: say that the card is archived. "Put back" and the
 * confirmed Delete are `CardModalSidebar`'s rows (Section 2.6.4) and are covered there, so they
 * are deliberately not asserted here - a second copy of them in this file would be a second copy
 * of the rule in the component.
 */
describe('ArchivedBanner', () => {
  it('says the card is archived and offers no action of its own', () => {
    render(<ArchivedBanner />);

    expect(screen.getByText('This card is archived.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
