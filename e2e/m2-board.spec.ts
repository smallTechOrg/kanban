import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M2 checkpoint of Section 7.2, driven the way a person drives it: every drag is a real
 * pointer gesture (`mouse.down`, a nudge past the library's 5px sloppy-click threshold, a
 * stream of intermediate `mouse.move`s, `mouse.up`), because `@hello-pangea/dnd` recalculates
 * the destination from the dragged element's box on every move event and a single jump would
 * never produce one.
 *
 * `e2e/board-dnd.spec.ts` covers the same two moves through the keyboard sensor. Both exist on
 * purpose: the keyboard path snaps to whole slots and proves the announcements, while this one
 * proves the geometry a mouse actually produces — including that the natural grab point of a
 * column (its title) lifts the column at all.
 *
 * One serial test, because every step builds on the board the one before it created.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';
const DOING = 'Doing';
const DONE = 'Done';

/** Step 2 renames the first list, so every later step refers to that column by its new name. */
const RENAMED = 'Backlog';

/** A fresh board name per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `M2 checkpoint ${suffix}`;
const NEW_LIST = 'Ship it';

/** Typed in this order, so step 6's alphabetical sort has something to change. */
const CARDS = ['Write docs', 'Fix login', 'Pick colours'] as const;

/** The middle card of `CARDS`: the one that crosses into Doing in step 4. */
const MIDDLE = CARDS[1];

/** The two cards left in the first column after step 4, in alphabetical order. */
const SORTED = ['Pick colours', 'Write docs'];

interface Point {
  x: number;
  y: number;
}

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/** The scrolling card region of a column, which is the list's `type="CARD"` droppable. */
function cardRegion(page: Page, listName: string): Locator {
  return column(page, listName).locator('.cardList');
}

/**
 * A card's drag handle: the tile's `<a>`, which carries `dragHandleProps` (CLAUDE.md section 8).
 * Scoped to a column so the same title in two lists is never ambiguous.
 */
function cardHandle(page: Page, listName: string, title: string): Locator {
  return column(page, listName).getByRole('link', { name: title, exact: true });
}

/**
 * Where a person grabs a column: the list title inside its header. The whole header is the drag
 * handle (Section 2.4.2) and the title is the part of it the eye goes to, so this is the grab
 * point the feature has to support.
 */
function listGrab(page: Page, name: string): Locator {
  return column(page, name).getByRole('button', { name: `Rename list ${name}` });
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

/**
 * The card order of one column, retried until it matches.
 *
 * Only the two composers and the two drags are optimistic; "Sort by…" and the archive rows of
 * the list menu repaint when their response lands, so a bare `expect(...).toEqual` would race
 * the request rather than test it.
 */
async function expectCards(page: Page, listName: string, titles: readonly string[]): Promise<void> {
  await expect.poll(() => cardTitles(page, listName)).toEqual([...titles]);
}

/** The column order, retried until it matches. */
async function expectLists(page: Page, names: readonly string[]): Promise<void> {
  await expect.poll(() => listNames(page)).toEqual([...names]);
}

async function boxOf(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element is not rendered, so it has no box');
  return box;
}

async function centreOf(locator: Locator): Promise<Point> {
  const box = await boxOf(locator);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The point that drops a card at slot 0 of a list: the top of its card region. An empty region
 * is only the 6px floor of Section 2.4.5, so the dragged tile has to straddle that band for
 * the library to see any overlap with the droppable at all.
 */
async function topOfList(page: Page, listName: string): Promise<Point> {
  const box = await boxOf(cardRegion(page, listName));
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height, 8) / 2 };
}

/**
 * Drag from `from` to `to` with a real pointer.
 *
 * The first move only clears the 5px sloppy-click threshold, which is what makes the library
 * lift the item, and the announcement is read back there so a gesture that never lifted fails
 * here rather than three lines later as a confusing order assertion. The rest is 18 increments
 * with a frame of breathing room each, because the destination is recalculated on a
 * `requestAnimationFrame` after every move event.
 */
async function dragWithMouse(page: Page, from: Point, to: Point): Promise<void> {
  const announcement = page.locator('[id^="rfd-announcement"]');

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 8, { steps: 4 });
  await expect(announcement).toContainText('You have lifted an item');

  const steps = 18;
  const lifted: Point = { x: from.x, y: from.y + 8 };
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      lifted.x + ((to.x - lifted.x) * step) / steps,
      lifted.y + ((to.y - lifted.y) * step) / steps,
    );
    await page.waitForTimeout(25);
  }

  // Settle on the final position so the drop reads it, then drop and let the flip animation end.
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect(announcement).not.toContainText('You have lifted an item');
  await page.waitForTimeout(350);
}

