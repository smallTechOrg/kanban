import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M1 golden path of Section 7.2: land on Home, create a board with a chosen background,
 * star it, and create a second board with a different background.
 *
 * One serial test, because every step builds on the board the one before it created.
 */

/** `meta.board_colors.green` = #519839, the background the Section 7.2 demo asks for. */
const GREEN = 'rgb(81, 152, 57)';

/** `meta.board_colors.purple` = #89609E, the second board's background. */
const PURPLE = 'rgb(137, 96, 158)';

/**
 * A fresh board name per run, so the spec also passes against a database that is not empty.
 *
 * With no accounts there is nothing else to isolate a run with: every spec writes into the one
 * dataset, so a board is found by a name only this run can have used.
 */
const suffix = `${Date.now()}`.slice(-9);
const FIRST_BOARD = `Sprint 42 ${suffix}`;
const SECOND_BOARD = `Design system ${suffix}`;

/** The `BoardsSection` whose heading is `title`, so a tile can be asserted inside it. */
function section(page: Page, title: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title }) });
}

/**
 * The section that owns the create tile: its grid holds every board (Section 2.2).
 *
 * Found by that tile rather than by its heading, because "Starred boards" and "Recently viewed"
 * are the two groups whose names the plan pins; this one is the whole collection and its
 * eyebrow is copy.
 */
function allBoards(page: Page): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('button', { name: 'Create new board' }) });
}

/**
 * The 96px tile for `name` inside one section: the link's parent paints the background.
 *
 * The section matters, because a starred board that has been opened appears in three grids
 * at once (Starred boards, Recently viewed and the collection below them).
 */
function tile(scope: Locator, name: string): Locator {
  return scope.getByRole('link', { name, exact: true }).locator('..');
}

async function createBoard(page: Page, name: string, swatch: string): Promise<void> {
  await page.getByRole('button', { name: 'Create new board' }).click();

  const popover = page.getByRole('dialog', { name: 'Create board' });
  await expect(popover).toBeVisible();

  // Section 2.2.1 item 6: Create stays disabled until the title holds a non-space character.
  await expect(popover.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();

  await popover.getByRole('button', { name: swatch }).click();
  await expect(popover.getByRole('button', { name: swatch })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await popover.getByLabel('Board title *').fill(name);
  await popover.getByRole('button', { name: 'Create', exact: true }).click();

  // Section 2.2.1 item 6: on success it navigates to the new board.
  await expect(page).toHaveURL(/\/b\/\d+$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Back to `/` through the nav, which is client-side routing, not a page load. */
async function goHome(page: Page): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:8020/');
}

test.describe.configure({ mode: 'serial' });

test('M1: home page, create boards, star', async ({ page }) => {
  await test.step('1. / is the home page: the nav, the sidebar and the grid', async () => {
    await page.goto('/');
    await expect(page).toHaveURL('http://127.0.0.1:8020/');

    // The nav of Section 2.1.1 and the sidebar of Section 2.2 render on every width.
    await expect(page.locator('header').getByRole('link', { name: 'Kan Ban' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Boards' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create new board' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View all closed boards' })).toBeVisible();

    // Section 2.2: the page is the 1128px centred column (the 1280px viewport is wider), and
    // `BoardsGrid` is `repeat(auto-fill, minmax(194px, 1fr))`, which fits four tiles beside
    // the 240px sidebar. Both break at once if the page shrink-wraps its content instead.
    expect((await page.locator('main').boundingBox())?.width).toBe(1128);
    const columns = await page
      .getByRole('button', { name: 'Create new board' })
      .evaluate(
        (node) =>
          getComputedStyle(node.parentElement as HTMLElement).gridTemplateColumns.split(' ').length,
      );
    expect(columns).toBe(4);
  });

  await test.step('2. create "Sprint 42" on the green background', async () => {
    await createBoard(page, FIRST_BOARD, 'Green background');
  });

  await test.step('3. the tile appears in the grid with that background', async () => {
    await goHome(page);
    const sprint = tile(allBoards(page), FIRST_BOARD);
    await expect(sprint).toBeVisible();
    await expect(sprint).toHaveCSS('background-color', GREEN);
  });

  await test.step('4. star it: it moves to Starred boards and survives a reload', async () => {
    const sprint = tile(allBoards(page), FIRST_BOARD);
    await sprint.hover();
    await sprint.getByRole('button', { name: 'Star board' }).click();

    const starred = tile(section(page, 'Starred boards'), FIRST_BOARD);
    await expect(starred).toBeVisible();
    await expect(starred).toHaveCSS('background-color', GREEN);
    await expect(starred.getByRole('button', { name: 'Unstar board' })).toBeVisible();

    await page.reload();
    const afterReload = tile(section(page, 'Starred boards'), FIRST_BOARD);
    await expect(afterReload).toBeVisible();
    await expect(afterReload.getByRole('button', { name: 'Unstar board' })).toBeVisible();
    await expect(afterReload).toHaveCSS('background-color', GREEN);
  });

  await test.step('5. create a second board with a different background', async () => {
    await createBoard(page, SECOND_BOARD, 'Purple background');
    await goHome(page);

    const design = tile(allBoards(page), SECOND_BOARD);
    await expect(design).toBeVisible();
    await expect(design).toHaveCSS('background-color', PURPLE);

    // Both boards have now been opened, so all three sections of Section 2.2 render, and both
    // of this run's boards are in "Recently viewed" — asserted by name rather than by counting
    // the grid, which also holds whatever the specs before this one opened.
    await expect(page.getByRole('heading', { name: 'Starred boards' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recently viewed' })).toBeVisible();
    const recent = section(page, 'Recently viewed');
    await expect(recent.getByRole('link', { name: FIRST_BOARD, exact: true })).toBeVisible();
    await expect(recent.getByRole('link', { name: SECOND_BOARD, exact: true })).toBeVisible();
  });

  await test.step('6. screenshot the home page', async () => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: 'docs/audit/screens/m1-home.png', fullPage: true });
  });
});
