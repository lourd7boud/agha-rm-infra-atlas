import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const web = process.env.ATLAS_E2E_WEB_URL ?? 'http://localhost:13001';
const core = process.env.ATLAS_E2E_CORE_URL ?? 'http://localhost:13000/api';
const oidc = 'http://localhost:18081';
const suffix = randomUUID().slice(0, 8);
const roles = ['direction', 'comptable', 'admin-si'] as const;
type Role = typeof roles[number];
const accounts = new Map<Role, { id: string; username: string; password: string }>();
let adminToken = '';
let originalSettings: Record<string, unknown> | undefined;
// Resume accounting checks on an already compensated local test invoice.
let invoiceId = process.env.ATLAS_E2E_EXISTING_INVOICE_ID ?? '';
let reference = '';
let entryIds: string[] = [];

async function adminLogin() {
  const variables: string[] = JSON.parse(execFileSync('docker', [
    'inspect', '--format', '{{json .Config.Env}}', 'atlas-local-keycloak-1',
  ], { encoding: 'utf8' }));
  const value = (key: string) => variables.find((item) => item.startsWith(key + '='))?.slice(key.length + 1) ?? '';
  const response = await fetch(oidc + '/realms/master/protocol/openid-connect/token', {
    method: 'POST', body: new URLSearchParams({
      client_id: 'admin-cli', grant_type: 'password',
      username: value('KC_BOOTSTRAP_ADMIN_USERNAME'), password: value('KC_BOOTSTRAP_ADMIN_PASSWORD'),
    }),
  });
  if (!response.ok) throw new Error('Test account setup: administrator authentication failed.');
  adminToken = (await response.json()).access_token;
}

