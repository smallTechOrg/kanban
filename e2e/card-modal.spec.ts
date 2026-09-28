import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M3 checkpoint of Section 7.2: the card detail modal as a route, and the four features whose
 * whole point is that the tile behind the modal changes — a label chip, a description badge, a
 * checklist `done/total` and a coloured due pill.
 *
 * One serial test, because every step builds on the card the one before it created.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';

const BOARD = 'M3 checkpoint';
const CARD = 'Design home page';

/** The seeded labels are unnamed, so a chip is addressed by its colour key (Section 2.6.5). */
const LABEL = 'green';

const DESCRIPTION = '## Plan\n\n- Pick the palette\n- Ship it';

/** Section 2.6.3 renders comments as Markdown with `remark-gfm`, so a table must become a table. */
const COMMENT = '| What | When |\n| --- | --- |\n| Launch | Friday |';

const ITEMS = ['Wireframe', 'Palette', 'Review'] as const;

/** A fresh account per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Nadia Frost',
  email: `nadia_${suffix}@example.com`,
  username: `nadia_${suffix}`,
  password: 'correct-horse-battery',
};

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/** The tile itself: the `<a>` that carries the title and the badges (Section 2.5.1). */
function tile(page: Page, title: string): Locator {
  return column(page, FIRST_LIST).getByRole('link', { name: title, exact: true });
}

/**
 * The whole tile: the chips row, the badges and the pencil are siblings of the anchor, not its
 * children (CLAUDE.md section 8), and the tile's own class name is hashed by the CSS-module
 * build, so the container is reached as the anchor's parent.
 */
function tileCard(page: Page, title: string): Locator {
  return tile(page, title).locator('xpath=..');
}

function modal(page: Page): Locator {
  return page.getByRole('dialog', { name: CARD });
}

/** The popover the sidebar button under test opened, by its documented title. */
async function openSidebar(page: Page, button: string, popoverTitle: string): Promise<Locator> {
  await modal(page).getByRole('button', { name: button, exact: true }).click();
  const popover = page.getByRole('dialog', { name: popoverTitle });
  await expect(popover).toBeVisible();
  return popover;
}

