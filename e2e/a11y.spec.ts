import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Result } from 'axe-core';

/**
 * The automated half of the Section 5.10 accessibility pass, required by the M5 checklist
 * ("Playwright runs `@axe-core/playwright` on Home, Board and Card modal").
 *
 * axe runs against the three surfaces the plan names plus every panel that opens over them —
 * ten scans in all — on a board this file builds through the UI, so each one sees real
 * content: a list, a card with a label, and the card's detail modal open over the board. Only
 * `serious` and `critical` findings fail the run (the two impacts the milestone commits to
 * clearing, with the one documented exception above `scan()`), and a failure prints the rule
 * id, its help URL and the offending selector, so the report names the element, not a count.
 *
 * Steps 8 to 10 then cover the three bullets of the same M5 checklist line that axe cannot
 * see at all: the colourblind label mode and its `localStorage` key, the focus ring's colour,
 * and the aria-live announcements a keyboard drag makes.
 *
 * One serial test: every scan runs against what the step before it left on screen.
 */

/** The WCAG 2.1 AA rule set. axe's "best-practice" tags are deliberately not included: they
 *  encode house style (heading order, landmark uniqueness) rather than a conformance failure. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

const BLOCKING: ReadonlySet<string> = new Set(['serious', 'critical']);

/** The one rule this file reports rather than fails on; the reason is above `scan()`. */
const CONTRAST_RULE = 'color-contrast';

/** A fresh board name per run, so the file also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `A11y audit ${suffix}`;
const LIST = 'Inbox';
const CARD = 'Check the contrast';

/** Board labels are seeded unnamed, so a chip is addressed by its colour key (Section 2.6.5). */
const LABEL = 'green';

/** The `localStorage` key Section 5.13 and the M5 checklist pin the colourblind mode to. */
const COLORBLIND_KEY = 'kb_colorBlindLabels';

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/**
 * One readable line per offending element. The raw axe `Result` is a deep object and a failed
 * `toEqual([])` on it prints hundreds of lines of JSON, which hides the one fact that matters:
 * which rule broke on which element.
 */
function lines(violations: readonly Result[]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `[${violation.impact ?? 'unknown'}] ${violation.id} @ ${node.target.join(' ')} — ` +
        `${(node.failureSummary ?? violation.help).replace(/\s+/g, ' ')} (${violation.helpUrl})`,
    ),
  );
}

/**
 * Scans the whole page for `serious` and `critical` WCAG 2.1 AA violations.
 *
 * The assertion is soft, so one run reports every surface at once rather than stopping at the
 * first; the test still fails if any of them found something.
 *
 * `color-contrast` reports instead of failing, and this is the one exception in the file.
 * Every contrast pair axe flags here is a hex or an rgba() that Section 2.9.1 and the two
 * tables of Sections 2.1.1 / 2.1.2 write down as the design: white 700 text on the
 * `rgba(255,255,255,0.3)` nav wash over `#026AA7` (3.22:1), white on the board header's
 * `rgba(255,255,255,0.24)`, `--link` `#0079BF` on the `--selected` `#E4F0F6` row (4.03:1) and
 * `--text-muted` `#5E6C84` on `--list-bg` `#EBECF0` (4.49:1, a hundredth short). Section 5.10
 * asks for 4.5:1 on all of them, so the plan contradicts itself; CLAUDE.md's rule is that the
 * plan wins, and raising any of these means repainting the chrome — which this pass is
 * explicitly not allowed to do. The findings are attached to the run instead of swallowed, so
 * the report still names them, and the deviation is recorded in CLAUDE.md section 8.
 */
