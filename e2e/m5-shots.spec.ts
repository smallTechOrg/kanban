import { expect, test } from '@playwright/test';

/** Release screenshots for the M5 work: the board menu drawer and the background picker. */

const suffix = `${Date.now()}`.slice(-9);
const user = {
  fullName: 'Priya Raman',
  email: `priya_${suffix}@example.com`,
  username: `priya_${suffix}`,
  password: 'correct horse battery',
};

test('M5: release screenshots of the board menu and the background picker', async ({ page }) => {
  test.setTimeout(120_000);

  // Register through the form, exactly as a new person would.
  await page.goto('/register');
  await page.getByLabel('Full name').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign up' }).click();

  // A board with the default lists, plus a couple of cards so the canvas is not bare.
  await page.getByRole('button', { name: 'Create new board' }).click();
  const popover = page.getByRole('dialog', { name: 'Create board' });
  await popover.getByLabel('Board title').fill('Release audit');
  await popover.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Release audit/ })).toBeVisible();

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
