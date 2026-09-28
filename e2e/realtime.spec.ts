import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Realtime, end to end (Section 7.2's M4 `realtime.spec.ts`): two browser contexts on the same
 * board, where a write in one appears in the other within a second over `GET /api/boards/{id}/events`.
 *
 * The second context is the same signed-in user rather than a second member, because what is under
 * test is the SSE stream and the version-gated invalidation of Section 4.8 — not permissions — and
 * a board's own member list is irrelevant to either.
 */

const FIRST_LIST = 'To Do';
const SECOND_LIST = 'Doing';

const BOARD = 'M4b realtime';
const CARD = 'Realtime card';
const RENAMED = 'Realtime card renamed';

/** The tile behind a card link: its chips, badges and avatars are the anchor's siblings. */
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

/** Section 7.2: the second window shows the first window's move within a second. */
const WITHIN_A_SECOND = 1_500;

const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Ada Nwosu',
  email: `ada_${suffix}@example.com`,
  username: `ada_${suffix}`,
  password: 'correct-horse-battery',
};

function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

async function signIn(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(user.username);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Create new board' })).toBeVisible();
  return page;
}

test.describe.configure({ mode: 'serial' });

test('M4b: a second window follows the first within a second', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const author = await first.newPage();

  await test.step('register, create a board with one card', async () => {
    await author.goto('/register');
    await author.getByLabel('Full name').fill(user.fullName);
    await author.getByLabel('Email').fill(user.email);
    await author.getByLabel('Username').fill(user.username);
    await author.getByLabel('Password').fill(user.password);
    await author.getByRole('button', { name: 'Sign up' }).click();

    await author.getByRole('button', { name: 'Create new board' }).click();
    const popover = author.getByRole('dialog', { name: 'Create board' });
    await popover.getByLabel('Board title').fill(BOARD);
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
  const watcher = await signIn(second);

  await test.step('the watcher opens the same board and sees the card', async () => {
    await watcher.goto(boardPath);
    await expect(column(watcher, FIRST_LIST).getByRole('link', { name: CARD })).toBeVisible();
  });

  await test.step('a move in the first window arrives in the second within a second', async () => {
    // Two windows are open, so the one being typed into is brought to the front first.
    await author.bringToFront();
    await hoverCard(author, CARD);
    await author.keyboard.press('.');
    await expect(column(author, SECOND_LIST).getByRole('link', { name: CARD })).toBeVisible();

    await expect(column(watcher, SECOND_LIST).getByRole('link', { name: CARD })).toBeVisible({
      timeout: WITHIN_A_SECOND,
    });
    await expect(column(watcher, FIRST_LIST).getByRole('link', { name: CARD })).toHaveCount(0);
  });

  await test.step('a rename in the second window arrives in the first', async () => {
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

  await first.close();
  await second.close();
});
