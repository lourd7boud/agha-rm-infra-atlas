import { expect, test, type Page } from '@playwright/test';

// Sonde TEMPORAIRE : observe le comportement réel de /api/auth/status et
// l'apparition de la bannière « Session expirée » sur la pile locale.
async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
}

test('probe: cadence réelle du watchdog de session', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await page.goto('/projects');

  for (let i = 0; i < 12; i += 1) {
    const started = Date.now();
    const response = await page.request.get('/api/auth/status');
    const body = await response.text();
    const cookieNames = (await page.context().cookies())
      .filter((cookie) => cookie.name.includes('authjs'))
      .map((cookie) => `${cookie.name}@${cookie.expires}`);
    const banner = await page.getByText('Session expirée.').count();
    const noticeCount = await page.getByText('Reconnectez-vous pour continuer').count();
    console.log(
      `[probe ${i}] t=${Math.round((Date.now() - started) / 1000)}s status=${response.status()}` +
        ` setCookie=${response.headers()['set-cookie'] ? 'yes' : 'no'} banner=${banner}` +
        ` notice=${noticeCount} body=${body} cookies=${cookieNames.join('|')}`,
    );
    await page.waitForTimeout(10_000);
  }
});
