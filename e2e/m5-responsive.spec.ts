import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M5 responsive pass of Section 7.2, driven at the two widths Section 2.9.4 names:
 * 768-1023px (the TopNav drops Recent/Starred and the Home sidebar becomes a strip) and
 * <768px (full-width card modal with a stacked sidebar, popovers as bottom sheets, the
 * search field collapsed to its icon, no horizontal page scroll — only the canvas scrolls).
 *
 * The last step is the checklist's "touch drag verified on a 390x844 viewport". Playwright's
 * `page.touchscreen` can only tap, and `@hello-pangea/dnd`'s touch sensor needs a long press
 * (120 ms) followed by a stream of moves, so the gesture is dispatched over CDP instead —
 * the same shape as the real thing: one `touchStart`, a pause past the long-press threshold,
 * several `touchMove`s, one `touchEnd`.
 *
 * One serial test, because every step builds on the board the one before it created.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';
const DOING = 'Doing';

const BOARD = 'M5 responsive';
const CARDS = ['Audit the gutters', 'Stack the sidebar'] as const;

/** Section 2.9.4's two bands: one width inside 768-1023, one phone. */
const TABLET = { width: 1000, height: 800 };
const PHONE = { width: 390, height: 844 };

/** A fresh account per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Noor Haddad',
  email: `noor_${suffix}@example.com`,
  username: `noor_${suffix}`,
  password: 'correct-horse-battery',
};

test.use({ viewport: PHONE, hasTouch: true });

/** The TopNav, which every width keeps (Section 2.1.1). */
function header(page: Page): Locator {
  return page.locator('header');
}

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/** A card's drag handle: the tile's `<a>`, which carries `dragHandleProps`. */
function cardHandle(page: Page, listName: string, title: string): Locator {
  return column(page, listName).getByRole('link', { name: title, exact: true });
}

/** The card titles of one column, in the order the DOM paints them. */
async function cardTitles(page: Page, listName: string): Promise<string[]> {
  return column(page, listName).getByRole('link').allInnerTexts();
}

/** The box of a locator, as a rectangle the assertions can read without null checks. */
async function box(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('The element has no box');
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

/** How far the document can be scrolled sideways: Section 2.9.4 allows none below 768px. */
function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/**
 * A real touch drag: long-press the handle, move in steps, lift. The library recalculates the
 * destination from the dragged element's box on every move, so a single jump would never
 * produce one (the same reason `e2e/m2-board.spec.ts` streams its mouse moves).
 */
async function touchDrag(page: Page, handle: Locator, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const from = await box(handle);
  const x = from.x + from.w / 2;
  const y = from.y + from.h / 2;

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  // Past the sensor's 120 ms long press, which is what tells it this is a drag and not a scroll.
  await page.waitForTimeout(400);

  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (dy * step) / steps }],
    });
    await page.waitForTimeout(30);
  }

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

test.describe.configure({ mode: 'serial' });

