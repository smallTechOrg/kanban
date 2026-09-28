import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * M4b end to end (Section 7.2's M4, board half): the filter and its URL mirror, a drag while the
 * filter hides cards, top-bar search, the `B` boards popover, the `?` cheat sheet, a card
 * shortcut, the board menu drawer with its activity feed and archived-items panel, and realtime.
 *
 * One serial journey on one board, because every step reads what the step before it left behind:
 * the filter that step 2 sets is what makes step 3's drop interesting, and the activity feed of
 * step 8 asserts the sentences for the actions steps 1-7 actually performed.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const TODO = 'To Do';
const DOING = 'Doing';

const BOARD = 'M4b menu board';

/** Four cards in `To Do`: two carry the green label, one a due date and me as a member. */
const ALPHA = 'Filter alpha';
const BETA = 'Filter beta';
const GAMMA = 'Filter gamma';
const DELTA = 'Filter delta';

const SCREENSHOT = 'docs/audit/screens/m4b-board.png';

/** Section 7.2: the second window shows the first window's write within a second. */
const WITHIN_A_SECOND = 1_500;

const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Nadia Farouk',
  email: `nadia_${suffix}@example.com`,
  username: `nadia_${suffix}`,
  password: 'correct-horse-battery',
};

function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/** The whole tile behind a card link: the chips, badges and avatars are the anchor's siblings. */
function tile(page: Page, title: string): Locator {
  return page.getByRole('link', { name: title, exact: true }).locator('xpath=..');
}

/** The card titles of one column, in the order the DOM paints them, hidden tiles excluded. */
async function visibleTitles(page: Page, list: string): Promise<string[]> {
  return column(page, list).getByRole('link').allInnerTexts();
}

/**
 * Point at a card the way a reader does. The mouse is parked elsewhere first because a tile that
 * appears *under* a stationary pointer gets no `mouseover` at all, so `uiStore.hoveredCardId` —
 * and with it "the current card" of Section 2.8 — would still be empty while CSS `:hover` matched.
 */
async function hoverCard(page: Page, title: string): Promise<void> {
  await page.mouse.move(4, 400);
  await tile(page, title).hover();
}

async function addCard(page: Page, list: string, title: string): Promise<void> {
  const target = column(page, list);
  await target.getByRole('button', { name: 'Add a card' }).click();
  const input = target.getByLabel('Card title');
  await input.fill(title);
  await input.press('Enter');
  await input.press('Escape');
  await expect(target.getByRole('link', { name: title, exact: true })).toBeVisible();
}

/**
 * A pointer drag of one tile onto another's slot: the reader's own gesture, which is what step 3
 * has to exercise — the keyboard sensor steps through the full order and would never notice a
 * hidden run, while a mouse drop is decided by measured boxes and is exactly where a collapsed
 * `display: none` Draggable could send the index to the wrong slot (risk 15 in Section 7.5).
 *
 * The first small move is what starts the lift (the sensor waits for 5px), and the last move is
 * repeated so the library has a frame to settle the displacement before the release. Only the
 * drop is asserted from the `aria-live` region: every announcement before it is replaced by the
 * next one within a frame, so reading an intermediate one is a race.
 */
async function dragTileOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('a tile in this drag has no box');

  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 8, { steps: 4 });
  await page.waitForTimeout(200);

  const endX = to.x + to.width / 2;
  const endY = to.y + 2;
  await page.mouse.move(endX, endY, { steps: 16 });
  await page.mouse.move(endX, endY, { steps: 2 });
  await page.mouse.up();
  await expect(page.locator('[id^="rfd-announcement"]')).toContainText('You have dropped the item');
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