/** The resolved value of a design token, so a colour assertion never hard-codes a hex. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

/** `#61BD4F` as `rgb(97, 189, 79)`: computed styles are always resolved colours. */
function toRgb(hex: string): string {
  const value = hex.replace('#', '');
  const channel = (at: number): number => Number.parseInt(value.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

test.describe.configure({ mode: 'serial' });

test('M3: card modal route, labels, description, checklist, dates, comments', async ({ page }) => {
  let cardUrl = '';

  await test.step('1. register, create a board and one card', async () => {
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

    const list = column(page, FIRST_LIST);
    await list.getByRole('button', { name: 'Add a card' }).click();
    const input = list.getByLabel('Card title');
    await input.fill(CARD);
    await input.press('Enter');
    await input.press('Escape');
    await expect(tile(page, CARD)).toBeVisible();
  });

  await test.step('2. clicking the tile opens the modal as a route; Esc closes it', async () => {
    const boardUrl = page.url();
    await tile(page, CARD).click();

    await expect(page).toHaveURL(/\/b\/\d+\/c\/\d+$/);
    cardUrl = page.url();
    await expect(modal(page)).toBeVisible();
    // Section 2.6.2: the sub-line names the list the card is in.
    await expect(modal(page).getByText(`in list ${FIRST_LIST}`)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await expect(page).toHaveURL(boardUrl);
  });

  await test.step('3. a cold load of the card URL renders the board underneath', async () => {
    await page.goto(cardUrl);

    // Section 2.6.1: the board is there, not a bare modal on an empty page. The assertions are
    // CSS locators on purpose — an open modal marks everything outside it `aria-hidden`, so the
    // board behind it is deliberately invisible to a role query.
    await expect(page.locator('h1')).toHaveText(BOARD);
    await expect(column(page, FIRST_LIST)).toBeVisible();
    await expect(modal(page)).toBeVisible();
  });

  await test.step(`4. add the ${LABEL} label; the chip appears on the tile`, async () => {
    const popover = await openSidebar(page, 'Labels', 'Labels');
    await popover.getByRole('button', { name: `Label ${LABEL}`, exact: true }).click();
    await expect(
      popover.getByRole('button', { name: `Label ${LABEL}`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Section 2.6.1: Esc closes the topmost popover first, and only then the modal.
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);

    await expect(
      tileCard(page, CARD).getByRole('button', { name: `Label ${LABEL}`, exact: true }),
    ).toBeVisible();
  });

  await test.step('5. write a Markdown description; the tile lights its badge', async () => {
    await page.goto(cardUrl);
    await modal(page).getByRole('button', { name: 'Add a more detailed description…' }).click();

    const editor = modal(page).getByRole('textbox', { name: 'Description' });
    await editor.fill(DESCRIPTION);
    await editor.press('ControlOrMeta+Enter');

    // Rendered, not raw: the `##` line becomes a heading (Section 5.7).
    await expect(modal(page).getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(modal(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(
      tileCard(page, CARD).getByRole('img', { name: 'This card has a description.' }),
    ).toBeVisible();
  });

  await test.step('6. add a checklist, tick one item, and read the tile badge', async () => {
    await page.goto(cardUrl);
    const popover = await openSidebar(page, 'Checklist', 'Add checklist');
    // Section 2.6.5: the title input arrives prefilled with "Checklist".
    await expect(popover.getByLabel('Title')).toHaveValue('Checklist');
    await popover.getByLabel('Title').fill('Launch tasks');
    await popover.getByRole('button', { name: 'Add', exact: true }).click();

    const section = modal(page).getByRole('region', { name: 'Launch tasks' });
    await expect(section).toBeVisible();

    await section.getByRole('button', { name: 'Add an item' }).click();
    const composer = section.getByRole('textbox', { name: 'Add an item' });
    for (const item of ITEMS) {
      await composer.fill(item);
      await composer.press('Enter');
      await expect(section.getByRole('checkbox', { name: item })).toBeVisible();
    }
    await composer.press('Escape');

    await section.getByRole('checkbox', { name: ITEMS[0] }).check();
    const bar = section.getByRole('progressbar', { name: 'Launch tasks' });
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(section.getByText('33%')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tileCard(page, CARD).getByText('1/3')).toBeVisible();
  });

  await test.step('7. set a due date, then complete it from the tile badge', async () => {
    await page.goto(cardUrl);
    const popover = await openSidebar(page, 'Dates', 'Dates');
    // Section 2.6.5: the first tick offers tomorrow at 12:00 PM local.
    await popover.getByRole('checkbox', { name: 'Due date' }).check();
    await expect(popover.getByLabel('Due time')).not.toHaveValue('');
    await popover.getByRole('button', { name: 'Save' }).click();
    await expect(popover).toHaveCount(0);

    // The quick badges row now carries the checkbox and the date button (Section 2.6.3).
    await expect(modal(page).getByLabel('Mark the due date complete')).toBeVisible();
    await page.keyboard.press('Escape');

    const badge = tileCard(page, CARD).getByRole('button', { name: /Mark complete$/ });
    await expect(badge).toBeVisible();
    await badge.click();

    const complete = tileCard(page, CARD).getByRole('button', { name: /Mark incomplete$/ });
    await expect(complete).toBeVisible();
    // Section 2.5.3: a complete due date wears the green of `--success`.
    await expect(complete).toHaveCSS('background-color', toRgb(await token(page, '--success')));

    // And the server stored it: a reload keeps the green pill.
    await page.reload();
    await expect(tileCard(page, CARD).getByRole('button', { name: /Mark incomplete$/ })).toHaveCSS(
      'background-color',
      toRgb(await token(page, '--success')),
    );
  });

  await test.step('8. comment with a Markdown table; the feed shows it', async () => {
    await page.goto(cardUrl);
    await modal(page).getByRole('button', { name: 'Write a comment…' }).click();
    const box = modal(page).getByRole('textbox', { name: 'Write a comment' });
    await box.fill(COMMENT);
    await box.press('ControlOrMeta+Enter');

    const activity = modal(page).getByRole('region', { name: 'Activity' });
    const feed = activity.getByRole('table');
    await expect(feed).toBeVisible();
    await expect(feed.getByRole('cell', { name: 'Launch' })).toBeVisible();
    // Own comments carry the two `link` actions of Section 2.6.3.
    await expect(activity.getByRole('button', { name: 'Delete' })).toBeVisible();

    // The comment is a row on the server, so it survives the round trip.
    await page.reload();
    await expect(modal(page).getByRole('cell', { name: 'Friday' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tileCard(page, CARD).getByText('1', { exact: true })).toBeVisible();
  });
});
