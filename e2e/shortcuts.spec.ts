import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The keyboard map of Section 2.8, end to end (Section 7.2's M4 `shortcuts.spec.ts`).
 *
 * One serial journey, because every key acts on "the current card" —
 * `openCardId ?? focusedCardId ?? hoveredCardId` — so what the mouse and the previous key left
 * behind is half of what each step asserts.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';
const SECOND_LIST = 'Doing';

/** A fresh board name per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `M4b shortcuts ${suffix}`;
const CARDS = ['Keyboard alpha', 'Keyboard beta'] as const;

function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/** The whole tile behind a card link: the chip row and the badges are the anchor's siblings. */
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

async function addCard(page: Page, list: string, title: string): Promise<void> {
  const target = column(page, list);
  await target.getByRole('button', { name: 'Add a card' }).click();
  const input = target.getByLabel('Card title');
  await input.fill(title);
  await input.press('Enter');
  await input.press('Escape');
  await expect(target.getByRole('link', { name: title, exact: true })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('M4b: every key of the Section 2.8 cheat sheet', async ({ page }) => {
  let boardPath = '';

  await test.step('1. create a board and two cards', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create new board' }).click();
    const popover = page.getByRole('dialog', { name: 'Create board' });
    await popover.getByLabel('Board title').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/b\/\d+$/);
    boardPath = new URL(page.url()).pathname;

    for (const title of CARDS) await addCard(page, FIRST_LIST, title);
  });

  await test.step('2. "?" opens the cheat sheet and Escape closes it', async () => {
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Focus the top-bar search')).toBeVisible();
    await expect(sheet.getByText('Open the Filter popover')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  await test.step('3. 1 toggles the first board label on the hovered card', async () => {
    await hoverCard(page, CARDS[0]);
    await page.keyboard.press('1');
    // Chips are 16px bars whose accessible name is the colour key of an unnamed label (2.5.2).
    await expect(tile(page, CARDS[0]).getByTitle('green')).toBeVisible();
  });

  await test.step('4. E opens the quick editor and Escape cancels it', async () => {
    await hoverCard(page, CARDS[0]);
    await page.keyboard.press('e');
    const editor = page.getByLabel('Card title');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
  });

  await test.step('5. N opens a composer below the current card', async () => {
    await hoverCard(page, CARDS[0]);
    await page.keyboard.press('n');
    const composer = column(page, FIRST_LIST).getByLabel('Card title');
    await expect(composer).toBeVisible();
    await composer.fill('Keyboard gamma');
    await composer.press('Enter');
    await composer.press('Escape');

    // The server was sent `index: 1`, so the new card sits between the two existing ones.
    const titles = await column(page, FIRST_LIST).getByRole('link').allInnerTexts();
    expect(titles).toEqual([CARDS[0], 'Keyboard gamma', CARDS[1]]);
  });

  await test.step('6. J selects a card and Enter opens it', async () => {
    await page.mouse.move(0, 0);
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${boardPath}/c/\\d+$`));
    await expect(page.getByRole('dialog', { name: CARDS[0] })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(boardPath);
  });

  await test.step('7. F opens the filter and X clears it; W the menu drawer', async () => {
    await page.keyboard.press('f');
    const filter = page.getByRole('dialog', { name: 'Filter' });
    await expect(filter).toBeVisible();
    // Step 3 put the green label on the first card, so only that one survives the filter. The
    // panel traps focus, so what it did to the canvas is read after Escape has closed it.
    await filter.getByRole('checkbox', { name: 'green' }).check();
    await page.keyboard.press('Escape');
    await expect(filter).toHaveCount(0);

    await expect(page.getByRole('button', { name: /1 filter/ })).toBeVisible();
    await expect(column(page, FIRST_LIST).getByRole('link')).toHaveCount(1);

    await page.keyboard.press('x');
    await expect(column(page, FIRST_LIST).getByRole('link')).toHaveCount(3);

    await page.keyboard.press('w');
    await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Menu' })).toHaveCount(0);
  });

  await test.step('8. "/" focuses the search and Enter opens the card it found', async () => {
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search' })).toBeFocused();
    await page.keyboard.type('Keyboard beta');
    await expect(page.getByRole('heading', { name: 'Cards' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: CARDS[1] })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('9. "." moves the current card to the top of the next list', async () => {
    await hoverCard(page, CARDS[1]);
    await page.keyboard.press('.');
    await expect(column(page, SECOND_LIST).getByRole('link', { name: CARDS[1] })).toBeVisible();
    await expect(column(page, FIRST_LIST).getByRole('link', { name: CARDS[1] })).toHaveCount(0);
  });

  await test.step('10. C archives the current card and the toast undoes it', async () => {
    await hoverCard(page, CARDS[1]);
    await page.keyboard.press('c');
    await expect(column(page, SECOND_LIST).getByRole('link', { name: CARDS[1] })).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(column(page, SECOND_LIST).getByRole('link', { name: CARDS[1] })).toBeVisible();
  });
});
