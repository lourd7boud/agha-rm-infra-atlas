import { expect, test } from '@playwright/test';

// Run fixture server with:
// pnpm --filter @atlas/web exec vite --config e2e-local/metre-workspace.vite.config.ts
test.use({ baseURL: 'http://127.0.0.1:4179' });
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('edits decimal commas, duplicates, undoes deletion and saves filtered-out rows', async ({ page }) => {
  const volume = page.locator('#metre-price-volume');
  await volume.getByRole('textbox', { name: 'Longueur · mesure 1', exact: true }).fill('3,5');
  await expect(volume.locator('tbody')).toContainText('7,00');
  await volume.getByRole('button', { name: 'Dupliquer la mesure 1', exact: true }).click();
  await expect(volume.locator('tbody tr')).toHaveCount(2);
  await volume.getByRole('button', { name: 'Supprimer la mesure 2', exact: true }).click();
  await expect(volume.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Annuler la suppression' }).click();
  await expect(volume.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Rechercher un prix' }).fill('acier');
  await expect(volume).toHaveCount(0);
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  const saved = JSON.parse(await page.getByLabel('Dernière sauvegarde').textContent() ?? '[]');
  expect(saved.find((entry: { bordereauLigneId: string }) => entry.bordereauLigneId === 'volume').lignes).toHaveLength(2);
});

test('retains invalid numeric text through collapse and blocks save until corrected', async ({ page }) => {
  const volume = page.locator('#metre-price-volume');
  const length = volume.getByRole('textbox', { name: 'Longueur · mesure 1', exact: true });
  await length.fill('12x');
  await page.getByRole('button', { name: 'Tout replier' }).click();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('alert')).toContainText('Corrigez les nombres invalides');
  await expect(length).toHaveValue('12x');
  await expect(length).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Nombre de sauvegardes')).toHaveText('0');
  await length.fill('4');
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByLabel('Nombre de sauvegardes')).toHaveText('1');
});

test('keeps an empty article visible when starting entry and Enter creates the next row', async ({ page }) => {
  await page.getByRole('button', { name: /À renseigner/ }).click();
  const empty = page.locator('#metre-price-empty');
  await empty.getByRole('button', { name: /Prix n°3/ }).click();
  await empty.getByRole('button', { name: '+ Mesure', exact: true }).click();
  await expect(empty.getByRole('textbox', { name: 'Désignation · mesure 1', exact: true })).toBeFocused();
  await empty.getByRole('textbox', { name: 'Profondeur · mesure 1', exact: true }).fill('0,2');
  await empty.getByRole('textbox', { name: 'Profondeur · mesure 1', exact: true }).press('Enter');
  await expect(empty.locator('tbody tr')).toHaveCount(2);
  await expect(empty.getByRole('textbox', { name: 'Désignation · mesure 2', exact: true })).toBeFocused();
});

test('preserves last-row deletions and keeps failed saves editable', async ({ page }) => {
  await page.getByLabel('Simuler un échec').check();
  const volume = page.locator('#metre-price-volume');
  await volume.getByRole('button', { name: 'Supprimer la mesure 1', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('alert')).toContainText('Enregistrement impossible');
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeEnabled();
  await page.getByLabel('Simuler un échec').uncheck();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  const saved = JSON.parse(await page.getByLabel('Dernière sauvegarde').textContent() ?? '[]');
  expect(saved.find((entry: { bordereauLigneId: string }) => entry.bordereauLigneId === 'volume').lignes).toEqual([]);
});

test('persists clearing the last row of an article first saved in this session', async ({ page }) => {
  const article = page.locator('#metre-price-empty');
  await article.getByRole('button', { name: /Prix n°3/ }).click();
  await article.getByRole('button', { name: '+ Mesure', exact: true }).click();
  await article.getByRole('textbox', { name: 'Longueur · mesure 1', exact: true }).fill('2');
  await article.getByRole('textbox', { name: 'Largeur · mesure 1', exact: true }).fill('3');
  await article.getByRole('textbox', { name: 'Profondeur · mesure 1', exact: true }).fill('0,5');
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  await article.getByRole('button', { name: 'Supprimer la mesure 1', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  const saved = JSON.parse(await page.getByLabel('Dernière sauvegarde').textContent() ?? '[]');
  expect(saved.find((entry: { bordereauLigneId: string }) => entry.bordereauLigneId === 'empty').lignes).toEqual([]);
});

test('undo after the first save cannot forget that an article exists on the server', async ({ page }) => {
  const article = page.locator('#metre-price-empty');
  await article.getByRole('button', { name: /Prix n°3/ }).click();
  await article.getByRole('button', { name: '+ Mesure', exact: true }).click();
  await article.getByRole('textbox', { name: 'Longueur · mesure 1', exact: true }).fill('2');
  await article.getByRole('textbox', { name: 'Largeur · mesure 1', exact: true }).fill('3');
  await article.getByRole('textbox', { name: 'Profondeur · mesure 1', exact: true }).fill('0,5');
  await article.getByRole('button', { name: 'Dupliquer la mesure 1', exact: true }).click();
  await article.getByRole('button', { name: 'Supprimer la mesure 2', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  await page.getByRole('button', { name: 'Annuler la suppression' }).click();
  await article.getByRole('button', { name: 'Supprimer la mesure 2', exact: true }).click();
  await article.getByRole('button', { name: 'Supprimer la mesure 1', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  const saved = JSON.parse(await page.getByLabel('Dernière sauvegarde').textContent() ?? '[]');
  expect(saved.find((entry: { bordereauLigneId: string }) => entry.bordereauLigneId === 'empty')?.lignes).toEqual([]);
});

test('confines horizontal scrolling to tables on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: 'Rechercher un prix' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('keeps the edited article mounted when it stops exceeding the contract', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  const length = article.getByRole('textbox', { name: 'Longueur · mesure 1', exact: true });
  await length.fill('4');
  await page.getByRole('button', { name: /Dépassements/ }).click();
  await expect(article).toBeVisible();
  await length.fill('1');
  await expect(article).toHaveCount(1, { timeout: 1000 });
  await length.fill('12,5');
  await expect(length).toHaveValue('12,5');
});
