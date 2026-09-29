import { expect, test, type Page } from '@playwright/test';

// Sonde TEMPORAIRE : décrit les formulaires/champs réellement présents sur les
// pages ciblées par les tests de résilience de session.
async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
}

const CIBLES = [
  ['metre-p3', '/projects/3435e477-b0d1-4354-94ea-3adcbac13528/metres/fca76201-743a-4ceb-a4b6-3bdda10c114f'],
  ['project-detail', '/projects/3435e477-b0d1-4354-94ea-3adcbac13528?tab=apercu'],
  ['decompte', '/projects/156a457a-f214-42de-a8b4-e3c67f47c646?tab=decomptes'],
] as const;

test('probe: inventaire des formulaires', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  for (const [label, url] of CIBLES) {
    await page.goto(url);
    const inventory = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      return forms.slice(0, 6).map((form, index) => ({
        index,
        method: form.method,
        action: form.getAttribute('action')?.slice(0, 40) ?? null,
        inputs: Array.from(form.querySelectorAll('input, textarea, select'))
          .slice(0, 8)
          .map((el) => {
            const input = el as HTMLInputElement;
            return `${input.tagName.toLowerCase()}:${input.type || '-'}:${input.name || '-'}`;
          }),
        buttons: Array.from(form.querySelectorAll('button'))
          .slice(0, 4)
          .map((button) => button.textContent?.trim().slice(0, 40)),
      }));
    });
    console.log(`[forms ${label}] ${JSON.stringify(inventory)}`);
    const looseInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).slice(0, 12).map((input) => {
        const el = input as HTMLInputElement;
        return `${el.type || '-'}:${el.name || '-'}:${el.getAttribute('placeholder')?.slice(0, 24) ?? '-'}`;
      }),
    );
    console.log(`[inputs ${label}] ${JSON.stringify(looseInputs)}`);
  }
});
