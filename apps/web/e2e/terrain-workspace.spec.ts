import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// Opt-in, read-only verification of the local workspace. Credentials come from
// the local development realm; no password is copied into test output.
const baseURL = process.env.TERRAIN_E2E_BASE_URL;
const projectId = process.env.TERRAIN_E2E_PROJECT_ID;
test.use({ baseURL, channel: 'msedge' });
test.skip(!baseURL || !projectId, 'Set local Terrain E2E URL and project UUID');

test('Terrain overview, production and mobile offline draft recovery', async ({ page, context }) => {
  test.setTimeout(120_000);
  const realm = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../platform/keycloak/atlas-realm.json'), 'utf8'));
  const user = realm.users.find((entry: { username: string }) => entry.username === 'dg');
  const password = user.credentials.find((entry: { type: string }) => entry.type === 'password').value;
  await expect.poll(async () => {
    try { return (await page.request.get('/login')).status(); } catch { return 0; }
  }, { timeout: 30_000 }).toBe(200);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`/projects/${projectId}?section=terrain&tab=t-apercu`);
  if (!page.url().includes(':18081')) {
    const provider = page.getByRole('button', { name: /keycloak|se connecter/i });
    if (await provider.count()) await provider.first().click();
  }
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL((url) => url.port === new URL(baseURL!).port);
  await page.goto(`/projects/${projectId}?section=terrain&tab=t-apercu`);
  await expect(page.getByRole('heading', { name: 'Le terrain, au quotidien' })).toBeVisible();
  await expect(page.getByText('Marge brute estimée', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Dernier décompte · TTC', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve(process.cwd(), '../../artifacts/terrain-overview-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Production', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Les quantités, ouvrage par ouvrage' })).toBeVisible();
  await page.goto(`/projects/${projectId}?section=terrain&tab=journee`);
  await expect(page.getByLabel('Zone par défaut *', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.locator('h1').locator('..').locator('..').boundingBox())!.width).toBeGreaterThan(250);
  const submit = page.getByRole('button', { name: 'Transmettre au bureau', exact: true });
  expect(await submit.evaluate((element) => { const style = getComputedStyle(element); return style.color !== style.backgroundColor; })).toBe(true);
  await page.getByRole('heading', { name: 'Journée du chantier', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.resolve(process.cwd(), '../../artifacts/terrain-journee-mobile.png') });
  // Browser-local draft only: the test never transmits or reviews business data.
  await context.setOffline(true);
  await page.getByLabel('Zone par défaut *', { exact: true }).fill('Vérification locale E2E');
  await page.getByLabel('Travaux et faits marquants *', { exact: true }).fill('Brouillon hors connexion, non transmis');
  const equipment = page.locator('details').filter({ hasText: 'Matériel et engins' }).first();
  await equipment.locator('summary').click();
  await equipment.getByRole('button', { name: '+ Ajouter', exact: true }).click();
  await equipment.getByLabel('Engin / matériel *', { exact: true }).fill('Pelle test local');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('atlas:terrain:journee:')).map((key) => localStorage.getItem(key)).join(''))).toContain('Brouillon hors connexion');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('atlas:terrain:journee:')).map((key) => localStorage.getItem(key)).join(''))).toContain('Pelle test local');
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre le brouillon local', exact: true }).click();
  await expect(page.getByLabel('Zone par défaut *', { exact: true })).toHaveValue('Vérification locale E2E');
  await expect(page.getByLabel('Engin / matériel *', { exact: true })).toHaveValue('Pelle test local');
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('atlas:terrain:journee:')) localStorage.removeItem(key); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