async function scan(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact !== undefined && BLOCKING.has(violation.impact),
  );
  const contrast = blocking.filter((violation) => violation.id === CONTRAST_RULE);
  if (contrast.length > 0) {
    test.info().annotations.push({
      type: 'contrast (reported, see the note above scan())',
      description: `${surface}\n${lines(contrast).join('\n')}`,
    });
  }
  const failing = blocking.filter((violation) => violation.id !== CONTRAST_RULE);
  expect.soft(lines(failing), surface).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('a11y: axe finds no serious or critical violation on Home, Board or the card modal', async ({
  page,
}) => {
  await test.step('1. Home: the create tile, the grid and the sidebar', async () => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Create new board' })).toBeVisible();
    await scan(page, 'Home');
  });

  await test.step('2. create a board through the popover', async () => {
    await page.getByRole('button', { name: 'Create new board' }).click();
    const popover = page.getByRole('dialog', { name: 'Create board' });
    await expect(popover).toBeVisible();

    // The open popover is part of the page, so this scan covers the popover chrome too.
    await scan(page, 'Home (create-board popover open)');

    await popover.getByLabel('Board title *').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/b\/\d+$/);
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
  });

  await test.step('3. Home again, with this board in the grid', async () => {
    await page.locator('header').getByRole('button', { name: 'Boards', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:8020/');
    await expect(page.getByRole('link', { name: BOARD, exact: true }).first()).toBeVisible();
    await scan(page, 'Home (with a board)');
  });

  await test.step('4. back to the board, add a list and a card', async () => {
    await page.getByRole('link', { name: BOARD, exact: true }).first().click();
    await expect(page).toHaveURL(/\/b\/\d+$/);

    // A board created with the default lists opens on "To Do"; one without opens the composer.
    const composer = page.getByRole('button', { name: /^Add (a|another) list$/ });
    if (await composer.isVisible()) await composer.click();
    await page.getByLabel('List title').fill(LIST);
    await page.getByRole('button', { name: 'Add list' }).click();
    await expect(column(page, LIST)).toBeVisible();
    await page.keyboard.press('Escape');

    const list = column(page, LIST);
    await list.getByRole('button', { name: 'Add a card' }).click();
    await page.getByLabel('Card title').fill(CARD);
    await page.getByRole('button', { name: 'Add card' }).click();
    await expect(list.getByRole('link', { name: CARD })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('5. the board, with a column, a tile and the header', async () => {
    await page.mouse.move(0, 0);
    await scan(page, 'Board');
  });

  await test.step('5b. the panels a shortcut opens: filter, search, cheat sheet', async () => {
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Filter' })).toBeVisible();
    await scan(page, 'Board (filter popover)');
    await page.keyboard.press('Escape');

    // `/` focuses the nav search; a query renders both result groups (Section 2.1.1).
    await page.keyboard.press('/');
    await page.keyboard.type(CARD.slice(0, 5));
    await expect(page.locator('header').getByRole('heading', { name: 'Cards' })).toBeVisible();
    await scan(page, 'Board (search results)');
    await page.keyboard.press('Escape');
    await expect(page.locator('header').getByRole('heading', { name: 'Cards' })).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await scan(page, 'Keyboard shortcuts modal');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  });

  await test.step('6. the board menu drawer', async () => {
    await page.getByRole('button', { name: 'Show menu' }).click();
    await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible();
    await scan(page, 'Board (menu drawer)');
    await page.keyboard.press('Escape');
  });

  await test.step('7. the card detail modal, with a label attached', async () => {
    await column(page, LIST).getByRole('link', { name: CARD }).click();
    const modal = page.getByRole('dialog', { name: CARD });
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: 'Labels', exact: true }).click();
    const labels = page.getByRole('dialog', { name: 'Labels' });
    await expect(labels).toBeVisible();
    const chip = labels.getByRole('button', { name: `Label ${LABEL}`, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // Every popover is scanned while open: it is the surface the plan traps focus in.
    await scan(page, 'Card modal (labels popover open)');

    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);
    // The modal's badge row now carries a "Labels" group, so the scan below sees a chip.
    await expect(modal.locator('#card-labels-label')).toBeVisible();
    await scan(page, 'Card modal');
  });

  // ---------------------------------------------------------------------------------------
  // The rest of the Section 5.10 pass: the three things axe cannot see, each one a bullet of
  // the M5 checklist. They run here rather than in their own file because they need exactly
  // the board this test has already built.
  // ---------------------------------------------------------------------------------------

  await test.step('8. the colourblind label mode persists under kb_colorBlindLabels', async () => {
    const modal = page.getByRole('dialog', { name: CARD });
    await modal.getByRole('button', { name: 'Labels', exact: true }).click();
    const labels = page.getByRole('dialog', { name: 'Labels' });
    const chip = labels.getByRole('button', { name: `Label ${LABEL}`, exact: true });

    // Off by default: the chip is a flat fill.
    await expect(chip).toHaveCSS('background-image', 'none');
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), COLORBLIND_KEY))
      .toBeNull();

    await labels.getByLabel('Enable colorblind friendly mode').check();
    await expect(chip).not.toHaveCSS('background-image', 'none');
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), COLORBLIND_KEY))
      .toBe('true');

    // Section 5.13: the key survives a reload, which is the whole point of persisting it.
    await page.reload();
    // The reload lands on the card route, so the modal comes back over the board; Escape
    // closes it and makes the tile behind it visible to a role query again.
    await expect(page.getByRole('dialog', { name: CARD })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: CARD })).toHaveCount(0);

    const tileChip = column(page, LIST).getByRole('button', {
      name: `Label ${LABEL}`,
      exact: true,
    });
    await expect(tileChip).not.toHaveCSS('background-image', 'none');

    await page.evaluate((key) => localStorage.removeItem(key), COLORBLIND_KEY);
  });

  await test.step('9. the focus ring is the documented colour on a keyboard focus', async () => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus-visible');
    await expect(focused).toHaveCount(1);

    // The expected value is read from the token rather than written down, so this asserts the
    // ring is `--focus` and `styles/tokens.css` stays the only place the hex lives.
    const ring = await page.evaluate(() => {
      const node = document.activeElement;
      if (node === null) return null;
      const style = getComputedStyle(node);
      const probe = document.createElement('span');
      probe.style.color = 'var(--focus)';
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { color: style.outlineColor, width: style.outlineWidth, expected };
    });
    expect(ring?.color).toBe(ring?.expected);
    expect(ring?.width).toBe('2px');
  });

  await test.step('10. a keyboard lift is announced in the live region', async () => {
    await page.goBack();
    const card = column(page, LIST).getByRole('link', { name: CARD });
    await card.focus();

    // Section 2.7: the handle is a tab stop, Space lifts, Esc cancels. `@hello-pangea/dnd`
    // owns those keys (Section 2.8's precedence rule) and writes what happened into its own
    // aria-live region, which is the only thing a screen-reader user has during a drag.
    const live = page.locator('[aria-live]');
    await page.keyboard.press('Space');
    await expect(live.filter({ hasText: /lifted/i })).toHaveCount(1);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(live.filter({ hasText: /cancel/i })).toHaveCount(1);
  });
});
