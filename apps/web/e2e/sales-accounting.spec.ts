import { expect, test } from '@playwright/test';

// Read-only journeys use designated test fixtures. Never issue a production
// invoice merely to exercise a browser test.
for (const role of ['DIRECTION', 'COMPTABLE'] as const) {
  test(`${role}: reviews explicit accounting selection`, async ({ page }) => {
    const username = process.env[`ATLAS_E2E_${role}_USER`];
    const password = process.env[`ATLAS_E2E_${role}_PASSWORD`];
    test.skip(!username || !password, 'Dedicated role credentials are required.');
    await page.goto('/login');
    await page.getByRole('button', { name: /se connecter/i }).click();
    await page.locator('#username').fill(username!);
    await page.locator('#password').fill(password!);
    await page.locator('#kc-login').click();
    await page.waitForURL((url) => !url.pathname.includes('/auth/') && !url.pathname.includes('/login'));
    await page.goto('/compta/a-valider');
    await expect(page.getByRole('heading', { name: 'À valider', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Valider les écritures choisies' })).toBeDisabled();
    await expect(page.getByLabel('Confirmer la sélection après relecture')).toBeVisible();
    await expect(page.getByText('Tout valider', { exact: true })).toHaveCount(0);
  });
}

test('admin-si cannot approve a financial entry', async ({ request }) => {
  const token = process.env.ATLAS_E2E_ADMIN_TOKEN;
  test.skip(!token, 'Dedicated admin-si access token is required.');
  const response = await request.post(
    `${process.env.ATLAS_E2E_CORE_URL ?? 'http://localhost:3000/api'}/compta/ecritures/valider-selection`,
    {
      headers: { Authorization: `Bearer ${token}` },
      // Nonexistent ID also prevents accidental mutation if the role guard regresses.
      data: { ids: ['00000000-0000-4000-8000-000000000000'] },
    },
  );
  expect(response.status()).toBe(403);
});
