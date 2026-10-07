import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Realtime, end to end (Section 7.2's M4 `realtime.spec.ts`): two tabs on the same board, where a
 * write in one appears in the other within a second over `GET /api/boards/{id}/events`.
 *
 * Two tabs of one browser rather than two people, because that is what realtime is for here: the
 * app has one person in it, and what is under test is the SSE stream and the version-gated
 * invalidation of Section 4.8, which keeps whatever tabs they left open on a board in step.
 */

const FIRST_LIST = 'To Do';
const SECOND_LIST = 'Doing';

/** A fresh board name per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `M4b realtime ${suffix}`;
const CARD = 'Realtime card';
const RENAMED = 'Realtime card renamed';

/** The tile behind a card link: its chip row and its badges are the anchor's siblings. */
function tile(page: Page, title: string): Locator {
  return page.getByRole('link', { name: title, exact: true }).locator('xpath=..');
}

/**
 * Point at a card the way a reader does. The mouse is parked elsewhere first because a tile that
 * appears *under* a stationary pointer (a composer's textarea becoming the new tile, say) gets no
 * `mouseover` at all, so `uiStore.hoveredCardId` — and with it "the current card" of Section 2.8 —
 * would still be empty while CSS `:hover` already matched.
 */
async function hoverCard(page: Page, title: string): Promise<void> {
  await page.mouse.move(4, 400);
  await tile(page, title).hover();
}

/** Section 7.2: the second tab shows the first tab's move within a second. */
const WITHIN_A_SECOND = 1_500;

function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

test.describe.configure({ mode: 'serial' });

test('M4b: a second tab follows the first within a second', async ({ context }) => {
  const author = await context.newPage();

  await test.step('create a board with one card', async () => {
    await author.goto('/');
    await author.getByRole('button', { name: 'Create new space' }).click();
    const popover = author.getByRole('dialog', { name: 'Create space' });
    await popover.getByLabel('Space title').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(author).toHaveURL(/\/b\/\d+$/);

    const list = column(author, FIRST_LIST);
    await list.getByRole('button', { name: 'Add a card' }).click();
    const input = list.getByLabel('Card title');
    await input.fill(CARD);
    await input.press('Enter');
    await input.press('Escape');
    await expect(list.getByRole('link', { name: CARD, exact: true })).toBeVisible();
  });

  const boardPath = new URL(author.url()).pathname;
  const watcher = await context.newPage();

  await test.step('the second tab opens the same board and sees the card', async () => {
    await watcher.goto(boardPath);
    await expect(column(watcher, FIRST_LIST).getByRole('link', { name: CARD })).toBeVisible();
  });

  await test.step('a move in the first tab arrives in the second within a second', async () => {
    // Two tabs are open, so the one being typed into is brought to the front first.
    await author.bringToFront();
    await hoverCard(author, CARD);
    await author.keyboard.press('.');
    await expect(column(author, SECOND_LIST).getByRole('link', { name: CARD })).toBeVisible();

    await expect(column(watcher, SECOND_LIST).getByRole('link', { name: CARD })).toBeVisible({
      timeout: WITHIN_A_SECOND,
    });
    await expect(column(watcher, FIRST_LIST).getByRole('link', { name: CARD })).toHaveCount(0);
  });

  await test.step('a rename in the second tab arrives in the first', async () => {
    await watcher.bringToFront();
    await hoverCard(watcher, CARD);
    await watcher.keyboard.press('e');
    const editor = watcher.getByLabel('Card title');
    await editor.fill(RENAMED);
    await editor.press('Enter');
    await expect(column(watcher, SECOND_LIST).getByRole('link', { name: RENAMED })).toBeVisible();

    await expect(column(author, SECOND_LIST).getByRole('link', { name: RENAMED })).toBeVisible({
      timeout: WITHIN_A_SECOND,
    });
  });

  await watcher.close();
  await author.close();
});
