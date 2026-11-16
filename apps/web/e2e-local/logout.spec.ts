import { expect, test } from '@playwright/test';

test('logout ends SSO and the next login asks for credentials', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();

  await page.getByRole('button', { name: /Menu utilisateur/ }).first().click();
  await page.getByRole('menuitem', { name: 'Déconnexion' }).click();
  await expect(page).toHaveURL('http://localhost:13001/login');
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain('KEYCLOAK_SESSION');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
});

test('an explicit login requires credentials even when a Keycloak SSO cookie remains', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();

  // Simulate a local-only logout (e.g. an unusable session without an ID token).
  expect((await context.cookies()).map((cookie) => cookie.name)).toContain('KEYCLOAK_SESSION');
  await context.clearCookies({ name: /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/ });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  // With an existing SSO identity, Keycloak requests the password again.
  await expect(page.locator('#password')).toBeVisible();
  expect((await page.request.get('/api/auth/status')).status()).toBe(401);
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
});
