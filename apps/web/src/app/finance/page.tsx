import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import type { ProjectSummary } from '@/lib/projects';
import { fmtMad } from '@/lib/projects';
import {
  EXPENSE_CATEGORY_BADGES,
  EXPENSE_CATEGORY_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  type Cashflow,
  type ExpenseCategory,
  type ExpenseRecord,
  type ExpenseSummary,
  type Paged,
  type PaymentRecord,
  type SupplierRecord,
} from '@/lib/finance';
import { isRedirectError } from '@/lib/next-redirect';
import { Pager } from '@/components/ui/Pager';

/** Rows per page for the paginated ledger lists (payments + expenses). */
const PAGE_SIZE = 25;

/** Parse a ?…Page query value into a zero-based, non-negative page index. */
function parsePageParam(value: string | undefined): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface CautionItem {
  id: string;
  kind: 'provisoire' | 'definitive' | 'retenue_remplacee';
  reference: string;
  amountMad: number;
  bankName?: string;
  issuedAt: string;
  status: 'active' | 'liberee';
}

interface CautionsResponse {
  summary: {
    activeCount: number;
    activeTotalMad: number;
    byKind: Record<CautionItem['kind'], number>;
    staleCount: number;
    staleTotalMad: number;
  };
  items: CautionItem[];
}

interface ReceivableItem {
  projectReference: string;
  buyerName: string;
  numero: number;
  netAPayerMad: number;
  periodEnd: string;
  daysOutstanding: number;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
}

interface ReceivablesResponse {
  items: ReceivableItem[];
  totalMad: number;
  aging: Record<ReceivableItem['bucket'], number>;
}

const KIND_LABELS: Record<CautionItem['kind'], string> = {
  provisoire: 'Provisoire',
  definitive: 'Définitive',
  retenue_remplacee: 'Retenue remplacée',
};

const BUCKET_TONES: Record<ReceivableItem['bucket'], string> = {
  '0-30': 'bg-emerald-soft text-emerald',
  '31-60': 'bg-ochre-soft text-ochre',
  '61-90': 'bg-ochre-soft text-ochre-deep',
  '90+': 'bg-clay-soft text-clay',
};