test('M5: responsive breakpoints and a touch drag on a phone viewport', async ({ page }) => {
  await test.step('1. register and create a board with the default lists', async () => {
    await page.setViewportSize(TABLET);
    await page.goto('/register');
    await page.getByLabel('Full name').fill(user.fullName);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page).toHaveURL('http://127.0.0.1:8020/');

    await page.getByRole('button', { name: 'Create new board' }).click();
    const popover = page.getByRole('dialog', { name: 'Create board' });
    await popover.getByLabel('Board title *').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/b\/\d+$/);
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
  });

  await test.step('2. two cards in the first list', async () => {
    const list = column(page, FIRST_LIST);
    await list.getByRole('button', { name: 'Add a card' }).click();
    const input = list.getByLabel('Card title');

    for (const title of CARDS) {
      await input.fill(title);
      await input.press('Enter');
      await expect(cardHandle(page, FIRST_LIST, title)).toBeVisible();
    }
    await input.press('Escape');
    await expect.poll(() => cardTitles(page, FIRST_LIST)).toEqual([...CARDS]);
  });

  await test.step('3. 768-1023px: the nav drops Recent and Starred', async () => {
    await expect(header(page).getByRole('button', { name: 'Boards', exact: true })).toBeVisible();
    await expect(header(page).getByRole('button', { name: 'Recent' })).toBeHidden();
    await expect(header(page).getByRole('button', { name: 'Starred' })).toBeHidden();
    // The Create menu is a nav control Section 2.9.4 keeps at every width.
    await expect(header(page).getByRole('button', { name: 'Create' })).toBeVisible();
  });

  await test.step('4. 768-1023px: the Home sidebar is a horizontal strip', async () => {
    await header(page).getByRole('button', { name: 'Boards', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:8020/');

    const nav = page.getByRole('navigation', { name: 'Workspace' });
    const boards = await box(nav.getByRole('link', { name: 'Boards' }).first());
    const templates = await box(nav.getByRole('button', { name: 'Templates' }));

    // A strip, not a column: the first two rows share a baseline and sit side by side.
    expect(Math.abs(boards.y - templates.y)).toBeLessThan(2);
    expect(templates.x).toBeGreaterThan(boards.x);
  });

  await test.step('5. <768px: 16px gutters and no horizontal page scroll', async () => {
    await page.setViewportSize(PHONE);
    const heading = await box(page.getByRole('heading', { name: 'Your workspaces' }));
    expect(heading.x).toBeGreaterThanOrEqual(16);
    expect(heading.x).toBeLessThanOrEqual(24);

    // Polled, not read once: the search field's documented 0.1s width transition (2.1.1) is
    // still running for a frame after the resize, and the bar is wider than the phone while it
    // is. What Section 2.9.4 forbids is a page that stays scrollable sideways.
    await expect.poll(() => pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  await test.step('6. <768px: the search field collapses to its icon', async () => {
    const search = page.getByRole('textbox', { name: 'Search' });
    expect((await box(search.locator('..'))).w).toBeLessThanOrEqual(40);

    // Focused it expands to the full width of the bar, less its 8px gutters (Section 2.9.4).
    // Polled for the 0.1s width transition of Section 2.1.1, which is still running when
    // `focus()` returns.
    await search.focus();
    await expect
      .poll(async () => (await box(search.locator('..'))).w)
      .toBeGreaterThanOrEqual(PHONE.width - 32);

    await search.press('Escape');
  });

  await test.step('7. <768px: the canvas is the only thing that scrolls sideways', async () => {
    await page.getByRole('link', { name: BOARD, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();

    const canvas = page.locator('.canvas');
    const scroll = await canvas.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);

    await canvas.evaluate((node) => {
      node.scrollLeft = 200;
    });
    expect(await canvas.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await canvas.evaluate((node) => {
      node.scrollLeft = 0;
    });

    // The page itself still does not scroll sideways, and the canvas fits under the header
    // however many rows that header has wrapped onto.
    // Polled, not read once: the search field's documented 0.1s width transition (2.1.1) is
    // still running for a frame after the resize, and the bar is wider than the phone while it
    // is. What Section 2.9.4 forbids is a page that stays scrollable sideways.
    await expect.poll(() => pageOverflow(page)).toBeLessThanOrEqual(1);
    const canvasBox = await box(canvas);
    expect(canvasBox.y + canvasBox.h).toBeLessThanOrEqual(PHONE.height + 1);
  });

  await test.step('8. <768px: a popover is a bottom sheet', async () => {
    await column(page, FIRST_LIST).getByRole('button', { name: 'List actions' }).click();
    const sheet = page.getByRole('dialog', { name: 'List actions' });
    await expect(sheet).toBeVisible();

    const sheetBox = await box(sheet);
    expect(sheetBox.x).toBeLessThanOrEqual(1);
    expect(sheetBox.w).toBe(PHONE.width);
    expect(sheetBox.y + sheetBox.h).toBeCloseTo(PHONE.height, 0);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  await test.step('9. <768px: the card modal fills the width with a stacked sidebar', async () => {
    await cardHandle(page, FIRST_LIST, CARDS[0]).click();
    const dialog = page.getByRole('dialog', { name: CARDS[0] });
    await expect(dialog).toBeVisible();
    expect((await box(dialog)).w).toBe(PHONE.width);

    // Stacked, not beside: the sidebar's first button starts below the description.
    const description = await box(dialog.getByRole('region', { name: 'Description' }));
    const labels = await box(dialog.getByRole('button', { name: 'Labels', exact: true }));
    expect(labels.y).toBeGreaterThan(description.y);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/b\/\d+$/);
  });

  await test.step('10. <768px: a touch drag reorders the list', async () => {
    const first = cardHandle(page, FIRST_LIST, CARDS[0]);
    const second = await box(cardHandle(page, FIRST_LIST, CARDS[1]));
    const start = await box(first);

    // Far enough past the second tile that the library's centre-of-box rule swaps them.
    await touchDrag(page, first, second.y + second.h - start.y);

    await expect.poll(() => cardTitles(page, FIRST_LIST)).toEqual([CARDS[1], CARDS[0]]);

    // And the drop wrote a real position: the order survives a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();
    await expect.poll(() => cardTitles(page, FIRST_LIST)).toEqual([CARDS[1], CARDS[0]]);

    // Nothing left the list on the way.
    expect(await cardTitles(page, DOING)).toEqual([]);
  });
});
