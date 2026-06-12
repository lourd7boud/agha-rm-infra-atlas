import { expect, test } from '@playwright/test';

/**
 * Critical-flow E2E #2: login → chantiers portfolio → DRETLH detail —
 * the construction-ops surface (équipe, journal, situations) renders.
 */
test('dg opens the chantier portfolio and the DRETLH site sheet', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /keycloak/i }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(
    page.getByRole('heading', { name: 'Tableau de bord' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Chantiers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chantiers' })).toBeVisible();

  await page.getByText('MARCHE 23/2026/DRETLH').first().click();
  await expect(page.getByText('Situations de travaux', { exact: false })).toBeVisible();
  await expect(page.getByText('Journal de chantier', { exact: false })).toBeVisible();
  await expect(page.getByText('Hassan Benali')).toBeVisible();
});