// One place to turn an action failure into user-visible feedback: log the real
// cause server-side, then redirect back to /finance with a stable error code the
// page renders as a banner. The HTTP status (when the cause is an AtlasApiError)
// rides along so a 400 (validation) reads differently from a 5xx (server).
function failToFinance(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[finance] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/finance?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createPayment:invalid':
    'Encaissement refusé : vérifiez le libellé (≥ 3 caractères), le montant (> 0) et la date.',
  'createPayment:failed':
    "Échec de l'enregistrement de l'encaissement. Réessayez.",
  'createExpense:invalid':
    'Dépense refusée : vérifiez la catégorie, le libellé (≥ 3 caractères), le montant (> 0) et la date.',
  'createExpense:failed': "Échec de l'enregistrement de la dépense. Réessayez.",
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

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-MA');
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    code?: string;
    category?: string;
    paymentsPage?: string;
    expensesPage?: string;
  }>;
}) {
  const {
    error: actionError,
    code: actionCode,
    category: rawCategory,
    paymentsPage: rawPaymentsPage,
    expensesPage: rawExpensesPage,
  } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);

  // Validate the category filter against the known list before forwarding it to
  // the API (the backend rejects unknown categories with a 400).
  const activeCategory = EXPENSE_CATEGORY_OPTIONS.some(
    (option) => option.value === rawCategory,
  )
    ? (rawCategory as ExpenseCategory)
    : undefined;

  // Independent zero-based page indices for each list — one list paging never
  // moves the other (each pager preserves the other list's page + the category).
  const paymentsPage = parsePageParam(rawPaymentsPage);
  const expensesPage = parsePageParam(rawExpensesPage);

  // Fetch exactly one bounded page per list (DB-side LIMIT/OFFSET); the category
  // scope rides on the expenses request only.
  const paymentsPath = `/finance/payments?page=${paymentsPage}&limit=${PAGE_SIZE}`;
  const expensesQuery = new URLSearchParams({
    page: String(expensesPage),
    limit: String(PAGE_SIZE),
  });
  if (activeCategory) expensesQuery.set('category', activeCategory);
  const expensesPath = `/finance/expenses?${expensesQuery.toString()}`;

  const [
    cautions,
    receivables,
    payments,
    expenses,
    expenseSummary,
    cashflow,
    projects,
    suppliers,
  ] = await Promise.all([
    apiGet<CautionsResponse>('/finance/cautions'),
    apiGet<ReceivablesResponse>('/finance/receivables'),
    apiGet<Paged<PaymentRecord>>(paymentsPath),
    apiGet<Paged<ExpenseRecord>>(expensesPath),
    apiGet<ExpenseSummary>('/finance/expenses/summary'),
    apiGet<Cashflow>('/finance/cashflow'),
    apiGet<ProjectSummary[]>('/project/projects'),
    apiGet<SupplierRecord[]>('/supply/suppliers'),
  ]);

  // Per-list href builders for the two pagers: each preserves the OTHER list's
  // page param and the active category so paging one section is isolated.
  function paymentsHref(page: number): string {
    const params = new URLSearchParams();
    if (page > 0) params.set('paymentsPage', String(page));
    if (expensesPage > 0) params.set('expensesPage', String(expensesPage));
    if (activeCategory) params.set('category', activeCategory);
    const qs = params.toString();
    return qs ? `/finance?${qs}` : '/finance';
  }

  function expensesHref(page: number): string {
    const params = new URLSearchParams();
    if (page > 0) params.set('expensesPage', String(page));
    if (paymentsPage > 0) params.set('paymentsPage', String(paymentsPage));
    if (activeCategory) params.set('category', activeCategory);
    const qs = params.toString();
    return qs ? `/finance?${qs}` : '/finance';
  }

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const supplierById = new Map(
    suppliers.map((supplier) => [supplier.id, supplier]),
  );

  function projectLabel(id: string | undefined): string {
    if (!id) return '—';
    return projectById.get(id)?.reference ?? id;
  }

  function supplierLabel(id: string | undefined): string {
    if (!id) return '—';
    return supplierById.get(id)?.name ?? id;
  }

  const cards = [
    {
      label: 'Cautions actives (cash bloqué)',
      value: fmtMad(cautions.summary.activeTotalMad),
      hint: `${cautions.summary.activeCount} caution(s) en banque`,
    },
    {
      label: 'À encaisser (décomptes validés)',
      value: fmtMad(receivables.totalMad),
      hint: `${receivables.items.length} décompte(s) en attente TGR`,
    },
    {
      label: 'Retard +60 jours',
      value: fmtMad(receivables.aging['61-90'] + receivables.aging['90+']),
      hint: 'à relancer en priorité',
    },
    {
      label: 'Cautions à libérer (>1 an)',
      value: fmtMad(cautions.summary.staleTotalMad),
      hint: `${cautions.summary.staleCount} mainlevée(s) à demander`,
    },
  ];

  async function createPayment(formData: FormData) {
    'use server';
    const label = String(formData.get('label') ?? '').trim();
    const amountMad = Number(formData.get('amountMad'));
    const method = String(formData.get('method') ?? '');
    const paidAt = String(formData.get('paidAt') ?? '');
    if (
      label.length < 3 ||
      !Number.isFinite(amountMad) ||
      amountMad <= 0 ||
      !method ||
      !paidAt
    ) {
      redirect('/finance?error=createPayment&code=invalid');
    }
    try {
      await apiPost('/finance/payments', {
        label,
        amountMad,
        method,
        paidAt,
        payerName: String(formData.get('payerName') ?? '') || undefined,
        transferReference:
          String(formData.get('transferReference') ?? '') || undefined,
        bankName: String(formData.get('bankName') ?? '') || undefined,
        projectId: String(formData.get('projectId') ?? '') || undefined,
      });
    } catch (error) {
      failToFinance('createPayment', error);
    }
    revalidatePath('/finance');
  }

  async function createExpense(formData: FormData) {
    'use server';
    const category = String(formData.get('category') ?? '');
    const label = String(formData.get('label') ?? '').trim();
    const amountMad = Number(formData.get('amountMad'));
    const spentAt = String(formData.get('spentAt') ?? '');
    // Validate the category against the closed list (same guard the filter uses
    // above) so the action rejects unknown categories itself instead of relying
    // on the backend Zod enum to bounce them.
    const isKnownCategory = EXPENSE_CATEGORY_OPTIONS.some(
      (option) => option.value === category,
    );
    if (
      !isKnownCategory ||
      label.length < 3 ||
      !Number.isFinite(amountMad) ||
      amountMad <= 0 ||
      !spentAt
    ) {
      redirect('/finance?error=createExpense&code=invalid');
    }
    try {
      await apiPost('/finance/expenses', {
        category,
        label,
        amountMad,
        spentAt,
        method: String(formData.get('method') ?? '') || undefined,
        reference: String(formData.get('reference') ?? '') || undefined,
        supplierId: String(formData.get('supplierId') ?? '') || undefined,
        projectId: String(formData.get('projectId') ?? '') || undefined,
      });
    } catch (error) {
      failToFinance('createExpense', error);
    }
    revalidatePath('/finance');
  }

  const expenseLineCount = expenseSummary.byCategory.reduce(
    (sum, row) => sum + row.count,
    0,
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Trésorerie</h1>
        <p className="mt-1 text-sm text-muted">
          Cash bloqué en garanties, créances sur décomptes validés, et journal
          des encaissements / dépenses
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

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Créances — décomptes validés non payés
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Marché</th>
                <th className="px-4 py-3">N°</th>
                <th className="px-4 py-3 text-right">Net à payer</th>
                <th className="px-4 py-3 text-right">Retard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {receivables.items.map((item) => (
                <tr key={`${item.projectReference}-${item.numero}`}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{item.projectReference}</span>
                    <span className="block text-xs text-faint">
                      {item.buyerName}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{item.numero}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(item.netAPayerMad)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${BUCKET_TONES[item.bucket]}`}
                    >
                      {item.daysOutstanding}j
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {receivables.items.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucune créance en attente.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Registre des cautions
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Montant</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cautions.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{item.reference}</span>
                    {item.bankName && (
                      <span className="block text-xs text-faint">
                        {item.bankName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {KIND_LABELS[item.kind]}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(item.amountMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        item.status === 'active'
                          ? 'bg-ochre-soft text-ochre'
                          : 'bg-emerald-soft text-emerald'
                      }`}
                    >
                      {item.status === 'active' ? 'Bloquée' : 'Libérée'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cautions.items.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucune caution enregistrée.
            </p>
          )}
        </section>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Encaissements (cumul)
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums text-emerald">
            {fmtMad(cashflow.incomesMad)}
          </p>
          <p className="mt-1 text-xs text-faint">
            {payments.total} encaissement(s)
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Dépenses (cumul)
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums text-clay">
            {fmtMad(cashflow.expensesMad)}
          </p>
          <p className="mt-1 text-xs text-faint">{expenseLineCount} dépense(s)</p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Trésorerie nette
          </p>
          <p
            className={`mt-2 font-mono text-lg font-bold tabular-nums ${
              cashflow.netMad < 0 ? 'text-clay' : 'text-emerald'
            }`}
          >
            {fmtMad(cashflow.netMad)}
          </p>
          <p className="mt-1 text-xs text-faint">encaissements − dépenses</p>
        </div>
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Paiements / Encaissements ({payments.total})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3">Payeur</th>
              <th className="px-4 py-3">Chantier</th>
              <th className="px-4 py-3">Méthode</th>
              <th className="px-4 py-3">Réf. virement</th>
              <th className="px-4 py-3 text-right">Montant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payments.items.map((payment) => (
              <tr key={payment.id}>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                  {fmtDate(payment.paidAt)}
                </td>
                <td className="px-4 py-3 font-semibold">{payment.label}</td>
                <td className="px-4 py-3 text-muted">
                  {payment.payerName ?? '—'}
                </td>
                <td className="px-4 py-3 text-muted">
                  {projectLabel(payment.projectId)}
                </td>
                <td className="px-4 py-3 text-muted">
                  {PAYMENT_METHOD_LABELS[payment.method]}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-faint">
                  {payment.transferReference ?? '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-emerald">
                  {fmtMad(payment.amountMad)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.total === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun encaissement enregistré — ajoutez-en ci-dessous.
          </p>
        )}
        <Pager
          page={paymentsPage}
          pageSize={PAGE_SIZE}
          total={payments.total}
          hrefForPage={paymentsHref}
        />
        <form
          action={createPayment}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Libellé</span>
            <input
              type="text"
              name="label"
              required
              minLength={3}
              maxLength={300}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Payeur</span>
            <input
              type="text"
              name="payerName"
              maxLength={200}
              className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
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
            <span className="mb-1 block text-xs text-muted">Méthode</span>
            <select
              name="method"
              required
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Réf. virement</span>
            <input
              type="text"
              name="transferReference"
              maxLength={200}
              className="w-36 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Banque</span>
            <input
              type="text"
              name="bankName"
              maxLength={200}
              className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Date</span>
            <input
              type="date"
              name="paidAt"
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
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Enregistrer
          </button>
        </form>
      </section>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Dépenses par catégorie
          </h2>
          <span className="font-mono text-sm font-bold tabular-nums">
            {fmtMad(expenseSummary.totalMad)}
          </span>
        </div>
        {expenseSummary.byCategory.length === 0 ? (
          <p className="p-8 text-center text-sm text-faint">
            Aucune dépense enregistrée.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {expenseSummary.byCategory.map((row) => (
              <li
                key={row.category}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${EXPENSE_CATEGORY_BADGES[row.category].classes}`}
                  >
                    {EXPENSE_CATEGORY_BADGES[row.category].label}
                  </span>
                  <span className="text-xs text-faint">
                    {row.count} ligne(s)
                  </span>
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {fmtMad(row.totalMad)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
          <h2 className="mr-2 text-xs font-semibold uppercase tracking-widest text-faint">
            Dépenses ({expenses.total})
          </h2>
          <Link
            href="/finance"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
              activeCategory
                ? 'bg-sand text-muted hover:text-ink'
                : 'bg-cyan-deep text-paper'
            }`}
          >
            Toutes
          </Link>
          {EXPENSE_CATEGORY_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={`/finance?category=${option.value}`}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                activeCategory === option.value
                  ? 'bg-cyan-deep text-paper'
                  : 'bg-sand text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Catégorie</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3">Fournisseur</th>
              <th className="px-4 py-3">Chantier</th>
              <th className="px-4 py-3">Réf.</th>
              <th className="px-4 py-3 text-right">Montant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {expenses.items.map((expense) => (
              <tr key={expense.id}>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                  {fmtDate(expense.spentAt)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${EXPENSE_CATEGORY_BADGES[expense.category].classes}`}
                  >
                    {EXPENSE_CATEGORY_BADGES[expense.category].label}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold">{expense.label}</td>
                <td className="px-4 py-3 text-muted">
                  {supplierLabel(expense.supplierId)}
                </td>
                <td className="px-4 py-3 text-muted">
                  {projectLabel(expense.projectId)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-faint">
                  {expense.reference ?? '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-clay">
                  {fmtMad(expense.amountMad)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {expenses.total === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            {activeCategory
              ? 'Aucune dépense dans cette catégorie.'
              : 'Aucune dépense enregistrée — ajoutez-en ci-dessous.'}
          </p>
        )}
        <Pager
          page={expensesPage}
          pageSize={PAGE_SIZE}
          total={expenses.total}
          hrefForPage={expensesHref}
        />
        <form
          action={createExpense}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Catégorie</span>
            <select
              name="category"
              required
              defaultValue={activeCategory ?? ''}
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              <option value="" disabled>
                —
              </option>
              {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Libellé</span>
            <input
              type="text"
              name="label"
              required
              minLength={3}
              maxLength={300}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
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
            <span className="mb-1 block text-xs text-muted">Méthode</span>
            <input
              type="text"
              name="method"
              maxLength={50}
              className="w-28 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Référence</span>
            <input
              type="text"
              name="reference"
              maxLength={200}
              className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Fournisseur (optionnel)
            </span>
            <select
              name="supplierId"
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              <option value="">—</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Date</span>
            <input
              type="date"
              name="spentAt"
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
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Enregistrer
          </button>
        </form>
      </section>
    </div>
  );
}
