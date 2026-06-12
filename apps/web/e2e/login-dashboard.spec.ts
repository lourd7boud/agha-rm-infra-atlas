import { expect, test } from '@playwright/test';

/**
 * Critical-flow E2E: OIDC login (dg) → tableau de bord → tender wall.
 * Dev credentials from platform/keycloak/atlas-realm.json — never prod.
 */
test('dg signs in and reaches the dashboard and the tender wall', async ({
  page,
}) => {
  await page.goto('/');

  // Auth.js signin page → Keycloak provider button.
  await page.getByRole('button', { name: /keycloak/i }).click();

  // Keycloak login form.
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();

  // Back on the portal: the dashboard renders.
  await expect(
    page.getByRole('heading', { name: 'Tableau de bord' }),
  ).toBeVisible();

  // Tender wall is reachable and shows at least one dossier.
  await page.getByRole('link', { name: 'Mur des échéances' }).click();
  await expect(page.locator('text=AO 23/2026/DRETLH')).toBeVisible();
});
