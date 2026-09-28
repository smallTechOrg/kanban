import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The M4a acceptance run of Section 7.2's M4 checklist, card-options half: members and watching,
 * attachments, covers, move and copy across boards, archive and restore, and Share.
 *
 * It is one serial journey because every step reads what the step before it wrote, and because
 * the three sections the modal grew in this milestone (`CardCoverStrip`, `AttachmentsSection`,
 * `ArchivedBanner`) can only be wrong together with the layout they are mounted in and with the
 * tile behind them — which is where most of the assertions are made.
 */

/** The lists `POST /api/boards` creates for `default_lists: true` (Section 3.10). */
const FIRST_LIST = 'To Do';

const ALPHA = 'M4a alpha';
const BETA = 'M4a beta';
const CARD = 'Launch plan';

/** Board labels are seeded unnamed, so a chip is addressed by its colour key (Section 2.6.5). */
const LABEL = 'green';

const CHECKLIST = 'Launch tasks';
const ITEMS = ['Write the copy', 'Pick the palette'] as const;

/** A real PNG, so Pillow sniffs it, thumbnails it and reports a dominant colour (Section 6.9). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAT0lEQVR4nNXOMREAIBDAsNINyajDGiJ+4BoFWftc' +
    'yiRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4vwdmHpa9wGB1W64NAAAAABJ' +
    'RU5ErkJggg==',
  'base64',
);

const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Nina Okafor',
  email: `nina_${suffix}@example.com`,
  username: `nina_${suffix}`,
  password: 'correct-horse-battery',
};

/** One column, which `ListColumn` labels with the list's name. */
function column(page: Page, name: string): Locator {
  return page.locator(`section[aria-label="${name}"]`);
}

/**
 * The whole tile of the card at `path`, reached through its anchor's `href`.
 *
 * A CSS locator on purpose: while the modal is open everything outside it is `aria-hidden`, so
 * the tile behind it is invisible to every role query — and "the tile behind the modal changed"
 * is exactly what this file asserts. The chips, badges, avatars and pencil are siblings of the
 * anchor rather than its children (CLAUDE.md section 8), so the tile is the anchor's parent.
 */
function tileCard(page: Page, path: string): Locator {
  return page.locator(`a[href="${path}"]`).locator('xpath=..');
}

function modal(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title });
}

