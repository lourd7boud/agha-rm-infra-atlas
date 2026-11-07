import { expect, test, type Page } from '@playwright/test';

// Jeu de données réel de la pile locale : deux marchés ayant une période
// précédente dont les mesures détaillées sont enregistrées.
const CIBLES = [
  {
    libelle: 'Métré n°2',
    projectId: '8ee1305d-812d-4a1f-ad08-19b166c41c60',
    periodeId: 'e6ab7a60-b234-4108-b477-092245ede322',
    capture: 'metre-p2-details.png',
  },
  {
    libelle: 'Métré n°3',
    projectId: '3435e477-b0d1-4354-94ea-3adcbac13528',
    periodeId: 'fca76201-743a-4ceb-a4b6-3bdda10c114f',
    capture: 'metre-p3-details.png',
  },
];

const CAPTURES = 'C:/Users/AGH ABDERRAHIM/Desktop/AGHA RM INFRA/tmp';

async function signInAsDirectionGenerale(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  // La coquille applicative n'apparaît qu'une fois la session NextAuth posée :
  // attendre la navigation latérale (jamais visible sur /login).
  await expect(
    page.getByRole('navigation', { name: 'Navigation principale' }),
  ).toBeVisible();
}

for (const cible of CIBLES) {
  test(`« Afficher les détails » déplie les mesures de la période précédente — ${cible.libelle}`, async ({
    page,
  }) => {
    await signInAsDirectionGenerale(page);
    await page.goto(`/projects/${cible.projectId}/metres/${cible.periodeId}`);

    await expect(page.getByText('Périodes précédentes (lecture seule)').first()).toBeVisible();

    const toggle = page.getByRole('button', { name: /Afficher les détails/ }).first();
    await expect(toggle).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/metre-details-ferme.png` });

    const detailsId = await toggle.getAttribute('aria-controls');
    expect(detailsId).toBeTruthy();
    await expect(page.locator(`[id="${detailsId}"] table`)).toHaveCount(0);

    await toggle.click();
    await expect(page.getByRole('button', { name: /Masquer les détails/ }).first()).toBeVisible();
    const detailTable = page.locator(`[id="${detailsId}"] table`);
    await expect(detailTable).toBeVisible();
    await expect(detailTable.getByRole('columnheader', { name: 'Partiel' })).toBeVisible();

    await page.screenshot({ path: `${CAPTURES}/${cible.capture}`, fullPage: true });
  });
}
