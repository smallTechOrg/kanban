import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M1 golden path of Section 7.2: register, land on Home, create a board with a chosen
 * background, star it, and create a second board with a different background.
 *
 * One serial test, because every step builds on the account the one before it created.
 */

/** `meta.board_colors.green` = #519839, the background the Section 7.2 demo asks for. */
const GREEN = 'rgb(81, 152, 57)';

/** `meta.board_colors.purple` = #89609E, the second board's background. */
const PURPLE = 'rgb(137, 96, 158)';

/** The blurb `HomePage` shows while `all[]` is empty (Section 2.10). */
const EMPTY_BLURB = 'Boards are where work gets done in Kan Ban.';

const FIRST_BOARD = 'Sprint 42';
const SECOND_BOARD = 'Design system';

/** A fresh account per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Vera Kessler',
  email: `vera_${suffix}@example.com`,
  username: `vera_${suffix}`,
  password: 'correct-horse-battery',
};

/** The `BoardsSection` whose heading is `title`, so a tile can be asserted inside it. */
function section(page: Page, title: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title }) });
}

/**
 * The 96px tile for `name` inside one section: the link's parent paints the background.
 *
 * The section matters, because a starred board that has been opened appears in three grids
 * at once (Starred boards, Recently viewed and the workspace grid).
 */
function tile(page: Page, sectionTitle: string, name: string): Locator {
  return section(page, sectionTitle).getByRole('link', { name, exact: true }).locator('..');
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

test('M1: register, home page, create boards, star', async ({ page }) => {
  await test.step('1. / redirects to /login', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Log in to continue' })).toBeVisible();
  });

  await test.step('2. register a new user through the form', async () => {
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Sign up to continue' })).toBeVisible();

    await page.getByLabel('Full name').fill(user.fullName);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign up' }).click();
  });

  await test.step('3. land on Home: sections and the empty state', async () => {
    await expect(page).toHaveURL('http://127.0.0.1:8020/');

    // The nav of Section 2.1.1 proves the session resolved through GET /api/auth/me.
    await expect(page.locator('header').getByRole('link', { name: 'Kan Ban' })).toBeVisible();

    // Section 2.2: the sidebar and the workspaces section always render...
    await expect(page.getByRole('heading', { name: 'Your workspaces' })).toBeVisible();
    await expect(page.getByText(EMPTY_BLURB)).toBeVisible();
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

    // ...while "Starred boards" and "Recently viewed" are hidden when they hold nothing
    // (Section 2.2: "Starred boards (star icon; hidden when none)"). Step 7 asserts all
    // three once the account owns a starred, recently viewed board.
    await expect(page.getByRole('heading', { name: 'Starred boards' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recently viewed' })).toHaveCount(0);
  });

  await test.step('4. create "Sprint 42" on the green background', async () => {
    await createBoard(page, FIRST_BOARD, 'Green background');
  });

  await test.step('5. the tile appears in the grid with that background', async () => {
    await goHome(page);
    const sprint = tile(page, 'Your workspaces', FIRST_BOARD);
    await expect(sprint).toBeVisible();
    await expect(sprint).toHaveCSS('background-color', GREEN);
    await expect(page.getByText(EMPTY_BLURB)).toHaveCount(0);
  });

  await test.step('6. star it: it moves to Starred boards and survives a reload', async () => {
    // Starred boards is hidden until the star exists, so this is the workspace-grid tile.
    const sprint = tile(page, 'Your workspaces', FIRST_BOARD);
    await sprint.hover();
    await sprint.getByRole('button', { name: 'Star board' }).click();

    const starred = tile(page, 'Starred boards', FIRST_BOARD);
    await expect(starred).toBeVisible();
    await expect(starred).toHaveCSS('background-color', GREEN);
    await expect(starred.getByRole('button', { name: 'Unstar board' })).toBeVisible();

    await page.reload();
    const afterReload = tile(page, 'Starred boards', FIRST_BOARD);
    await expect(afterReload).toBeVisible();
    await expect(afterReload.getByRole('button', { name: 'Unstar board' })).toBeVisible();
    await expect(afterReload).toHaveCSS('background-color', GREEN);
  });

  await test.step('7. create a second board with a different background', async () => {
    await createBoard(page, SECOND_BOARD, 'Purple background');
    await goHome(page);

    const design = tile(page, 'Your workspaces', SECOND_BOARD);
    await expect(design).toBeVisible();
    await expect(design).toHaveCSS('background-color', PURPLE);

    // Both boards have now been opened, so all three sections of Section 2.2 render.
    await expect(page.getByRole('heading', { name: 'Starred boards' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recently viewed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your workspaces' })).toBeVisible();
    await expect(section(page, 'Recently viewed').getByRole('link')).toHaveCount(2);
  });

  await test.step('8. screenshot the home page', async () => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: 'docs/audit/screens/m1-home.png', fullPage: true });
  });
});