/** The popover a sidebar row opened, by its documented title (Section 2.6.5). */
async function openSidebar(page: Page, card: string, button: string, popover: string) {
  await modal(page, card).getByRole('button', { name: button, exact: true }).last().click();
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

/** `#FFFFFF` as `rgb(255, 255, 255)`: a computed style is always a resolved colour. */
function toRgb(hex: string): string {
  const value = hex.replace('#', '');
  const channel = (at: number): number => Number.parseInt(value.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

/** Creates a board with the three default lists and returns its `/b/:id` path. */
async function createBoard(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new board' }).click();
  const popover = page.getByRole('dialog', { name: 'Create board' });
  await popover.getByLabel('Board title').fill(name);
  await popover.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/b\/\d+$/);
  await expect(page.locator('h1')).toHaveText(name);
  return new URL(page.url()).pathname;
}

/** The "Card #n" line of the Share panel (Section 2.6.4), with the panel left open. */
async function cardNumber(page: Page, card: string): Promise<string> {
  const popover = await openSidebar(page, card, 'Share', 'Share');
  return (await popover.locator('p', { hasText: 'Card #' }).innerText()).trim();
}

test.describe.configure({ mode: 'serial' });

// The Share panel writes the link to the real clipboard, and step 8 reads it back.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('M4a: members, attachments, covers, move, copy, archive and share', async ({ page }) => {
  let alphaPath = '';
  let betaPath = '';
  let cardPath = '';
  let copyPath = '';

  await test.step('1. register, create two boards, add a card to the first', async () => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(user.fullName);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('button', { name: 'Create new board' })).toBeVisible();

    alphaPath = await createBoard(page, ALPHA);
    betaPath = await createBoard(page, BETA);

    await page.goto(alphaPath);
    const list = column(page, FIRST_LIST);
    await list.getByRole('button', { name: 'Add a card' }).click();
    const input = list.getByLabel('Card title');
    await input.fill(CARD);
    await input.press('Enter');
    await input.press('Escape');
    await expect(list.getByRole('link', { name: CARD, exact: true })).toBeVisible();
  });

  await test.step('2. assign myself through the Members popover; the avatar lands on the tile', async () => {
    await column(page, FIRST_LIST).getByRole('link', { name: CARD, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${alphaPath}/c/\\d+$`));
    cardPath = new URL(page.url()).pathname;
    await expect(modal(page, CARD)).toBeVisible();

    const popover = await openSidebar(page, CARD, 'Members', 'Members');
    await popover.getByRole('button', { name: user.fullName }).click();
    await expect(popover.getByRole('button', { name: user.fullName })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);

    // The modal's Members quick-badge group, and the 24px avatar on the tile behind it.
    await expect(
      modal(page, CARD).locator(`[aria-labelledby="card-members-label"] [aria-label="${user.fullName}"]`),
    ).toBeVisible();
    await expect(tileCard(page, cardPath).locator(`[aria-label="${user.fullName}"]`)).toBeVisible();

    // Watching is the milestone's other per-user write (Section 4.5, outside `write_tx`): the
    // sidebar row keeps its label and gains the check, and the tile grows the eye badge.
    await modal(page, CARD).getByRole('button', { name: 'Watch', exact: true }).last().click();
    await expect(modal(page, CARD).getByText('Watching this card').first()).toBeVisible();
    await expect(
      tileCard(page, cardPath).locator('[aria-label="You are watching this card"]'),
    ).toBeVisible();

    // Section 2.6.3: the check tile sits *flush at the button's right edge* and "the label stays
    // Watch", so it may never be painted over the label it leaves in place.
    const notifications = modal(page, CARD).locator('[aria-labelledby="card-notifications-label"]');
    const watchButton = await notifications
      .getByRole('button', { name: 'Watch', exact: true })
      .boundingBox();
    const checkTile = await notifications
      .getByText('Watching this card')
      .locator('xpath=..')
      .boundingBox();
    if (watchButton === null || checkTile === null) throw new Error('watch controls not laid out');
    expect(checkTile.x).toBeGreaterThanOrEqual(watchButton.x + watchButton.width - 1);
  });

  await test.step('3. upload a PNG; the row shows a thumbnail and the tile badge reads 1', async () => {
    const section = modal(page, CARD).getByRole('region', { name: 'Attachments' });
    await section.getByRole('button', { name: 'Add' }).click();
    const picker = page.getByRole('dialog', { name: 'Attach' });
    await picker.locator('input[type="file"]').setInputFiles({
      name: 'brand.png',
      mimeType: 'image/png',
      buffer: PNG_BYTES,
    });
    await expect(picker).toHaveCount(0);

    const row = section.locator('li', { hasText: 'brand.png' });
    await expect(row).toBeVisible();
    // Section 6.9: Pillow wrote a 2:1 thumbnail, and the row paints it.
    const thumb = row.locator('img');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveJSProperty('naturalWidth', 512);

    await expect(tileCard(page, cardPath).locator('[title="Attachments"]')).toHaveText('1');

    // The link half of the same endpoint (Section 4.6): a JSON attachment, no file.
    await section.getByRole('button', { name: 'Add' }).click();
    const link = page.getByRole('dialog', { name: 'Attach' });
    await link.getByLabel('Link').fill('https://example.com/launch');
    await link.getByRole('button', { name: 'Insert' }).click();
    await expect(section.locator('li', { hasText: 'example.com' })).toBeVisible();
    await expect(tileCard(page, cardPath).locator('[title="Attachments"]')).toHaveText('2');
  });

  await test.step('4. make it the cover, then switch to full: the tile title overlays it', async () => {
    const section = modal(page, CARD).getByRole('region', { name: 'Attachments' });
    await section.locator('li', { hasText: 'brand.png' }).getByRole('button', { name: 'Make cover' }).click();
    await expect(
      section.locator('li', { hasText: 'brand.png' }).getByRole('button', { name: 'Remove cover' }),
    ).toBeVisible();

    // Section 2.6.1: the 160px band appears with its own "Cover" button beside the sidebar row.
    await expect(modal(page, CARD).getByRole('button', { name: 'Cover', exact: true })).toHaveCount(2);

    const tile = tileCard(page, cardPath);
    // Section 2.5.1: an image cover is a contained <img> over the dominant colour.
    await expect(tile.locator('img')).toBeVisible();
    await expect(tile.locator('img')).toHaveCSS('object-fit', 'contain');
    await expect(tile.locator('[title="Attachments"]')).toBeVisible();

    const cover = await openSidebar(page, CARD, 'Cover', 'Cover');
    await cover.getByRole('button', { name: 'Full cover' }).click();
    await expect(cover.getByRole('button', { name: 'Full cover' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(cover).toHaveCount(0);

    // Section 2.5.1 for `size: 'full'`: the cover fills a 96px tile, the title is white over the
    // scrim and the badge row is not rendered at all.
    await expect(tile).toHaveCSS('min-height', '96px');
    await expect(tile.locator('img')).toHaveCSS('object-fit', 'cover');
    const title = tile.getByText(CARD, { exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS('color', toRgb(await token(page, '--text-inverse')));
    await expect(tile.locator('[title="Attachments"]')).toHaveCount(0);

    // Back to the documented default so the rest of the run reads the badges again.
    const again = await openSidebar(page, CARD, 'Cover', 'Cover');
    await again.getByRole('button', { name: 'Normal cover' }).click();
    await page.keyboard.press('Escape');
    await expect(tile.locator('[title="Attachments"]')).toHaveText('2');
  });

  await test.step('5. a checklist of two items, copied to the second board with its own number', async () => {
    const popover = await openSidebar(page, CARD, 'Checklist', 'Add checklist');
    await popover.getByLabel('Title').fill(CHECKLIST);
    await popover.getByRole('button', { name: 'Add', exact: true }).click();

    const section = modal(page, CARD).getByRole('region', { name: CHECKLIST });
    await section.getByRole('button', { name: 'Add an item' }).click();
    const composer = section.getByRole('textbox', { name: 'Add an item' });
    for (const item of ITEMS) {
      await composer.fill(item);
      await composer.press('Enter');
      await expect(section.getByRole('checkbox', { name: item })).toBeVisible();
    }
    await composer.press('Escape');

    const copy = await openSidebar(page, CARD, 'Copy', 'Copy card');
    await expect(copy.getByRole('checkbox', { name: 'Checklists (1)' })).toBeChecked();
    await copy.getByLabel('Board').selectOption({ label: BETA });
    // Section 4.5: neither travels across boards, so the panel says so instead of sending them.
    await expect(copy.getByRole('checkbox', { name: /Members/ })).toBeDisabled();
    await copy.getByRole('button', { name: 'Create card' }).click();
    await expect(copy).toHaveCount(0);

    await page.goto(betaPath);
    const tile = column(page, FIRST_LIST).getByRole('link', { name: CARD, exact: true });
    await expect(tile).toBeVisible();
    await tile.click();
    copyPath = new URL(page.url()).pathname;
    expect(copyPath).not.toBe(cardPath);

    const section2 = modal(page, CARD).getByRole('region', { name: CHECKLIST });
    await expect(section2).toBeVisible();
    for (const item of ITEMS) {
      await expect(section2.getByRole('checkbox', { name: item })).toBeVisible();
    }
    // The copy is the first card of its own board, so the per-board sequence starts again at 1.
    expect(await cardNumber(page, CARD)).toBe('Card #1');
    await page.keyboard.press('Escape');
  });

  await test.step('6. move the original across boards: it leaves Alpha and drops its labels', async () => {
    await page.goto(cardPath);
    const labels = await openSidebar(page, CARD, 'Labels', 'Labels');
    await labels.getByRole('button', { name: `Label ${LABEL}`, exact: true }).click();
    await expect(labels.getByRole('button', { name: `Label ${LABEL}`, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(
      modal(page, CARD).locator(`[aria-labelledby="card-labels-label"]`),
    ).toBeVisible();

    const move = await openSidebar(page, CARD, 'Move', 'Move card');
    await move.getByLabel('Board').selectOption({ label: BETA });
    await move.getByLabel('List').selectOption({ label: FIRST_LIST });
    await move.getByRole('button', { name: 'Move', exact: true }).click();

    // Section 2.6.1: the modal follows the card to the board it now lives on.
    await expect(page).toHaveURL(new RegExp(`${betaPath}/c/\\d+$`));
    const movedPath = new URL(page.url()).pathname;
    expect(movedPath).not.toBe(cardPath);
    cardPath = movedPath;

    // Section 4.5: a cross-board move takes a fresh `short_id` and strips the card's labels.
    expect(await cardNumber(page, CARD)).toBe('Card #2');
    await page.keyboard.press('Escape');
    await expect(modal(page, CARD).locator('[aria-labelledby="card-labels-label"]')).toHaveCount(0);
    await expect(tileCard(page, cardPath).locator(`[aria-label="Label ${LABEL}"]`)).toHaveCount(0);
    // Members that are on the target board are kept.
    await expect(tileCard(page, cardPath).locator(`[aria-label="${user.fullName}"]`)).toBeVisible();

    // It arrived on Beta (two tiles now) and left Alpha behind.
    await expect(column(page, FIRST_LIST).locator(`a[href="${cardPath}"]`)).toBeVisible();
    await expect(column(page, FIRST_LIST).locator(`a[href="${copyPath}"]`)).toBeVisible();

    await page.goto(alphaPath);
    await expect(column(page, FIRST_LIST).getByRole('link', { name: CARD, exact: true })).toHaveCount(0);
    await page.goto(cardPath);
  });

  await test.step('7. archive shows the band; Send to board returns it to its list', async () => {
    const dialog = modal(page, CARD);
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(dialog.getByText('This card is archived.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send to board' })).toBeVisible();
    // Section 3.7: the tile leaves the board while the card is archived.
    await expect(page.locator(`a[href="${cardPath}"]`)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Send to board' }).click();
    await expect(dialog.getByText('This card is archived.')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
    await expect(column(page, FIRST_LIST).locator(`a[href="${cardPath}"]`)).toBeVisible();
  });

  await test.step('8. the Share link, copied to the clipboard, resolves to this card', async () => {
    const popover = await openSidebar(page, CARD, 'Share', 'Share');
    await popover.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`http://127.0.0.1:8020${cardPath}`);
    await page.keyboard.press('Escape');

    await page.goto(copied);
    await expect(modal(page, CARD)).toBeVisible();
    await expect(page.locator('h1')).toHaveText(BETA);
  });

  await test.step('9. everything above survives a reload', async () => {
    await page.reload();
    const dialog = modal(page, CARD);
    await expect(dialog).toBeVisible();

    await expect(
      dialog.locator(`[aria-labelledby="card-members-label"] [aria-label="${user.fullName}"]`),
    ).toBeVisible();
    const section = dialog.getByRole('region', { name: 'Attachments' });
    await expect(section.locator('li', { hasText: 'brand.png' }).locator('img')).toBeVisible();
    await expect(section.locator('li', { hasText: 'example.com' })).toBeVisible();
    await expect(
      section.locator('li', { hasText: 'brand.png' }).getByRole('button', { name: 'Remove cover' }),
    ).toBeVisible();
    for (const item of ITEMS) {
      await expect(dialog.getByRole('region', { name: CHECKLIST }).getByRole('checkbox', { name: item })).toBeVisible();
    }
    await expect(dialog.getByText('This card is archived.')).toHaveCount(0);
    await expect(dialog.locator('[aria-labelledby="card-labels-label"]')).toHaveCount(0);

    // The cover band is still on the card, and the tile still carries the image and the avatar.
    await expect(dialog.getByRole('button', { name: 'Cover', exact: true })).toHaveCount(2);
    await expect(tileCard(page, cardPath).locator('img')).toBeVisible();
    await expect(tileCard(page, cardPath).locator('[title="Attachments"]')).toHaveText('2');
    await expect(tileCard(page, cardPath).locator('[title="Checklist items"]')).toHaveText('0/2');
  });

  await test.step('10. screenshot the modal with its cover, member, attachment and checklist', async () => {
    // Tall enough for the four things the audit shot has to show at once: the cover band, the
    // Members group, both attachment rows and the checklist under them.
    await page.setViewportSize({ width: 1280, height: 1180 });
    await expect(modal(page, CARD).getByRole('region', { name: CHECKLIST })).toBeVisible();
    await page.screenshot({ path: 'docs/audit/screens/m4a-card.png' });
  });
});
