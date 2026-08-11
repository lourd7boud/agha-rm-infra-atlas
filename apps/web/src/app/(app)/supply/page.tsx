import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import type { ProjectSummary } from '@/lib/projects';
import {
  BUCKET_TONES,
  fmtDate,
  fmtMad,
  ORDER_STATUS_BADGES,
  SUPPLIER_INVOICE_STATUS_BADGES,
  type OrdersSummary,
  type Paged,
  type Payables,
  type PurchaseOrderListItem,
  type SupplierInvoiceRecord,
  type SupplierRecord,
} from '@/lib/supply';
import { OrderLinesEditor } from '@/components/supply/OrderLinesEditor';
import { Pager } from '@/components/ui/Pager';
import { isRedirectError } from '@/lib/next-redirect';

const PAGE_SIZE = 25;

interface CreateLineInput {
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  orderIndex?: number;
}

// One place to turn an action failure into user-visible feedback: log the real
// cause server-side, then redirect back to /supply with a stable code the page
// renders as a banner. The HTTP status (when the cause is an AtlasApiError) rides
// along so a 400 (validation) reads differently from a 5xx (server).
function failToSupply(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[supply] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code =
    status === 400 ? 'invalid' : status === 404 ? 'notfound' : 'failed';
  redirect(`/supply?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createSupplier:invalid':
    'Fournisseur refusé : vérifiez le nom (≥ 2 caractères) et l’e-mail.',
  'createSupplier:failed': "Échec de l'enregistrement du fournisseur. Réessayez.",
  'createOrder:invalid':
    'Bon de commande refusé : fournisseur, référence (≥ 2 car.), objet (≥ 3 car.) et un montant ou des lignes requis.',
  'createOrder:notfound': 'Bon de commande refusé : fournisseur introuvable.',
  'createOrder:failed': "Échec de l'enregistrement du bon de commande. Réessayez.",
  'transitionOrder:invalid': 'Transition refusée : changement de statut illégal.',
  'transitionOrder:failed': 'Échec du changement de statut. Réessayez.',
  'createInvoice:invalid':
    'Facture refusée : fournisseur, référence (≥ 2 car.), montant (> 0) et dates requis.',
  'createInvoice:notfound': 'Facture refusée : fournisseur introuvable.',
  'createInvoice:failed': "Échec de l'enregistrement de la facture. Réessayez.",
  'validateInvoice:failed': 'Échec de la validation de la facture. Réessayez.',
  'payInvoice:failed': 'Échec du paiement de la facture. Réessayez.',
};

function actionErrorMessage(
  error: string | undefined,
  code: string | undefined,
): string | undefined {
  if (!error) return undefined;
  return (
    ACTION_ERROR_MESSAGES[`${error}:${code ?? 'failed'}`] ??
    'Une erreur est survenue. Réessayez.'
  );
}

/** Today as yyyy-mm-dd for the date-input defaults. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse the editor's hidden JSON `lines` field into typed create inputs. */
function parseLines(raw: string): CreateLineInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (line): line is Record<string, unknown> =>
        typeof line === 'object' && line !== null,
    )
    .map((line, index) => ({
      designation: String(line.designation ?? '').trim(),
      quantity: Number(line.quantity),
      unit: line.unit ? String(line.unit) : undefined,
      unitPriceMad: Number(line.unitPriceMad),
      orderIndex: index,
    }))
    .filter(
      (line) =>
        line.designation.length > 0 &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0 &&
        Number.isFinite(line.unitPriceMad) &&
        line.unitPriceMad >= 0,
    );
}

export default async function SupplyPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    code?: string;
    ordersPage?: string;
    invoicesPage?: string;
  }>;
}) {
  const {
    error: actionError,
    code: actionCode,
    ordersPage: ordersPageParam,
    invoicesPage: invoicesPageParam,
  } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const ordersPage = Math.max(0, Math.floor(Number(ordersPageParam)) || 0);
  const invoicesPage = Math.max(0, Math.floor(Number(invoicesPageParam)) || 0);

  // Each list is one bounded DB page + a DB-side total: the orders card reads
  // its cumul from ordersSummary (correct over ALL orders, not just this page),
  // and the invoice totals stay on the payables endpoint (its own aggregate).
  const [suppliers, ordersPageData, ordersSummary, invoicesPageData, payables, projects] =
    await Promise.all([
      apiGet<SupplierRecord[]>('/supply/suppliers'),
      apiGet<Paged<PurchaseOrderListItem>>(
        `/supply/orders?page=${ordersPage}&limit=${PAGE_SIZE}`,
      ),
      apiGet<OrdersSummary>('/supply/orders/summary'),
      apiGet<Paged<SupplierInvoiceRecord>>(
        `/supply/invoices?page=${invoicesPage}&limit=${PAGE_SIZE}`,
      ),
      apiGet<Payables>('/supply/payables'),
      apiGet<ProjectSummary[]>('/project/projects'),
    ]);

  const orders = ordersPageData.items;
  const invoices = invoicesPageData.items;

  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  function supplierLabel(id: string): string {
    return supplierById.get(id)?.name ?? '—';
  }

  function projectLabel(id: string | undefined): string {
    if (!id) return '—';
    return projectById.get(id)?.reference ?? id;
  }

  // Cumul over ALL orders — a DB aggregate, never a reduce over the current page.
  const ordersTotalMad = ordersSummary.totalMad;

  const cards = [
    {
      label: 'Dettes fournisseurs (validées)',
      value: fmtMad(payables.totalMad),
      hint: `${payables.items.length} facture(s) à régler`,
    },
    {
      label: 'Retard +60 jours',
      value: fmtMad(payables.aging['61-90'] + payables.aging['90+']),
      hint: 'à régler en priorité',
    },
    {
      label: 'Bons de commande (cumul)',
      value: fmtMad(ordersTotalMad),
      hint: `${ordersSummary.count} bon(s) de commande`,
    },
    {
      label: 'Fournisseurs actifs',
      value: String(suppliers.filter((s) => s.status === 'actif').length),
      hint: `${suppliers.length} fournisseur(s) au total`,
    },
  ];

  async function createSupplier(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) {
      redirect('/supply?error=createSupplier&code=invalid');
    }
    try {
      await apiPost('/supply/suppliers', {
        name,
        ice: String(formData.get('ice') ?? '') || undefined,
        phone: String(formData.get('phone') ?? '') || undefined,
        email: String(formData.get('email') ?? '') || undefined,
      });
    } catch (error) {
      failToSupply('createSupplier', error);
    }
    revalidatePath('/supply');
  }

  async function createOrder(formData: FormData) {
    'use server';
    const supplierId = String(formData.get('supplierId') ?? '');
    const reference = String(formData.get('reference') ?? '').trim();
    const objet = String(formData.get('objet') ?? '').trim();
    const orderedAt = String(formData.get('orderedAt') ?? '');
    const lines = parseLines(String(formData.get('lines') ?? '[]'));
    // amountMad is required by the API even when lines are present (the repo
    // overrides it with Σ lineTotal); fall back to the line sum so a lines-only
    // form still posts a positive amount.
    const rawAmount = Number(formData.get('amountMad'));
    const linesSum = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPriceMad,
      0,
    );
    const amountMad =
      Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : linesSum;
    if (
      !supplierId ||
      reference.length < 2 ||
      objet.length < 3 ||
      !orderedAt ||
      !(amountMad > 0)
    ) {
      redirect('/supply?error=createOrder&code=invalid');
    }
    try {
      await apiPost('/supply/orders', {
        supplierId,
        projectId: String(formData.get('projectId') ?? '') || undefined,
        reference,
        objet,
        amountMad,
        orderedAt,
        ...(lines.length > 0 ? { lines } : {}),
      });
    } catch (error) {
      failToSupply('createOrder', error);
    }
    revalidatePath('/supply');
  }

  async function transitionOrder(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const to = String(formData.get('to') ?? '');
    if (!id || !to) {
      redirect('/supply?error=transitionOrder&code=invalid');
    }
    try {
      await apiPost(`/supply/orders/${id}/transition`, { to });
    } catch (error) {
      failToSupply('transitionOrder', error);
    }
    revalidatePath('/supply');
  }

  async function createInvoice(formData: FormData) {
    'use server';
    const supplierId = String(formData.get('supplierId') ?? '');
    const reference = String(formData.get('reference') ?? '').trim();
    const amountMad = Number(formData.get('amountMad'));
    const invoiceDate = String(formData.get('invoiceDate') ?? '');
    const dueDate = String(formData.get('dueDate') ?? '');
    if (
      !supplierId ||
      reference.length < 2 ||
      !Number.isFinite(amountMad) ||
      amountMad <= 0 ||
      !invoiceDate ||
      !dueDate
    ) {
      redirect('/supply?error=createInvoice&code=invalid');
    }
    try {
      await apiPost('/supply/invoices', {
        supplierId,
        purchaseOrderId:
          String(formData.get('purchaseOrderId') ?? '') || undefined,
        reference,
        amountMad,
        invoiceDate,
        dueDate,
      });
    } catch (error) {
      failToSupply('createInvoice', error);
    }
    revalidatePath('/supply');
  }

  async function validateInvoice(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    if (!id) redirect('/supply?error=validateInvoice&code=invalid');
    try {
      await apiPost(`/supply/invoices/${id}/validate`);
    } catch (error) {
      failToSupply('validateInvoice', error);
    }
    revalidatePath('/supply');
  }

  async function payInvoice(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    if (!id) redirect('/supply?error=payInvoice&code=invalid');
    try {
      await apiPost(`/supply/invoices/${id}/pay`);
    } catch (error) {
      failToSupply('payInvoice', error);
    }
    revalidatePath('/supply');
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Approvisionnements</h1>
        <p className="mt-1 text-sm text-muted">
          Fournisseurs, bons de commande détaillés et factures fournisseurs —
          dettes et échéancier par fournisseur
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              {card.label}
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-faint">{card.hint}</p>
          </div>
        ))}
      </div>

      {/* ── Payables summary ── */}
      <section className="mb-8 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Dettes fournisseurs — factures validées non payées
          </h2>
          <span className="font-mono text-sm font-bold tabular-nums">
            {fmtMad(payables.totalMad)}
          </span>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="py-2">Fournisseur</th>
                <th className="py-2">Référence</th>
                <th className="py-2 text-right">Montant</th>
                <th className="py-2 text-right">Retard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payables.items.map((item) => (
                <tr key={`${item.supplierName}-${item.reference}`}>
                  <td className="py-2 font-semibold">{item.supplierName}</td>
                  <td className="py-2 font-mono text-xs text-muted">
                    {item.reference}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {fmtMad(item.amountMad)}
                  </td>
                  <td className="py-2 text-right">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${BUCKET_TONES[item.bucket]}`}
                    >
                      {item.daysOverdue}j
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
              Par fournisseur
            </p>
            <ul className="divide-y divide-line">
              {payables.parFournisseur.map((debt) => (
                <li
                  key={debt.supplierName}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="font-medium">
                    {debt.supplierName}
                    <span className="ml-2 text-xs text-faint">
                      {debt.factures} facture(s)
                    </span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {fmtMad(debt.totalMad)}
                  </span>
                </li>
              ))}
            </ul>
            {payables.parFournisseur.length === 0 && (
              <p className="py-4 text-center text-sm text-faint">
                Aucune dette en attente.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Suppliers ── */}
      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Fournisseurs ({suppliers.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">ICE</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td className="px-4 py-3 font-semibold">{supplier.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-faint">
                  {supplier.ice ?? '—'}
                </td>
                <td className="px-4 py-3 text-muted">{supplier.phone ?? '—'}</td>
                <td className="px-4 py-3 text-muted">{supplier.email ?? '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      supplier.status === 'actif'
                        ? 'bg-emerald-soft text-emerald'
                        : 'bg-sand text-faint'
                    }`}
                  >
                    {supplier.status === 'actif' ? 'Actif' : 'Inactif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {suppliers.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun fournisseur — ajoutez-en un ci-dessous.
          </p>
        )}
        <form
          action={createSupplier}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Nom</span>
            <input
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={300}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">ICE</span>
            <input
              type="text"
              name="ice"
              maxLength={20}
              className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Téléphone</span>
            <input
              type="text"
              name="phone"
              maxLength={30}
              className="w-36 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">E-mail</span>
            <input
              type="email"
              name="email"
              maxLength={200}
              className="w-48 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Enregistrer
          </button>
        </form>
      </section>

      {/* ── Purchase orders ── */}
      <section
        id="bons-de-commande"
        className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Bons de commande ({ordersSummary.count}) · cumul{' '}
            <span className="font-mono tabular-nums text-ink-2">
              {fmtMad(ordersTotalMad)}
            </span>
          </h2>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Fournisseur</th>
              <th className="px-4 py-3">Objet</th>
              <th className="px-4 py-3">Chantier</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Lignes</th>
              <th className="px-4 py-3 text-right">Montant</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((order) => {
              const badge = ORDER_STATUS_BADGES[order.status];
              const next =
                order.status === 'brouillon'
                  ? { to: 'envoye', label: 'Envoyer' }
                  : order.status === 'envoye'
                    ? { to: 'recu', label: 'Marquer reçu' }
                    : null;
              return (
                <tr key={order.id} className="transition hover:bg-sand/40">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    <Link
                      href={`/supply/orders/${order.id}`}
                      className="hover:text-cyan"
                    >
                      {order.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {supplierLabel(order.supplierId)}
                  </td>
                  <td className="px-4 py-3 text-muted">{order.objet}</td>
                  <td className="px-4 py-3 text-muted">
                    {projectLabel(order.projectId)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(order.orderedAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-faint">
                    {order.lineCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(order.amountMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {next ? (
                      <form action={transitionOrder} className="inline">
                        <input type="hidden" name="id" value={order.id} />
                        <input type="hidden" name="to" value={next.to} />
                        <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
                          {next.label}
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            {ordersSummary.count === 0
              ? 'Aucun bon de commande — créez-en un ci-dessous.'
              : 'Aucun bon de commande sur cette page.'}
          </p>
        )}
        <Pager
          page={ordersPage}
          pageSize={PAGE_SIZE}
          total={ordersPageData.total}
          hrefForPage={(p) =>
            `/supply?ordersPage=${p}${
              invoicesPage > 0 ? `&invoicesPage=${invoicesPage}` : ''
            }#bons-de-commande`
          }
        />
      </section>

      <section className="mb-6 rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
          Nouveau bon de commande
        </h2>
        <p className="mb-4 text-xs text-faint">
          Ajoutez des lignes pour détailler la commande — le montant est alors la
          somme des lignes (sinon saisissez un montant global).
        </p>
        {suppliers.length > 0 ? (
          <form action={createOrder} className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-sm">
                <span className="mb-1 block text-xs text-muted">Fournisseur</span>
                <select
                  name="supplierId"
                  required
                  defaultValue=""
                  className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                >
                  <option value="" disabled>
                    Sélectionner…
                  </option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Référence</span>
                <input
                  type="text"
                  name="reference"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="BC-2026-001"
                  className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Date</span>
                <input
                  type="date"
                  name="orderedAt"
                  required
                  defaultValue={todayIso()}
                  className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">
                  Chantier (optionnel)
                </span>
                <select
                  name="projectId"
                  className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                >
                  <option value="">—</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.reference}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">Objet</span>
              <input
                type="text"
                name="objet"
                required
                minLength={3}
                maxLength={500}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>

            <OrderLinesEditor />

            <label className="block max-w-xs text-sm">
              <span className="mb-1 block text-xs text-muted">
                Montant global MAD (si pas de lignes)
              </span>
              <input
                type="number"
                name="amountMad"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-md border border-line-2 px-3 py-2 text-right text-sm tabular-nums focus:border-cyan focus:outline-none"
              />
            </label>

            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Enregistrer le bon de commande
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-dashed border-line-2 p-6 text-center text-sm text-faint">
            Enregistrez au moins un fournisseur avant de créer un bon de commande.
          </p>
        )}
      </section>

      {/* ── Supplier invoices ── */}
      <section
        id="factures-fournisseurs"
        className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm"
      >
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Factures fournisseurs ({invoicesPageData.total})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Fournisseur</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Échéance</th>
              <th className="px-4 py-3 text-right">Montant</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoices.map((invoice) => {
              const badge = SUPPLIER_INVOICE_STATUS_BADGES[invoice.status];
              return (
                <tr key={invoice.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    {invoice.reference}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {supplierLabel(invoice.supplierId)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(invoice.invoiceDate)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(invoice.dueDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-clay">
                    {fmtMad(invoice.amountMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {invoice.status === 'recue' && (
                      <form action={validateInvoice} className="inline">
                        <input type="hidden" name="id" value={invoice.id} />
                        <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
                          Valider
                        </button>
                      </form>
                    )}
                    {invoice.status === 'validee' && (
                      <form action={payInvoice} className="inline">
                        <input type="hidden" name="id" value={invoice.id} />
                        <button className="rounded-md bg-emerald-soft px-2.5 py-1 text-xs font-semibold text-emerald transition hover:opacity-80">
                          Payer
                        </button>
                      </form>
                    )}
                    {invoice.status === 'payee' && (
                      <span className="text-xs text-faint">
                        {invoice.paidAt ? `Payée ${fmtDate(invoice.paidAt)}` : 'Payée'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invoices.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            {invoicesPageData.total === 0
              ? 'Aucune facture fournisseur — ajoutez-en une ci-dessous.'
              : 'Aucune facture fournisseur sur cette page.'}
          </p>
        )}
        <Pager
          page={invoicesPage}
          pageSize={PAGE_SIZE}
          total={invoicesPageData.total}
          hrefForPage={(p) =>
            `/supply?invoicesPage=${p}${
              ordersPage > 0 ? `&ordersPage=${ordersPage}` : ''
            }#factures-fournisseurs`
          }
        />
        <form
          action={createInvoice}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="min-w-44 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Fournisseur</span>
            <select
              name="supplierId"
              required
              defaultValue=""
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              <option value="" disabled>
                Sélectionner…
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Bon de commande (optionnel)
            </span>
            <select
              name="purchaseOrderId"
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              <option value="">—</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.reference}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Référence</span>
            <input
              type="text"
              name="reference"
              required
              minLength={2}
              maxLength={100}
              placeholder="F-2026-001"
              className="w-36 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Montant (MAD)</span>
            <input
              type="number"
              name="amountMad"
              required
              min={0.01}
              step="0.01"
              className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Date facture</span>
            <input
              type="date"
              name="invoiceDate"
              required
              defaultValue={todayIso()}
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Échéance</span>
            <input
              type="date"
              name="dueDate"
              required
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Enregistrer
          </button>
        </form>
      </section>
    </div>
  );
}