async function admin(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(oidc + '/admin/realms/atlas/' + path, {
    method, headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Test account setup: ${method} ${path} returned ${response.status}.`);
  return response;
}

async function token(role: Role) {
  const account = accounts.get(role)!;
  const response = await fetch(oidc + '/realms/atlas/protocol/openid-connect/token', {
    method: 'POST', body: new URLSearchParams({
      client_id: 'atlas-web', grant_type: 'password',
      username: account.username, password: account.password,
    }),
  });
  if (!response.ok) throw new Error('Test account token request failed: ' + response.status);
  return (await response.json()).access_token as string;
}

async function api(role: Role, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(core + path, {
    method, headers: { Authorization: 'Bearer ' + await token(role), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Test API ${method} ${path} returned ${response.status}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function login(page: Page, role: Role) {
  const account = accounts.get(role)!;
  await page.goto(web + '/login');
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await page.waitForURL((url) => url.origin === web && !url.pathname.includes('/login') && !url.pathname.startsWith('/api/auth'));
}

test.describe.serial('authorized local sales/accounting verification', () => {
  test.skip(process.env.ATLAS_E2E_LIVE !== '1', 'Explicit local write-test opt-in required.');
  test.beforeAll(async () => {
    for (const endpoint of [web, core]) {
      if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) {
        throw new Error('This mutating suite only accepts the authorized local Docker stack.');
      }
    }
    await adminLogin();
    const existingRoles = await (await admin('roles')).json();
    if (!existingRoles.some((role: { name: string }) => role.name === 'comptable')) {
      await admin('roles', 'POST', { name: 'comptable', description: 'Accounting approval and TVA configuration' });
    }
    for (const role of roles) {
      const username = `atlas-e2e-${role}-${suffix}`;
      const password = randomUUID() + '-Aa1!';
      const created = await admin('users', 'POST', {
        username, enabled: true, emailVerified: true,
        firstName: 'ATLAS Test', lastName: role, email: username + '@example.invalid',
        credentials: [{ type: 'password', value: password, temporary: false }],
      });
      const id = created.headers.get('location')!.split('/').at(-1)!;
      accounts.set(role, { id, username, password });
      await admin('users/' + id + '/role-mappings/realm', 'POST', [
        await (await admin('roles/' + role)).json(),
      ]);
    }
    const profile = await api('direction', '/compta/profil');
    originalSettings = Object.fromEntries([
      'faitGenerateurTva', 'compteClientVentes', 'compteProduitVentes', 'compteTvaAttente', 'compteTvaDue',
    ].map((field) => [field, profile[field]]));
    const plan = await api('comptable', '/compta/plan');
    for (const code of ['3421', '71242', '4455', '4456', '5141']) {
      if (!plan.some((account: { code: string }) => account.code === code)) {
        await api('comptable', '/compta/plan', 'POST', { code, intitule: 'Compte de vérification ' + code });
      }
    }
    await api('comptable', '/compta/exercices', 'POST', { annee: new Date().getFullYear() });
  });

  test.afterAll(async () => {
    try {
      if (originalSettings) await api('direction', '/compta/profil/tva', 'PATCH', originalSettings);
    } finally {
      await adminLogin();
      for (const account of accounts.values()) await admin('users/' + account.id, 'DELETE');
    }
  });

  test('direction: draft, issue, partial receipt, reversal, credit note, refund and print', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, 'direction');
    const today = new Date().toISOString().slice(0, 10);
    const client = await api('direction', '/sales/clients', 'POST', {
      name: 'TEST E2E — ' + suffix, clientType: 'professionnel',
      address: 'TEST — Errachidia', ice: '001000000000001',
      notes: 'Automated local verification; not a real customer.',
    });
    const invoice = await api('direction', '/sales/invoices', 'POST', {
      clientId: client.id, invoiceDate: today, tvaPct: 20,
      notes: 'TEST E2E — compensated by credit note and refund.',
      lines: [{ designation: 'TEST E2E — ' + suffix, quantity: 1, unitPriceMad: 1000 }],
    });
    invoiceId = invoice.id;
    await page.goto(web + `/sales/invoices/${invoiceId}/print`);
    await expect(page.getByText('BROUILLON — NON VALABLE', { exact: true })).toBeVisible();
    await page.goto(web + `/sales/invoices/${invoiceId}`);
    await page.getByRole('button', { name: 'Émettre la facture', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^FAC-\d{4}-\d{6}$/);
    reference = await page.getByRole('heading', { level: 1 }).innerText();
    const paymentForm = page.locator('form').filter({ has: page.locator('input[name="amountMad"]') }).first();
    await paymentForm.getByLabel('Montant (MAD)', { exact: true }).fill('400.01');
    await paymentForm.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Partiellement payée', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Contre-passer', exact: true }).click();
    await expect(page.getByText('Non réglée', { exact: true })).toBeVisible();
    for (const amount of ['400.01', '799.99']) {
      await paymentForm.getByLabel('Montant (MAD)', { exact: true }).fill(amount);
      await paymentForm.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect(page.getByText('Opération enregistrée.', { exact: true }).first()).toBeVisible();
      await expect.poll(async () => (await api('direction', `/sales/invoices/${invoiceId}/aggregate`)).settlement.netReceivedCents)
        .toBe(amount === '400.01' ? 40001 : 120000);
    }
    await page.getByLabel('Montant HT (MAD)', { exact: true }).fill('1000');
    await page.getByLabel('TVA (MAD)', { exact: true }).fill('200');
    await page.getByLabel('Motif', { exact: true }).fill('TEST E2E — compensation intégrale');
    await page.getByRole('button', { name: 'Créer l’avoir', exact: true }).click();
    await page.getByRole('button', { name: 'Émettre l’avoir', exact: true }).click();
    await expect(page.getByText('Solde créditeur', { exact: true })).toBeVisible();
    await page.getByLabel('Montant à rembourser (MAD)', { exact: true }).fill('1200');
    await page.getByRole('button', { name: 'Rembourser cet avoir', exact: true }).click();
    await expect(page.getByText('Remboursée', { exact: true })).toBeVisible();
    await page.goto(web + `/sales/invoices/${invoiceId}/print`);
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    await expect(page.getByText('ICE : 001000000000001', { exact: true })).toBeVisible();
    await expect(page.getByText('BROUILLON — NON VALABLE', { exact: true })).toHaveCount(0);
  });

  test('comptable: configures TVA, retries reconciliation and validates explicit entries', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'comptable');
    const events = (await api('comptable', '/compta/reconciliation/ventes')).filter(
      (event: { payload: { invoiceId?: string } }) => event.payload.invoiceId === invoiceId,
    );
    expect(events).toHaveLength(7);
    if (originalSettings?.faitGenerateurTva === 'non_configure') {
      const blocked = await api('comptable', '/compta/reconciliation/ventes/retry', 'POST', {
        ids: events.map((event: { id: string }) => event.id),
      });
      expect(blocked.blocked).toBe(7);
      await page.goto(web + '/compta/a-valider');
      await expect(page.getByText('Le fait générateur de TVA doit être configuré avant la projection comptable.', { exact: true }).first()).toBeVisible();
    }
    await page.goto(web + '/compta/parametres');
    await page.getByLabel('Exigibilité de la TVA').selectOption('encaissement');
    for (const [label, code] of [
      ['Compte clients', '3421'], ['Compte produits des ventes', '71242'],
      ['Compte TVA en attente', '4455'], ['Compte TVA exigible', '4456'],
    ]) await page.getByLabel(label, { exact: true }).fill(code!);
    await page.getByRole('button', { name: 'Enregistrer le fait générateur', exact: true }).click();
    await expect(page.getByText('Configuration enregistrée.', { exact: true })).toBeVisible();
    await page.goto(web + '/compta/a-valider');
    const retry = page.locator('form').filter({ has: page.locator(`input[name="ids"][value="${events[0].id}"]`) });
    await retry.getByRole('button', { name: 'Relancer cet événement', exact: true }).click();
    await expect.poll(async () => (await api('comptable', '/compta/reconciliation/ventes'))
      .find((event: { id: string }) => event.id === events[0].id).status).toBe('projected');
    const reconciled = await api('comptable', '/compta/reconciliation/ventes/retry', 'POST', {
      ids: events.map((event: { id: string }) => event.id),
    });
    expect(reconciled.blocked).toBe(0);
    entryIds = reconciled.records.map((event: { accountingEntryId: string }) => event.accountingEntryId);
    await page.goto(web + '/compta/a-valider');
    await expect(page.getByRole('button', { name: 'Valider les écritures choisies' })).toBeDisabled();
    await page.locator(`input[type="checkbox"][value="${entryIds[0]}"]`).check();
    await page.getByLabel('Confirmer la sélection après relecture').check();
    await page.getByRole('button', { name: 'Valider les écritures choisies' }).click();
    await expect.poll(async () => (await api('comptable', '/compta/ecritures/' + entryIds[0])).statut).toBe('validee');
    expect((await api('comptable', '/compta/ecritures/' + entryIds[0])).validatedBy).toBe(accounts.get('comptable')!.username);
    // Approve the full compensating sequence so test postings have a zero net balance.
    await api('comptable', '/compta/ecritures/valider-selection', 'POST', { ids: entryIds.slice(1) });
  });

  test('admin-si: read-only approval UI and denied financial commands', async ({ page }) => {
    await login(page, 'admin-si');
    await page.goto(web + '/compta/a-valider');
    await expect(page.getByText(/Lecture seule — validation réservée/)).toBeVisible();
    for (const [path, method, body] of [
      ['/compta/ecritures/valider-selection', 'POST', { ids: [entryIds.at(-1)] }],
      ['/compta/profil/tva', 'PATCH', { faitGenerateurTva: 'debits' }],
    ] as const) {
      const response = await fetch(core + path, {
        method, headers: { Authorization: 'Bearer ' + await token('admin-si'), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(403);
    }
  });
});
