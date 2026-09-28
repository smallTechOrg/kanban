import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M2 golden path of Section 7.2: open a board, add cards with Enter, drag a card across
 * lists, reorder a list, and prove both survive a reload.
 *
 * The drags are driven through the **keyboard** sensor rather than synthesised mouse moves.
 * Section 2.7 makes the keyboard contract part of the feature (Tab focuses a handle, Space
 * lifts, arrows move, Space drops), so this exercises a documented path instead of a
 * pointer-event approximation, and it is deterministic: `@hello-pangea/dnd` snaps to whole
 * slots on an arrow key, while a mouse drag depends on measured element boxes mid-animation.
 *
 * One serial test, because every step builds on the board the one before it created.
 *
 * The Section 7.2 case "a drop while a filter hides two cards lands in the right slot" is not
 * here: `FilterPopover` is M4. `lib/boardDnd.test.ts` already covers the neighbour computation
 * that case exists to protect, because `moveFromDrop` reads the destination order from the
 * cache rather than from the DOM, so a hidden tile cannot shift the result.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const TODO_LIST = 'To Do';
const DOING = 'Doing';
const DONE = 'Done';

const BOARD = 'DnD checkpoint';

/** A fresh account per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Dana Ortiz',
  email: `dana_${suffix}@example.com`,
  username: `dana_${suffix}`,
  password: 'correct-horse-battery',
};

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/**
 * A card's drag handle: the tile's `<a>`, which carries `dragHandleProps` (CLAUDE.md section 8).
 * Scoped to a column so the same title in two lists is never ambiguous.
 */
function cardHandle(page: Page, listName: string, title: string): Locator {
  return column(page, listName).getByRole('link', { name: title, exact: true });
}

/**
 * A column's drag handle: `ListHeader` spreads `dragHandleProps` onto its own root, which is a
 * direct child of the `<section>`. The `>` matters — every card handle carries the same
 * attribute further down the same subtree.
 */
function listHandle(page: Page, name: string): Locator {
  return column(page, name).locator('> div[data-rfd-drag-handle-draggable-id]');
}

/** The card titles of one column, in the order the DOM paints them. */
async function cardTitles(page: Page, listName: string): Promise<string[]> {
  return column(page, listName).getByRole('link').allInnerTexts();
}

/** Every column's name, left to right. */
async function listNames(page: Page): Promise<string[]> {
  return page
    .locator('section[aria-label]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
}

/** Add cards to one column through its composer, which stays open between Enters (2.4.4). */
async function addCards(page: Page, listName: string, titles: string[]): Promise<void> {
  const list = column(page, listName);
  await list.getByRole('button', { name: 'Add a card' }).click();
  const input = list.getByLabel('Card title');
  await expect(input).toBeFocused();

  for (const title of titles) {
    await input.fill(title);
    await input.press('Enter');
    await expect(list.getByRole('link', { name: title, exact: true })).toBeVisible();
    // Section 2.4.4: Enter submits and leaves the composer open with an empty field, so the
    // next title is typed straight into it. A cleared field is what "no flicker" looks like
    // from the outside: the composer never unmounted between the three cards.
    await expect(input).toHaveValue('');
  }

  await input.press('Escape');
  await expect(input).toHaveCount(0);
}

/**
 * Lift `handle`, press `key` `steps` times, drop.
 *
 * The library moves on `keydown` and animates between slots, so each press is followed by a
 * short settle; without it a second arrow can arrive while the first is still in flight and be
 * dropped. The announcement is read back after the lift so a silent failure to lift shows up
 * here rather than as a confusing order assertion three lines later.
 */
async function keyboardDrag(
  page: Page,
  handle: Locator,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  steps = 1,
): Promise<void> {
  await handle.focus();
  await expect(handle).toBeFocused();

  await handle.press(' ');
  await expect(page.locator('[id^="rfd-announcement"]')).toContainText('You have lifted an item');

  for (let step = 0; step < steps; step += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }

  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
}

test.describe.configure({ mode: 'serial' });

test('M2: add cards, drag a card across lists, reorder a list, reload', async ({ page }) => {
  await test.step('1. register and land on Home', async () => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(user.fullName);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page).toHaveURL('http://127.0.0.1:8020/');
  });

  await test.step('2. create a board with the three default lists', async () => {
    await page.getByRole('button', { name: 'Create new board' }).click();
    const popover = page.getByRole('dialog', { name: 'Create board' });
    await expect(popover.getByLabel('Start with default lists')).toBeChecked();
    await popover.getByLabel('Board title *').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/b\/\d+$/);
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    expect(await listNames(page)).toEqual([TODO_LIST, DOING, DONE]);
  });

  await test.step('3. add cards with Enter, Enter, Enter', async () => {
    await addCards(page, TODO_LIST, ['Alpha', 'Beta', 'Gamma']);
    expect(await cardTitles(page, TODO_LIST)).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Doing gets a card of its own before the cross-list drag. This is not incidental: the
    // library picks a cross-axis droppable by box geometry, and an empty `CardList` is only
    // the 6px floor of Section 2.4.5 — too short to overlap the dragged card on the main
    // axis, so ArrowRight would find no destination and the drag would silently stay put.
    // A populated destination is also the more interesting move: Alpha has to land at a
    // specific index next to Delta, which is what the neighbour half of the move contract
    // (Section 4.9) decides.
    await addCards(page, DOING, ['Delta']);
    expect(await cardTitles(page, DOING)).toEqual(['Delta']);
  });

  await test.step('4. drag Alpha from To Do into Doing, below Delta', async () => {
    // ArrowDown takes Alpha to slot 2 of To Do, then ArrowRight carries it into Doing at the
    // same slot, which is below Delta.
    await keyboardDrag(page, cardHandle(page, TODO_LIST, 'Alpha'), 'ArrowDown');
    await keyboardDrag(page, cardHandle(page, TODO_LIST, 'Alpha'), 'ArrowRight');

    await expect(cardHandle(page, DOING, 'Alpha')).toBeVisible();
    expect(await cardTitles(page, TODO_LIST)).toEqual(['Beta', 'Gamma']);
    expect(await cardTitles(page, DOING)).toEqual(['Delta', 'Alpha']);
  });

  await test.step('5. reorder inside To Do: Beta below Gamma', async () => {
    await keyboardDrag(page, cardHandle(page, TODO_LIST, 'Beta'), 'ArrowDown');
    expect(await cardTitles(page, TODO_LIST)).toEqual(['Gamma', 'Beta']);
  });

  await test.step('6. the card moves persist across a reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();

    // The board is re-read from GET /api/boards/{id}, so these orders are the server's
    // `position` values, not the optimistic splice from steps 4 and 5.
    expect(await cardTitles(page, DOING)).toEqual(['Delta', 'Alpha']);
    expect(await cardTitles(page, TODO_LIST)).toEqual(['Gamma', 'Beta']);
  });

  await test.step('7. drag Done to the first position', async () => {
    await keyboardDrag(page, listHandle(page, DONE), 'ArrowLeft', 2);
    expect(await listNames(page)).toEqual([DONE, TODO_LIST, DOING]);
  });

  await test.step('8. the list order persists across a reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    expect(await listNames(page)).toEqual([DONE, TODO_LIST, DOING]);

    // The cards travelled with their columns.
    expect(await cardTitles(page, DOING)).toEqual(['Delta', 'Alpha']);
    expect(await cardTitles(page, TODO_LIST)).toEqual(['Gamma', 'Beta']);
  });
});
