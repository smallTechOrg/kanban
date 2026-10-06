import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M3 checkpoint of Section 7.2: the card detail modal as a route, and the four features whose
 * whole point is that the tile behind the modal changes — a label chip, a description badge, an
 * item `done/total` and a coloured due pill.
 *
 * One serial test, because every step builds on the card the one before it created.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';

/** A fresh board name per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `M3 checkpoint ${suffix}`;
const CARD = 'Design home page';

/** The seeded labels are unnamed, so a chip is addressed by its colour key (Section 2.6.5). */
const LABEL = 'green';

const DESCRIPTION = '## Plan\n\n- Pick the palette\n- Ship it';


const ITEMS = ['Wireframe', 'Palette'] as const;

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

/**
 * A locator's box, guarded: `boundingBox()` answers `null` for an element with no layout, and
 * the clicks below are computed from real coordinates.
 */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element under test has no layout box');
  return box;
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

test('M3: card modal route, labels, description, items, dates, activity', async ({ page }) => {
  let cardUrl = '';

  await test.step('1. create a board and one card', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create new space' }).click();
    const popover = page.getByRole('dialog', { name: 'Create space' });
    await popover.getByLabel('Space title *').fill(BOARD);
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

  await test.step('6. add items to the card, tick one, and read the tile badge', async () => {
    await page.goto(cardUrl);
    // There is no checklist to create first: the section is always on the card.
    const section = modal(page).getByRole('region', { name: 'Items' });
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
    const bar = section.getByRole('progressbar', { name: 'Items' });
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(section.getByText('50%')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tileCard(page, CARD).getByText('1/2')).toBeVisible();
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

  await test.step('8. the activity feed reads back everything the steps above did', async () => {
    await page.goto(cardUrl);
    const activity = modal(page).getByRole('region', { name: 'Activity' });

    // Every row is one sentence from `lib/activity.ts`, and the card feed renders this card's
    // own title as "this card" (Section 2.6.3).
    await expect(activity.getByText(`Added this card to ${FIRST_LIST}`)).toBeVisible();
    await expect(activity.getByText(`Added the ${LABEL} label to this card`)).toBeVisible();
    await expect(activity.getByText('Updated the description of this card')).toBeVisible();
    await expect(activity.getByText(`Added ${ITEMS[0]} to this card`)).toBeVisible();
    // Step 7 ticked the tile's own due badge, so the feed carries that write too.
    await expect(activity.getByText('Marked the due date complete')).toBeVisible();

    // The feed is the server's, so the rows survive the round trip.
    await page.reload();
    await expect(
      modal(page)
        .getByRole('region', { name: 'Activity' })
        .getByText(`Added this card to ${FIRST_LIST}`),
    ).toBeVisible();
  });

  await test.step('9. the gaps beside a chip and beside the badges open the card', async () => {
    // Section 2.5.1 makes the whole tile the click target, and the chip row and the badge row
    // are as wide as the tile — so the empty half of each row is tile, not row. A reader aiming
    // just right of a label or a due date is aiming at the card.
    const boardUrl = cardUrl.replace(/\/c\/\d+$/, '');

    await page.goto(boardUrl);
    const chip = tileCard(page, CARD).getByRole('button', { name: `Label ${LABEL}`, exact: true });
    const chipBox = await boxOf(chip);
    // Right of the chip, and well clear of the pencil in the tile's top-right corner.
    await page.mouse.click(chipBox.x + chipBox.width + 8, chipBox.y + chipBox.height / 2);
    await expect(page).toHaveURL(cardUrl);
    await expect(modal(page)).toBeVisible();

    await page.goto(boardUrl);
    const badge = tileCard(page, CARD).getByRole('button', { name: /Mark incomplete$/ });
    const badgeBox = await boxOf(badge);
    const tileBox = await boxOf(tileCard(page, CARD));
    // Past the last badge of the row, at the tile's right edge.
    await page.mouse.click(tileBox.x + tileBox.width - 6, badgeBox.y + badgeBox.height / 2);
    await expect(page).toHaveURL(cardUrl);
    await expect(modal(page)).toBeVisible();
  });
});
