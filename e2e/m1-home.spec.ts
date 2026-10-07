import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M1 golden path of Section 7.2: land on Home, create a board with a chosen background, and
 * create a second board with a different background.
 *
 * One serial test, because every step builds on the board the one before it created.
 */

/** `meta.board_colors.moss` = #3E6B4B, the background the Section 7.2 demo asks for. */
const MOSS = 'rgb(62, 107, 75)';

/** `meta.board_colors.plum` = #6B3F82, the second board's background. */
const PLUM = 'rgb(107, 63, 130)';

/**
 * A fresh board name per run, so the spec also passes against a database that is not empty.
 *
 * With no accounts there is nothing else to isolate a run with: every spec writes into the one
 * dataset, so a board is found by a name only this run can have used.
 */
const suffix = `${Date.now()}`.slice(-9);
const FIRST_BOARD = `Sprint 42 ${suffix}`;
const SECOND_BOARD = `Design system ${suffix}`;

/**
 * The 96px tile for `name`: the link's parent paints the background.
 *
 * The home page is one flat grid of every board (Section 2.2), so a name appears exactly once
 * and no section has to be named to find it.
 */
function tile(page: Page, name: string): Locator {
  return page.getByRole('link', { name, exact: true }).locator('..');
}

async function createBoard(page: Page, name: string, swatch: string): Promise<void> {
  await page.getByRole('button', { name: 'Create new space' }).click();

  const popover = page.getByRole('dialog', { name: 'Create space' });
  await expect(popover).toBeVisible();

  // Section 2.2.1 item 6: Create stays disabled until the title holds a non-space character.
  await expect(popover.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();

  await popover.getByRole('button', { name: swatch }).click();
  await expect(popover.getByRole('button', { name: swatch })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await popover.getByLabel('Space title *').fill(name);
  await popover.getByRole('button', { name: 'Create', exact: true }).click();

  // Section 2.2.1 item 6: on success it navigates to the new board.
  await expect(page).toHaveURL(/\/b\/\d+$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Back to `/` through the nav, which is client-side routing, not a page load. */
async function goHome(page: Page): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Spaces', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:8020/');
}

test.describe.configure({ mode: 'serial' });

test('M1: home page and creating boards', async ({ page }) => {
  await test.step('1. / is the home page: the nav, the greeting and the grid', async () => {
    await page.goto('/');
    await expect(page).toHaveURL('http://127.0.0.1:8020/');

    // The nav of Section 2.1.1 renders on every width, and it is "Boards" and "Create": there
    // is no Recent or Starred dropdown, because one person's boards are one list.
    await expect(page.locator('header').getByRole('link', { name: 'My Day' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Recent' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('button', { name: 'Starred' })).toHaveCount(0);

    // Section 2.2: the page greets the reader instead of heading the one list on it.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^Good (morning|afternoon|evening)$/,
    );
    for (const heading of ['Starred boards', 'Recently viewed', 'Your boards', 'Your spaces']) {
      await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Create new space' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View all closed spaces' })).toBeVisible();

    // Section 2.2: the page is the 1128px centred column (the 1280px viewport is wider), and
    // `BoardsGrid` is `repeat(auto-fill, minmax(194px, 1fr))`. Both break at once if the page
    // shrink-wraps its content instead.
    expect((await page.locator('main').boundingBox())?.width).toBe(1128);
  });

  await test.step('2. create "Sprint 42" on the moss background', async () => {
    await createBoard(page, FIRST_BOARD, 'Moss background');
  });

  await test.step('3. the tile appears in the grid with that background', async () => {
    await goHome(page);
    const sprint = tile(page, FIRST_BOARD);
    await expect(sprint).toBeVisible();
    await expect(sprint).toHaveCSS('background-color', MOSS);
    // One flat list: the board is on the page exactly once, with no star to toggle.
    await expect(page.getByRole('link', { name: FIRST_BOARD, exact: true })).toHaveCount(1);
    await expect(sprint.getByRole('button')).toHaveCount(0);
  });

  await test.step('4. the tile survives a reload', async () => {
    await page.reload();
    const sprint = tile(page, FIRST_BOARD);
    await expect(sprint).toBeVisible();
    await expect(sprint).toHaveCSS('background-color', MOSS);
  });

  await test.step('5. create a second board with a different background', async () => {
    await createBoard(page, SECOND_BOARD, 'Plum background');
    await goHome(page);

    const design = tile(page, SECOND_BOARD);
    await expect(design).toBeVisible();
    await expect(design).toHaveCSS('background-color', PLUM);
    // Both of this run's boards sit in the one grid, asserted by name rather than by counting
    // it, which also holds whatever the specs before this one created.
    await expect(page.getByRole('link', { name: FIRST_BOARD, exact: true })).toBeVisible();
  });

  await test.step('6. screenshot the home page', async () => {
    await page.mouse.move(0, 0);
    // Section 2.2: the tiles rise into place over 0.32s plus their stagger. A release
    // screenshot taken mid-entrance shows half-faded tiles, which reads as a rendering fault
    // rather than as the animation it is, so the shot waits for the last of them to land.
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState === 'finished'),
    );
    await page.screenshot({ path: 'docs/audit/screens/m1-home.png', fullPage: true });
  });
});
