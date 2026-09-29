import { expect, test } from '@playwright/test';

/** Release screenshots for the M5 work: the board menu drawer and the background picker. */

/** A fresh board name per run, so the spec also passes against a database that is not empty. */
const suffix = `${Date.now()}`.slice(-9);
const BOARD = `Release audit ${suffix}`;

test('M5: release screenshots of the board menu and the background picker', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');

  // A board with the default lists, plus a couple of cards so the canvas is not bare.
  await page.getByRole('button', { name: 'Create new board' }).click();
  const popover = page.getByRole('dialog', { name: 'Create board' });
  await popover.getByLabel('Board title').fill(BOARD);
  await popover.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: BOARD })).toBeVisible();

  const todo = page.getByRole('region', { name: /To Do/ });
  await todo.getByRole('button', { name: /Add a card/ }).click();
  const composer = todo.getByRole('textbox');
  await composer.fill('Ship the release');
  await composer.press('Enter');
  await composer.fill('Write the changelog');
  await composer.press('Enter');
  await page.keyboard.press('Escape');

  // 1. The board menu drawer.
  await page.getByRole('button', { name: /Show menu/ }).click();
  const drawer = page.getByRole('dialog', { name: /Menu/ }).or(page.getByRole('complementary'));
  await expect(drawer.first()).toBeVisible();
  await page.screenshot({ path: 'docs/audit/screens/m5-board-menu.png' });

  // 2. The background picker, reached from the drawer.
  await page.getByRole('button', { name: /background/i }).first().click();
  await expect(page.getByRole('tab', { name: 'Colors' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'docs/audit/screens/m5-background-picker.png' });
});