/** The "List actions" popover of one column, already open. */
async function openListMenu(page: Page, listName: string): Promise<Locator> {
  await column(page, listName).getByRole('button', { name: 'List actions' }).click();
  const menu = page.getByRole('dialog', { name: 'List actions' });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe.configure({ mode: 'serial' });

test('M2: board page, composers, mouse drag-and-drop, list menu', async ({ page }) => {
  await test.step('1. create a board with the default lists', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create new board' }).click();
    const popover = page.getByRole('dialog', { name: 'Create board' });
    await expect(popover.getByLabel('Start with default lists')).toBeChecked();
    await popover.getByLabel('Board title *').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/b\/\d+$/);
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();

    // Section 3.10: `default_lists` is To Do, Doing, Done, in that order.
    await expectLists(page, [FIRST_LIST, DOING, DONE]);
    await expect(page).toHaveTitle(`${BOARD} | My Day`);
  });

  await test.step('2. rename the first list inline; the name survives a reload', async () => {
    await listGrab(page, FIRST_LIST).click();
    const editor = page.getByLabel(`Rename list ${FIRST_LIST}`);
    await expect(editor).toBeFocused();
    await editor.fill(RENAMED);
    await editor.press('Enter');

    await expect(column(page, RENAMED)).toBeVisible();
    await expect(column(page, FIRST_LIST)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expectLists(page, [RENAMED, DOING, DONE]);
  });

  await test.step('3. three cards with Enter, Enter, Enter in one composer', async () => {
    const list = column(page, RENAMED);
    await list.getByRole('button', { name: 'Add a card' }).click();
    const input = list.getByLabel('Card title');
    await expect(input).toBeFocused();

    for (const title of CARDS) {
      await input.fill(title);
      await input.press('Enter');
      // Section 2.4.4: Enter submits and leaves the composer open with an empty focused field,
      // so the next title is typed straight into it. The composer never unmounted.
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(cardHandle(page, RENAMED, title)).toBeVisible();
    }

    await expectCards(page, RENAMED, CARDS);

    // No duplicate or flicker artefact: the optimistic tile and the server's row are one tile
    // (it keys on `client_id`), so each title exists exactly once and the column holds three.
    for (const title of CARDS) {
      await expect(cardHandle(page, RENAMED, title)).toHaveCount(1);
    }
    await expect(list.getByRole('link')).toHaveCount(CARDS.length);
    await expect(list.getByText(String(CARDS.length), { exact: true })).toBeVisible();

    await input.press('Escape');
    await expect(input).toHaveCount(0);

    // A reload reads the rows the server actually stored, so this is also the proof that three
    // POSTs landed rather than three optimistic tiles over fewer rows.
    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expectCards(page, RENAMED, CARDS);
  });

  await test.step(`4. drag "${MIDDLE}" to the top of ${DOING}, then reload`, async () => {
    await dragWithMouse(
      page,
      await centreOf(cardHandle(page, RENAMED, MIDDLE)),
      await topOfList(page, DOING),
    );

    await expect(cardHandle(page, DOING, MIDDLE)).toBeVisible();
    await expectCards(page, DOING, [MIDDLE]);
    await expectCards(page, RENAMED, [CARDS[0], CARDS[2]]);

    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    // Read back from GET /api/boards/{id}: the server's `position` values, not the optimistic
    // splice of the drop.
    await expectCards(page, DOING, [MIDDLE]);
    await expectCards(page, RENAMED, [CARDS[0], CARDS[2]]);
  });

  await test.step(`5. drag ${DONE} to the first position, then reload`, async () => {
    const target = await centreOf(listGrab(page, RENAMED));
    await dragWithMouse(page, await centreOf(listGrab(page, DONE)), target);

    await expectLists(page, [DONE, RENAMED, DOING]);

    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expectLists(page, [DONE, RENAMED, DOING]);
    // The cards travelled with their columns.
    await expectCards(page, RENAMED, [CARDS[0], CARDS[2]]);
    await expectCards(page, DOING, [MIDDLE]);
  });

  await test.step('6. sort the list by card name from the list menu', async () => {
    // The two cards are in creation order, which is the reverse of alphabetical, so the sort
    // has something to change.
    await expectCards(page, RENAMED, [CARDS[0], CARDS[2]]);

    const menu = await openListMenu(page, RENAMED);
    await menu.getByRole('button', { name: 'Sort by…' }).click();
    const sort = page.getByRole('dialog', { name: 'Sort by' });
    await sort.getByRole('button', { name: 'Card name (alphabetically)' }).click();
    await expect(sort).toHaveCount(0);

    await expectCards(page, RENAMED, SORTED);

    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expectCards(page, RENAMED, SORTED);
  });

  await test.step('7. archive all cards in the list, then Undo from the toast', async () => {
    const menu = await openListMenu(page, RENAMED);
    await menu.getByRole('button', { name: 'Archive all cards in this list…' }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive all cards in this list?' });
    await confirm.getByRole('button', { name: 'Archive all' }).click();

    await expect(column(page, RENAMED).getByRole('link')).toHaveCount(0);

    const toast = page.getByRole('status').filter({ hasText: '2 cards archived' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();

    await expectCards(page, RENAMED, SORTED);

    // Section 2.5.5: archived rows keep their `position`, so the undo is not a re-append.
    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expectCards(page, RENAMED, SORTED);
  });

  await test.step('8. add a list with the composer; it lands at the end', async () => {
    await page.getByRole('button', { name: 'Add another list' }).click();
    const input = page.getByLabel('List title');
    await expect(input).toBeFocused();
    await input.fill(NEW_LIST);
    await input.press('Enter');

    await expect(column(page, NEW_LIST)).toBeVisible();
    await expectLists(page, [DONE, RENAMED, DOING, NEW_LIST]);

    await input.press('Escape');
    await expect(input).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expectLists(page, [DONE, RENAMED, DOING, NEW_LIST]);
  });

  await test.step('9. screenshot the board', async () => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: 'docs/audit/screens/m2-board.png' });
  });
});
