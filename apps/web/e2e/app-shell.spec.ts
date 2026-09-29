import { expect, test, type Page } from '@playwright/test';

async function signInAsDirectionGenerale(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
}

test('login is isolated from every authenticated shell element', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByText('Système opérationnel')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0);
  await expect(page.getByText('ATLAS AI')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /menu utilisateur/i })).toHaveCount(0);
});

test('desktop sidebar is compact, overlays on hover, and keeps the active item clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsDirectionGenerale(page);

  const sidebar = page.getByTestId('desktop-sidebar');
  const content = page.getByTestId('app-content');
  const commandCenter = page.getByRole('link', { name: 'Command Center' });
  const before = await content.boundingBox();

  await expect(sidebar).toHaveAttribute('data-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '72px');
  await expect(commandCenter).toHaveAttribute('aria-current', 'page');
  await expect(commandCenter).toHaveAttribute('data-active', 'true');

  await commandCenter.hover();
  await expect(page.getByRole('tooltip', { name: 'Command Center' })).toBeVisible();
  await expect(sidebar).toHaveAttribute('data-expanded', 'true');
  await expect(sidebar).toHaveCSS('width', '264px');
  await expect(page.getByText('Marchés & Prospection', { exact: true })).toBeVisible();

  const marchesGroup = page.getByRole('button', { name: 'Marchés & Prospection' });
  await marchesGroup.click();
  await expect(marchesGroup).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await page.getByTestId('desktop-sidebar').hover();
  await expect(marchesGroup).toHaveAttribute('aria-expanded', 'false');

  const after = await content.boundingBox();
  expect(after?.x).toBe(before?.x);

  await page.mouse.move(900, 700);
  await expect(sidebar).toHaveAttribute('data-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '72px');
  await expect(commandCenter).toHaveAttribute('data-active', 'true');
  await expect(page.getByText('ATLAS AI')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toHaveCount(0);
});

test('top user menu owns the official Keycloak logout action', async ({ page }) => {
  await signInAsDirectionGenerale(page);

  const publicSession = await (await page.request.get('/api/auth/session')).json();
  expect(publicSession.authenticated).toBe(true);
  expect(publicSession.accessToken).toBeUndefined();
  expect(publicSession.idToken).toBeUndefined();
  expect(publicSession.issuer).toBeUndefined();

  await page.getByRole('button', { name: /menu utilisateur/i }).click();
  const menu = page.getByRole('menu', { name: /menu utilisateur/i });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Direction Generale')).toBeVisible();
  await expect(menu.getByText('marches', { exact: false })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: /menu utilisateur/i }).click();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: /menu utilisateur/i }).click();
  await page.getByRole('heading', { name: 'Tableau de bord' }).click();
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: /menu utilisateur/i }).click();

  await menu.getByRole('menuitem', { name: 'Déconnexion' }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await expect(page.getByTestId('desktop-sidebar')).toBeHidden();

  await page.goBack();
  await expect(page.getByTestId('desktop-sidebar')).toHaveCount(0);
});

test('legacy vault URL permanently resolves to Statut légal & docs', async ({ page }) => {
  await signInAsDirectionGenerale(page);
  const redirectResponse = await page.request.get('/vault', { maxRedirects: 0 });
  expect(redirectResponse.status()).toBe(308);
  expect(redirectResponse.headers().location).toMatch(/\/compta\/legal$/);
  await page.goto('/vault');

  await expect(page).toHaveURL(/\/compta\/legal(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: /Statut légal & documents/i })).toBeVisible();
  await expect(page.getByText('Coffre-fort documentaire')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Documents & GED' })).toHaveCount(0);
});

test('mobile navigation uses a touch-friendly drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDirectionGenerale(page);

  await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation principale' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Command Center' })).toBeVisible();

  await page.keyboard.press('Shift+Tab');
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await drawer.getByRole('link', { name: 'Projets & Chantiers' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
  const reopenedDrawer = page.getByRole('dialog', { name: 'Navigation principale' });
  await expect(reopenedDrawer).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(reopenedDrawer).toHaveCount(0);
});

test('theme toggle switches between dark and light modes and persists preference', async ({
  page,
}) => {
  await signInAsDirectionGenerale(page);

  const toggle = page.getByTestId('theme-toggle').first();
  await expect(toggle).toBeVisible();

  // Initially dark by default
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Click to switch to light mode
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveClass(/light/);

  // Reload page to verify persistence
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');

  // Click to switch back to dark mode
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveClass(/dark/);
});
