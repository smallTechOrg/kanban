import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The manual half of the Section 5.10 accessibility pass: the M5 checklist's "keyboard-only
 * run-through of create board -> add list -> add card -> open card -> add label".
 *
 * The rule this file enforces is that no step uses a pointer. `page.mouse`, `.click()` and
 * `.fill()` never appear: every control is reached by Tab (or Shift+Tab) and operated with
 * Enter, Space or typed text, exactly as a person with no mouse would. That makes it a test of
 * three things at once — that each control is in the tab order, that it has an accessible name
 * to recognise it by, and that Escape unwinds the popover / composer / modal chain of Section
 * 2.8 without trapping focus anywhere.
 *
 * One serial test: every step builds on what the step before it left on screen.
 */

/** A fresh board name per run, so the file also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `Keyboard only ${suffix}`;
const LIST = 'Backlog';
const CARD = 'Ship without a mouse';

/** Board labels are seeded unnamed, so a chip is addressed by its colour key (Section 2.6.5). */
const LABEL = 'green';

/**
 * Tab presses allowed before a control is declared unreachable.
 *
 * A board page needs a fraction of this. Home is the generous case: with no accounts every spec
 * writes into the one dataset, so its grid — and with it the tab order in front of the create
 * tile — grows by two stops for every board the suite has made.
 */
const MAX_TABS = 150;

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((node) => node === document.activeElement).catch(() => false);
}

/**
 * Presses Tab until `target` holds the focus. Fails with the accessible name of whatever the
 * focus stopped on instead, because "the composer is not in the tab order" and "the composer
 * is in the tab order but unnamed" are different bugs and the message has to tell them apart.
 */
async function tabTo(page: Page, target: Locator, direction: 'forward' | 'back' = 'forward') {
  const key = direction === 'forward' ? 'Tab' : 'Shift+Tab';
  for (let pressed = 0; pressed < MAX_TABS; pressed += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press(key);
  }
  const stopped = await page.evaluate(() => {
    const node = document.activeElement;
    if (node === null) return 'nothing';
    const name = node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '';
    return `<${node.tagName.toLowerCase()}> "${name}"`;
  });
  throw new Error(`Tab never reached the control; focus stopped on ${stopped}`);
}

/** Tab to a control and activate it the way a keyboard user does. */
async function tabAndPress(page: Page, target: Locator, key = 'Enter'): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press(key);
}

test.describe.configure({ mode: 'serial' });

test('a11y: create board, list, card and label with the keyboard alone', async ({ page }) => {
  await test.step('1. create a board from the Home create tile', async () => {
    await page.goto('/');
    await tabAndPress(page, page.getByRole('button', { name: 'Create new space' }));

    const popover = page.getByRole('dialog', { name: 'Create space' });
    await expect(popover).toBeVisible();

    // Section 5.10: a popover puts the initial focus inside itself, so the title field is
    // reachable without ever leaving the panel — and Tab cannot escape the trap.
    await tabTo(page, popover.getByLabel('Space title *'));
    await page.keyboard.type(BOARD);
    await tabAndPress(page, popover.getByRole('button', { name: 'Create', exact: true }));

    await expect(page).toHaveURL(/\/b\/\d+$/);
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
  });

  await test.step('2. add a list with the canvas composer', async () => {
    const trigger = page.getByRole('button', { name: /^Add (a|another) list$/ });
    if (await trigger.isVisible()) await tabAndPress(page, trigger);

    const field = page.getByLabel('List title');
    await expect(field).toBeFocused();
    await page.keyboard.type(LIST);
    await page.keyboard.press('Enter');

    await expect(column(page, LIST)).toBeVisible();
    // The composer stays open with an empty field (Section 2.4.4); Escape closes it.
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
  });

  await test.step('3. add a card to that list', async () => {
    const list = column(page, LIST);
    await tabAndPress(page, list.getByRole('button', { name: 'Add a card' }));

    const field = page.getByLabel('Card title');
    await expect(field).toBeFocused();
    await page.keyboard.type(CARD);
    await page.keyboard.press('Enter');

    await expect(list.getByRole('link', { name: CARD })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
  });

  await test.step('4. open the card: one tab stop, and Enter follows the link', async () => {
    await tabAndPress(page, column(page, LIST).getByRole('link', { name: CARD }));
    await expect(page).toHaveURL(/\/c\/\d+$/);
    await expect(page.getByRole('dialog', { name: CARD })).toBeVisible();
  });

  await test.step('5. attach a label from the sidebar', async () => {
    const modal = page.getByRole('dialog', { name: CARD });
    const sidebarRow = modal.getByRole('button', { name: 'Labels', exact: true });
    await tabAndPress(page, sidebarRow);

    const labels = page.getByRole('dialog', { name: 'Labels' });
    await expect(labels).toBeVisible();

    const chip = labels.getByRole('button', { name: `Label ${LABEL}`, exact: true });
    await tabAndPress(page, chip, 'Space');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);
    await expect(modal.locator('#card-labels-label')).toBeVisible();
    // Section 5.10: the popover hands the focus back to the row that opened it, so the next
    // Tab carries on from there instead of restarting at the top of the document.
    await expect(sidebarRow).toBeFocused();
  });

  await test.step('6. Escape unwinds to the board and the tile carries the chip', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: CARD })).toHaveCount(0);
    await expect(page).toHaveURL(/\/b\/\d+$/);

    const tile = column(page, LIST).getByRole('link', { name: CARD }).locator('xpath=..');
    await expect(tile.getByRole('button', { name: `Label ${LABEL}`, exact: true })).toBeVisible();
  });
});