/** Tomorrow as the `type="date"` input spells it, so the due badge is "due soon" and not overdue. */
function tomorrow(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

test.describe.configure({ mode: 'serial' });

test('M4b: filter, search, shortcuts, the board menu and realtime', async ({ page, browser }) => {
  let boardPath = '';

  await test.step('1. register, create a board with four cards, labels, a due date and me', async () => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(user.fullName);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign up' }).click();

    await page.getByRole('button', { name: 'Create new board' }).click();
    const create = page.getByRole('dialog', { name: 'Create board' });
    await create.getByLabel('Board title').fill(BOARD);
    await create.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/b\/\d+$/);
    boardPath = new URL(page.url()).pathname;

    for (const title of [ALPHA, BETA, GAMMA, DELTA]) await addCard(page, TODO, title);

    // `1` toggles the board's first label (Section 2.8): the green one of the six a new board
    // is seeded with, whose chip names its colour key because it has no name yet (2.5.2).
    for (const title of [ALPHA, GAMMA]) {
      await hoverCard(page, title);
      await page.keyboard.press('1');
      await expect(tile(page, title).getByTitle('green')).toBeVisible();
    }

    // `D` opens the Dates popover on the hovered tile, `Space` assigns me to it.
    await hoverCard(page, DELTA);
    await page.keyboard.press('d');
    const dates = page.getByRole('dialog', { name: 'Dates' });
    await expect(dates).toBeVisible();
    await dates.getByLabel('Due date', { exact: true }).first().check();
    await dates.getByRole('textbox', { name: 'Due date' }).fill(tomorrow());
    await dates.getByRole('button', { name: 'Save' }).click();
    await expect(dates).toHaveCount(0);

    await hoverCard(page, DELTA);
    await page.keyboard.press(' ');
    await expect(tile(page, DELTA).locator(`[aria-label="${user.fullName}"]`)).toBeVisible();

    expect(await visibleTitles(page, TODO)).toEqual([ALPHA, BETA, GAMMA, DELTA]);
  });

  await test.step('2. the Filter popover hides the cards without the label, and the URL keeps it', async () => {
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    const filter = page.getByRole('dialog', { name: 'Filter' });
    await expect(filter).toBeVisible();
    await filter.getByRole('checkbox', { name: 'green' }).check();

    // The panel is a focus trap, so the board behind it is inert while it is open (2.1.2): what
    // the filter did to the canvas is read after Escape has closed it.
    await page.keyboard.press('Escape');
    await expect(filter).toHaveCount(0);

    await expect(page.getByRole('button', { name: '1 filter' })).toBeVisible();
    expect(await visibleTitles(page, TODO)).toEqual([ALPHA, GAMMA]);
    // Section 2.4.2: the count in the list header reads matched/total while a filter is active.
    await expect(column(page, TODO).getByText('2/4')).toBeVisible();
    await expect(page).toHaveURL(/\?labels=\d+$/);

    const filtered = page.url();
    await page.reload();
    await expect(page).toHaveURL(filtered);
    await expect(page.getByRole('button', { name: '1 filter' })).toBeVisible();
    expect(await visibleTitles(page, TODO)).toEqual([ALPHA, GAMMA]);
  });

  await test.step('3. a drop while two cards are hidden lands where it was dropped', async () => {
    await dragTileOnto(page, tile(page, GAMMA), tile(page, ALPHA));
    expect(await visibleTitles(page, TODO)).toEqual([GAMMA, ALPHA]);

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
    // The hidden cards never moved, and the card the reader dragged is where they left it.
    expect(await visibleTitles(page, TODO)).toEqual([GAMMA, ALPHA, BETA, DELTA]);
  });

  await test.step('4. "/" searches, the arrows walk the rows and Enter opens the card', async () => {
    await page.mouse.move(0, 0);
    await page.keyboard.press('/');
    const search = page.getByRole('textbox', { name: 'Search' });
    await expect(search).toBeFocused();
    await page.keyboard.type('beta');

    const row = page.getByRole('button', { name: new RegExp(BETA) });
    await expect(row).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog', { name: BETA })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${boardPath}/c/\\d+$`));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: BETA })).toHaveCount(0);
  });

  await test.step('5. "B" opens the boards popover with Recent and Starred', async () => {
    await page.keyboard.press('b');
    const boards = page.getByRole('dialog', { name: 'Boards' });
    await expect(boards).toBeVisible();
    await expect(boards.getByRole('heading', { name: 'Recent' })).toBeVisible();
    await expect(boards.getByRole('heading', { name: 'Starred' })).toBeVisible();
    await expect(boards.getByLabel('Filter boards')).toBeVisible();
    await expect(boards.getByRole('button', { name: BOARD, exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(boards).toHaveCount(0);
  });

  await test.step('6. "?" opens the cheat sheet and Escape closes it', async () => {
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Open the Filter popover')).toBeVisible();
    await expect(sheet.getByText('Archive the card')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  await test.step('7. Space on a hovered tile assigns me to it', async () => {
    const avatar = tile(page, BETA).locator(`[aria-label="${user.fullName}"]`);
    await expect(avatar).toHaveCount(0);

    await hoverCard(page, BETA);
    await page.keyboard.press(' ');
    await expect(avatar).toBeVisible();
  });

  await test.step('8. the board menu reads back what happened, and restores an archived card', async () => {
    await hoverCard(page, DELTA);
    await page.keyboard.press('c');
    await expect(column(page, TODO).getByRole('link', { name: DELTA })).toHaveCount(0);

    await page.getByRole('button', { name: 'Show menu' }).click();
    const drawer = page.getByRole('complementary', { name: 'Menu' });
    await expect(drawer.getByRole('heading', { name: 'Menu' })).toBeVisible();

    await drawer.getByRole('button', { name: 'Activity' }).click();
    await expect(drawer.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(drawer.getByText(`added ${ALPHA} to ${TODO}`)).toBeVisible();
    await expect(drawer.getByText('added the green label to this card').first()).toBeVisible();
    await expect(drawer.getByText('archived this card')).toBeVisible();
    await expect(drawer.getByText('created this board')).toBeVisible();
    await expect(drawer.getByText(user.fullName).first()).toBeVisible();

    await drawer.getByRole('button', { name: 'Back' }).click();
    await drawer.getByRole('button', { name: 'Archived items' }).click();
    await expect(drawer.getByRole('heading', { name: 'Archived items' })).toBeVisible();
    await expect(drawer.getByText(DELTA)).toBeVisible();

    await drawer.getByRole('button', { name: 'Send to board' }).click();
    await expect(drawer.getByText('No archived cards')).toBeVisible();
    await expect(column(page, TODO).getByRole('link', { name: DELTA })).toBeVisible();
    // The restore puts the card back in its own slot, which is the one it left (Section 2.3.4).
    expect(await visibleTitles(page, TODO)).toEqual([GAMMA, ALPHA, BETA, DELTA]);
  });

  await test.step('9. a second window on the same board follows a move within a second', async () => {
    const second = await browser.newContext();
    const watcher = await signIn(second);
    await watcher.goto(boardPath);
    await expect(column(watcher, TODO).getByRole('link', { name: BETA })).toBeVisible();

    await page.bringToFront();
    await hoverCard(page, BETA);
    await page.keyboard.press('.');
    await expect(column(page, DOING).getByRole('link', { name: BETA })).toBeVisible();

    await expect(column(watcher, DOING).getByRole('link', { name: BETA })).toBeVisible({
      timeout: WITHIN_A_SECOND,
    });
    await expect(column(watcher, TODO).getByRole('link', { name: BETA })).toHaveCount(0);

    await second.close();
  });
  await test.step('10. screenshot the board with the drawer open', async () => {
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Menu', exact: true })).toBeVisible();
    await page.screenshot({ path: SCREENSHOT, fullPage: false });
    await page.getByRole('button', { name: 'Close menu' }).click();
  });

});
