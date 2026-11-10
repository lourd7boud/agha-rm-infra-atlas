import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('previews reordered Excel columns, appends atomically and undoes the import', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  await article.getByRole('button', { name: 'Coller un tableau', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importer des mesures' });
  await dialog.getByLabel('Tableau à importer').fill('Désignation\tProfondeur\tLongueur\tNb semblables\tLargeur\tPartiel\nS2\t0,5\t3\t2\t2\t6\nS3\t0,2\t4\t1\t4\t3,2');
  await expect(article.getByRole('table', { name: 'Mesures M³', exact: true }).locator('tbody tr')).toHaveCount(1);
  await expect(dialog).toContainText('9,20');
  await dialog.getByRole('button', { name: /Ajouter 2 mesure/ }).click();
  await expect(article.locator('tbody tr')).toHaveCount(3);
  await expect(article.locator('tfoot')).toContainText('15,20');
  await page.getByRole('button', { name: 'Annuler l’import' }).click();
  await expect(article.locator('tbody tr')).toHaveCount(1);
});

test('blocks mixed-unit and malformed imports, with accessible close and focus restoration', async ({ page }) => {
  const opener = page.locator('#metre-price-steel').getByRole('button', { name: 'Coller un tableau', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tableau à importer').fill('Désignation\tNombre\tNombre d’éléments\tLongueur\tØ (mm)\tUnité\nP1\t4\t2\t3\t12\tT');
  await expect(dialog).toContainText('Unité T incompatible avec KG');
  await expect(dialog.getByRole('button', { name: /Ajouter 1 mesure/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a template previews repeated foundations and requires deliberate insertion', async ({ page }) => {
  const article = page.locator('#metre-price-empty');
  await article.getByRole('button', { name: /Prix n°3/ }).click();
  await article.getByRole('button', { name: 'Modèle d’ouvrage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modèle d’ouvrage' });
  await dialog.getByLabel('Repère du modèle').fill('Semelle S4');
  await dialog.getByLabel('Modèle · Nb semblables', { exact: true }).fill('8');
  await dialog.getByLabel('Modèle · Longueur', { exact: true }).fill('2');
  await dialog.getByLabel('Modèle · Largeur', { exact: true }).fill('2');
  await dialog.getByLabel('Modèle · Profondeur', { exact: true }).fill('0,5');
  await expect(dialog).toContainText('16,00');
  await expect(article.locator('tbody tr')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Ajouter cette mesure' }).click();
  await expect(article.getByLabel('Désignation · mesure 1', { exact: true })).toHaveValue('Semelle S4');
  await expect(article.locator('tfoot')).toContainText('16,00');
});

test('bulk fill changes only selected rows and undo restores the batch', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  await article.getByRole('button', { name: 'Dupliquer la mesure 1', exact: true }).click();
  await article.getByLabel('Sélectionner la mesure 1', { exact: true }).check();
  await article.getByLabel('Champ de remplissage groupé').selectOption('longueur');
  await article.getByLabel('Valeur de remplissage groupé').fill('5,5');
  await article.getByRole('button', { name: /Appliquer à 1 mesure/ }).click();
  await expect(article.getByLabel('Longueur · mesure 1', { exact: true })).toHaveValue('5,5');
  await expect(article.getByLabel('Longueur · mesure 2', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Annuler la modification groupée' }).click();
  await expect(article.getByLabel('Longueur · mesure 1', { exact: true })).toHaveValue('3');
});

test('review explains possible duplicates and navigates to the measured row', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  await article.getByRole('button', { name: 'Dupliquer la mesure 1', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Assistant de contrôle' }).click();
  await page.getByLabel('Filtrer les contrôles').selectOption('duplicate');
  await expect(page.getByText('Repères et dimensions identiques', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Tout replier' }).click();
  await page.getByRole('button', { name: 'Voir la mesure' }).first().click();
  await expect(article.getByLabel('Désignation · mesure 1', { exact: true })).toBeFocused();
});

test('bulk correction synchronizes invalid drafts and undo restores the invalid text', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  const length = article.getByLabel('Longueur · mesure 1', { exact: true });
  await length.fill('12x');
  await article.getByLabel('Sélectionner la mesure 1', { exact: true }).check();
  await article.getByLabel('Champ de remplissage groupé').selectOption('longueur');
  await article.getByLabel('Valeur de remplissage groupé').fill('5,5');
  await article.getByRole('button', { name: /Appliquer à 1 mesure/ }).click();
  await expect(length).toHaveValue('5,5');
  await expect(length).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Annuler la modification groupée' }).click();
  await expect(length).toHaveValue('12x');
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('alert')).toContainText('Corrigez les nombres invalides');
});

test('identifies errors beyond the first fifty pasted rows', async ({ page }) => {
  await page.locator('#metre-price-volume').getByRole('button', { name: 'Coller un tableau', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const rows = Array.from({ length: 50 }, (_, index) => `S${index}\t1\t2\t3\t0,5`);
  rows.push('Erreur51\t1\t2\t3\tBAD');
  await dialog.getByLabel('Tableau à importer').fill(rows.join('\n'));
  await expect(dialog.getByText(/BAD.*n’est pas un nombre/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Ajouter 51 mesure/ })).toBeDisabled();
});

test('prevents saving a non-finite calculated quantity from manual entry', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  const huge = '1' + '0'.repeat(200);
  await article.getByLabel('Longueur · mesure 1', { exact: true }).fill(huge);
  await article.getByLabel('Largeur · mesure 1', { exact: true }).fill(huge);
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('alert')).toContainText('dépasse la capacité numérique');
  await expect(page.getByLabel('Nombre de sauvegardes')).toHaveText('0');
});

test('pasting a multi-cell table in a grid opens preview rather than overwriting a cell', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  await article.getByLabel('Désignation · mesure 1', { exact: true }).evaluate((element) => {
    const clipboard = new DataTransfer(); clipboard.setData('text/plain', 'Import\t1\t2\t3\t0,5');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Tableau à importer')).toHaveValue('Import\t1\t2\t3\t0,5');
  await dialog.getByRole('button', { name: 'Fermer la saisie assistée' }).click();
  await expect(article.getByLabel('Désignation · mesure 1', { exact: true })).toHaveValue('Semelle S1');
});

test('steel template includes the destination element factor and saves into that element', async ({ page }) => {
  const article = page.locator('#metre-price-steel');
  await article.getByRole('button', { name: '+ Lieu (section)', exact: true }).click();
  await article.getByLabel('Nom du lieu').fill('Zone test');
  await article.getByRole('button', { name: '+ Élément', exact: true }).click();
  await article.getByLabel('Nom de l’élément').fill('Poteaux test');
  await article.getByRole('textbox', { name: /Nombre d’éléments identiques de cet élément/ }).fill('8');
  await article.getByRole('button', { name: 'Modèle d’ouvrage', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Repère du modèle').fill('Ferraillage P1');
  await dialog.getByLabel('Modèle · Nombre', { exact: true }).fill('4');
  await dialog.getByLabel('Modèle · Nombre d’éléments', { exact: true }).fill('2');
  await dialog.getByLabel('Modèle · Longueur (ml)', { exact: true }).fill('3');
  await expect(dialog).toContainText('170,50');
  await dialog.getByRole('button', { name: 'Ajouter cette mesure' }).click();
  await page.getByRole('button', { name: 'Enregistrer et générer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer et générer' })).toBeDisabled();
  const saved = JSON.parse(await page.getByLabel('Dernière sauvegarde').textContent() ?? '[]');
  const entry = saved.find((item: { bordereauLigneId: string }) => item.bordereauLigneId === 'steel');
  expect(entry.lignes.find((line: { designation: string }) => line.designation === 'Ferraillage P1').subSectionId).toBe(entry.sousSections[0].id);
  expect(entry.sousSections[0].nombreElements).toBe(8);
});

test('selected row duplication and deletion are reversible without touching other prices', async ({ page }) => {
  const article = page.locator('#metre-price-volume');
  await article.getByLabel('Sélectionner toutes les mesures').check();
  await article.getByRole('button', { name: 'Dupliquer la sélection', exact: true }).click();
  await expect(article.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('#metre-price-steel tbody tr')).toHaveCount(1);
  await article.getByLabel('Sélectionner toutes les mesures').check();
  await article.getByRole('button', { name: 'Supprimer la sélection', exact: true }).click();
  await expect(article.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Annuler la suppression' }).click();
  await expect(article.locator('tbody tr')).toHaveCount(2);
});

test('bulk import remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#metre-price-volume').getByRole('button', { name: 'Coller un tableau', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Charger un exemple', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Ajouter 1 mesure/ })).toBeEnabled();
  const fits = await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an unknown repetition column requires explicit mapping before insertion', async ({ page }) => {
  await page.locator('#metre-price-volume').getByRole('button', { name: 'Coller un tableau', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tableau à importer').fill('Désignation\tNbre\tLongueur\tLargeur\tProfondeur\nS1\t8\t2\t2\t0,5');
  await expect(dialog.getByRole('button', { name: /Ajouter 1 mesure/ })).toBeDisabled();
  await dialog.getByLabel('Destination colonne 2').selectOption('nombreSemblables');
  await expect(dialog.getByRole('button', { name: /Ajouter 1 mesure/ })).toBeEnabled();
  await expect(dialog).toContainText('16,00');
});
