import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * The M3 acceptance run of Section 7.2 ("Card detail modal core"), done the way a person does it:
 * one card, opened as a route, given a description, a label, a checklist and a due date, with
 * every assertion made on what the screen shows — the rendered Markdown, the progress bar, and
 * above all the tile badges *behind* the modal, which are the whole point of the milestone.
 *
 * `card-modal.spec.ts` is the milestone's own golden path. This file is the audit pass: it adds
 * the inline rename, the code block, the GFM table, the activity feed, the history contract
 * (Esc closes to the board, Back does not reopen the card) and a genuinely cold deep link in a
 * second browser context.
 *
 * One serial test: every step builds on the card the step before it left behind.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';

/** A fresh board name per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);

const BOARD = `M3 audit ${suffix}`;
const CARD = 'Launch checklist';
const RENAMED = 'Launch checklist v2';

/** Board labels are seeded unnamed, so a chip is addressed by its colour key (Section 2.6.5). */
const LABEL = 'green';

/** A heading, a list, a GFM table and a fenced code block: Markdown rendered, not echoed. */
const DESCRIPTION = [
  '## Launch plan',
  '',
  '- Draft the copy',
  '- Ship it',
  '',
  '| What | When |',
  '| --- | --- |',
  '| Launch | Friday |',
  '',
  '```ts',
  'const ready = true;',
  '```',
].join('\n');

const ITEMS = ['Write the copy', 'Pick the palette', 'Review'] as const;

const CHECKLIST = 'Launch tasks';

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/**
 * The whole tile of the card at `path`, reached through its anchor's `href`.
 *
 * Deliberately a CSS locator: while the modal is open everything outside it is `aria-hidden`, so
 * the tile behind it is invisible to every role query — and "the tile behind the modal changed"
 * is exactly what this file has to assert. The chips, the badge row and the pencil are siblings
 * of the anchor rather than its children (CLAUDE.md section 8), and the tile's own class name is
 * hashed by the CSS-module build, so the container is the anchor's parent.
 */
function tileCard(page: Page, path: string): Locator {
  return page.locator(`a[href="${path}"]`).locator('xpath=..');
}

function modal(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title });
}

/** The popover a sidebar button opened, by its documented title (Section 2.6.5). */
async function openSidebar(page: Page, title: string, button: string, popover: string) {
  await modal(page, title).getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: popover });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The resolved value of a design token, so no assertion hard-codes a hex (CLAUDE.md section 3). */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

