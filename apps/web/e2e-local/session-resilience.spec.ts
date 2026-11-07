import { expect, test, type Page } from '@playwright/test';

/**
 * Résilience de session à l'échelle du système (pile locale : web :13001 +
 * Keycloak :18081). Ces scénarios vérifient, sur PLUSIEURS modules, qu'une
 * session qui se dégrade ne provoque jamais : rechargement, redirection,
 * bannière périodique, perte de saisie.
 */

const PROJECT_ID = '3435e477-b0d1-4354-94ea-3adcbac13528';
const PERIODE_ID = 'fca76201-743a-4ceb-a4b6-3bdda10c114f';
const METRE_URL = `/projects/${PROJECT_ID}/metres/${PERIODE_ID}`;
const FICHE_URL = `/projects/${PROJECT_ID}?tab=apercu`;

const ROUTES = [
  FICHE_URL,
  METRE_URL,
  '/projects',
  '/tenders',
  '/stock',
  '/equipment',
  '/finance',
] as const;

interface PageWatch {
  loads: number;
  consoleErrors: string[];
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.locator('#username').fill('dg');
  await page.locator('#password').fill('dev-dg-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
}

/** Compte les chargements de document et les erreurs JS non rattrapées. */
function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { loads: 0, consoleErrors: [] };
  page.on('load', () => {
    watch.loads += 1;
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Les 4xx/5xx réseau apparaissent en console : seules les vraies erreurs JS
    // (TypeError, Uncaught…) comptent pour « pas d'erreur console ».
    if (/TypeError|Uncaught|is not a function|Cannot read/i.test(text)) {
      watch.consoleErrors.push(text);
    }
  });
  return watch;
}

/** Marqueur en mémoire : un rechargement le ferait disparaître. */
async function markWindow(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__atlasAlive = 'same-document';
  });
}

async function windowStillAlive(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__atlasAlive === 'same-document',
  );
}

async function triggerForegroundProbe(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(700);
}

const notice = (page: Page) => page.getByTestId('session-notice');