/** Tomorrow's local date as `yyyy-mm-dd`, the value Section 2.6.5 prefills the Due field with. */
function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `#61BD4F` as `rgb(97, 189, 79)`: a computed style is always a resolved colour. */
function toRgb(hex: string): string {
  const value = hex.replace('#', '');
  const channel = (at: number): number => Number.parseInt(value.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

test.describe.configure({ mode: 'serial' });

test('M3 audit: the card modal round-trips every M3 feature to the tile', async ({
  page,
  browser,
}) => {
  let boardPath = '';
  let cardPath = '';

  await test.step('1. create a board with the default lists, add a card', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create new board' }).click();
    const popover = page.getByRole('dialog', { name: 'Create board' });
    await popover.getByLabel('Board title *').fill(BOARD);
    await popover.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/b\/\d+$/);
    boardPath = new URL(page.url()).pathname;

    const list = column(page, FIRST_LIST);
    await list.getByRole('button', { name: 'Add a card' }).click();
    const input = list.getByLabel('Card title');
    await input.fill(CARD);
    await input.press('Enter');
    await input.press('Escape');
    await expect(list.getByRole('link', { name: CARD, exact: true })).toBeVisible();
  });

  await test.step('2. clicking the tile opens the modal at /b/:boardId/c/:cardId', async () => {
    await column(page, FIRST_LIST).getByRole('link', { name: CARD, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`${boardPath}/c/\\d+$`));
    cardPath = new URL(page.url()).pathname;
    await expect(modal(page, CARD)).toBeVisible();
    // Section 2.6.2: the sub-line names the list the card is in.
    await expect(modal(page, CARD).getByText(`in list ${FIRST_LIST}`)).toBeVisible();
  });

  await test.step('3. rename the card inline; the tile shows the new title', async () => {
    await modal(page, CARD)
      .getByRole('button', { name: `Rename card ${CARD}` })
      .click();
    const title = modal(page, CARD).getByRole('textbox', { name: `Rename card ${CARD}` });
    await title.fill(RENAMED);
    await title.press('Enter');

    await expect(modal(page, RENAMED)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`${boardPath}$`));
    await expect(
      column(page, FIRST_LIST).getByRole('link', { name: RENAMED, exact: true }),
    ).toBeVisible();
  });

  await test.step('4. a Markdown description renders as HTML and lights the tile badge', async () => {
    await page.goto(cardPath);
    const dialog = modal(page, RENAMED);
    await dialog.getByRole('button', { name: 'Add a more detailed description…' }).click();

    const editor = dialog.getByRole('textbox', { name: 'Description' });
    await editor.fill(DESCRIPTION);
    await editor.press('ControlOrMeta+Enter');

    // Section 5.7: react-markdown + remark-gfm, so every construct is an element.
    const description = dialog.getByRole('region', { name: 'Description' });
    await expect(description.getByRole('heading', { name: 'Launch plan' })).toBeVisible();
    await expect(description.locator('li', { hasText: 'Draft the copy' })).toBeVisible();
    // A bullet list has to look like one: the global reset strips every marker, so the Markdown
    // stylesheet has to put this one back (Section 5.7).
    await expect(description.locator('ul')).toHaveCSS('list-style-type', 'disc');
    // remark-gfm is on, so a pipe table is a real table and not three lines of pipes.
    await expect(description.getByRole('table')).toBeVisible();
    await expect(description.getByRole('cell', { name: 'Friday' })).toBeVisible();
    await expect(description.locator('pre code')).toHaveText('const ready = true;\n');
    // Rendered, not echoed: no raw fence or hash survives on screen.
    await expect(description).not.toContainText('## Launch plan');
    await expect(description).not.toContainText('| --- |');
    await expect(description).not.toContainText('```');

    await expect(
      tileCard(page, cardPath).locator('[aria-label="This card has a description."]'),
    ).toBeVisible();
  });

  await test.step(`5. the ${LABEL} label appears as a chip on the tile behind the modal`, async () => {
    const popover = await openSidebar(page, RENAMED, 'Labels', 'Labels');
    await popover.getByRole('button', { name: `Label ${LABEL}`, exact: true }).click();
    await expect(
      popover.getByRole('button', { name: `Label ${LABEL}`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Section 2.6.1: Esc closes the topmost popover first, and the modal stays open.
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(modal(page, RENAMED)).toBeVisible();

    // The tile behind the modal, without closing it.
    await expect(tileCard(page, cardPath).locator(`[aria-label="Label ${LABEL}"]`)).toBeVisible();
  });

  await test.step('6. a checklist drives the progress bar and the tile done/total badge', async () => {
    const popover = await openSidebar(page, RENAMED, 'Checklist', 'Add checklist');
    await popover.getByLabel('Title').fill(CHECKLIST);
    await popover.getByRole('button', { name: 'Add', exact: true }).click();

    const section = modal(page, RENAMED).getByRole('region', { name: CHECKLIST });
    await expect(section).toBeVisible();

    await section.getByRole('button', { name: 'Add an item' }).click();
    const composer = section.getByRole('textbox', { name: 'Add an item' });
    for (const item of ITEMS) {
      await composer.fill(item);
      await composer.press('Enter');
      await expect(section.getByRole('checkbox', { name: item })).toBeVisible();
    }
    await composer.press('Escape');

    const bar = section.getByRole('progressbar', { name: CHECKLIST });
    await expect(bar).toHaveAttribute('aria-valuenow', '0');

    await section.getByRole('checkbox', { name: ITEMS[0] }).check();
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(bar).toHaveAttribute('aria-valuemax', '3');
    await expect(section.getByText('33%')).toBeVisible();

    const badge = tileCard(page, cardPath).locator('[title="Checklist items"]');
    await expect(badge).toHaveText('1/3');

    await section.getByRole('checkbox', { name: ITEMS[1] }).check();
    await section.getByRole('checkbox', { name: ITEMS[2] }).check();
    await expect(bar).toHaveAttribute('aria-valuenow', '3');
    await expect(section.getByText('100%')).toBeVisible();
    // Section 2.5.3: a complete checklist badge turns green.
    await expect(badge).toHaveText('3/3');
    await expect(badge).toHaveCSS('background-color', toRgb(await token(page, '--success')));
  });

  await test.step('7. a due date paints the tile pill, and the checkbox completes it', async () => {
    const popover = await openSidebar(page, RENAMED, 'Dates', 'Dates');
    // Section 2.6.5: the first tick offers tomorrow at 12:00 PM local.
    await popover.getByRole('checkbox', { name: 'Due date' }).check();
    await expect(popover.getByLabel('Due time')).not.toHaveValue('');
    // Two `input[type=date]` rows: start, then due. The label "Due date" names both the
    // checkbox and the field, so the field is addressed by position.
    await expect(popover.locator('input[type="date"]').nth(1)).toHaveValue(tomorrow());
    await popover.getByRole('button', { name: 'Save' }).click();
    await expect(popover).toHaveCount(0);

    await expect(modal(page, RENAMED).getByLabel('Mark the due date complete')).toBeVisible();

    // The tile's due badge is the one interactive badge (Section 2.5.3).
    const pill = tileCard(page, cardPath).locator('button[aria-pressed]');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('aria-pressed', 'false');

    await modal(page, RENAMED).getByLabel('Mark the due date complete').check();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    await expect(pill).toHaveCSS('background-color', toRgb(await token(page, '--success')));
  });

  await test.step('8. the activity feed is the record of steps 1 to 7', async () => {
    const activity = modal(page, RENAMED).getByRole('region', { name: 'Activity' });

    // Every row is one sentence from `lib/activity.ts` (Section 3.8), and the card feed renders
    // this card's own title as "this card" (Section 2.6.3). The rename row still names the title
    // it replaced, which is the whole reason the server denormalises the old one.
    await expect(activity.getByText(`Added this card to ${FIRST_LIST}`)).toBeVisible();
    await expect(activity.getByText(`Renamed this card (from ${CARD})`)).toBeVisible();
    await expect(activity.getByText('Updated the description of this card')).toBeVisible();
    await expect(activity.getByText(`Added the ${LABEL} label to this card`)).toBeVisible();
    await expect(activity.getByText(`Added checklist ${CHECKLIST} to this card`)).toBeVisible();
    await expect(activity.getByText(`Completed ${ITEMS[0]} on ${CHECKLIST}`)).toBeVisible();
    await expect(activity.getByText('Marked the due date complete')).toBeVisible();

    // The feed is the server's, so the rows survive a reload rather than being this session's
    // optimistic echo of its own writes.
    await page.reload();
    await expect(
      modal(page, RENAMED)
        .getByRole('region', { name: 'Activity' })
        .getByText(`Renamed this card (from ${CARD})`),
    ).toBeVisible();
  });

  await test.step('9. Esc closes to the board, and Back does not reopen the card', async () => {
    // The modal on screen was deep-linked in step 4, which is the `replace` case. The contract
    // under test is the ordinary one, so it is opened again from the tile — a pushed entry.
    await page.keyboard.press('Escape');
    await expect(modal(page, RENAMED)).toHaveCount(0);
    await column(page, FIRST_LIST).getByRole('link', { name: RENAMED, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${cardPath}$`));

    await page.keyboard.press('Escape');
    await expect(modal(page, RENAMED)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${boardPath}$`));

    await page.goBack();
    // Section 7.2's demo script: "browser back reopens nothing".
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(`${cardPath}$`));
  });

  await test.step('10. a cold deep link opens the board with the modal populated', async () => {
    let fresh: BrowserContext | null = null;
    try {
      fresh = await browser.newContext();
      const cold = await fresh.newPage();
      await cold.goto(cardPath);

      // The board is underneath, not a bare modal on an empty page (Section 2.6.1). CSS
      // locators, because the open modal makes everything outside it `aria-hidden`.
      await expect(cold.locator('h1')).toHaveText(BOARD);
      await expect(column(cold, FIRST_LIST)).toBeVisible();

      const dialog = modal(cold, RENAMED);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`in list ${FIRST_LIST}`)).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Launch plan' })).toBeVisible();
      await expect(dialog.locator('pre code')).toHaveText('const ready = true;\n');
      await expect(dialog.getByRole('region', { name: CHECKLIST })).toBeVisible();
      await expect(
        dialog.getByRole('progressbar', { name: CHECKLIST }),
      ).toHaveAttribute('aria-valuenow', '3');
      await expect(dialog.getByLabel('Mark the due date complete')).toBeChecked();
      // The quick-badges Labels group carries the chip (Section 2.6.3); an attached chip there is
      // a plain `span`, not the popover's toggle button.
      await expect(dialog.locator('[aria-labelledby="card-labels-label"]')).toContainText(LABEL);

      // And the tile behind it carries the badges the modal's data produced.
      await expect(tileCard(cold, cardPath).locator('[title="Checklist items"]')).toHaveText('3/3');
      await expect(
        tileCard(cold, cardPath).locator('[aria-label="This card has a description."]'),
      ).toBeVisible();

      await test.step('11. screenshot the open modal', async () => {
        await cold.screenshot({ path: 'docs/audit/screens/m3-card.png' });
      });
    } finally {
      await fresh?.close();
    }
  });
});
