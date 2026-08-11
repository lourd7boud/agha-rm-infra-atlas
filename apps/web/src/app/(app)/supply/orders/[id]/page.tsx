import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, AtlasApiError } from '@/lib/api';
import type { ProjectSummary } from '@/lib/projects';
import {
  fmtDate,
  fmtMad,
  fmtQtyUnit,
  ORDER_STATUS_BADGES,
  type PurchaseOrderRecord,
  type SupplierRecord,
} from '@/lib/supply';

/**
 * Bon de commande détaillé — read-only mirror of GET /supply/orders/:id. The
 * detail endpoint returns the order with its full `lines`; a missing id answers
 * HTTP 404, which apiGet surfaces as an AtlasApiError we translate into Next's
 * notFound() so the segment renders the standard not-found UI instead of a 500.
 */
async function getOrderOrNotFound(id: string): Promise<PurchaseOrderRecord> {
  try {
    return await apiGet<PurchaseOrderRecord>(`/supply/orders/${id}`);
  } catch (error) {
    if (error instanceof AtlasApiError && error.status === 404) {
      notFound();
    }
    // Auth redirects (NEXT_REDIRECT) and other failures propagate to the
    // framework's redirect handling / error boundary untouched.
    throw error;
  }
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderOrNotFound(id);

  // Resolve the supplier name and the optional chantier reference from the list
  // endpoints (there is no /supply/suppliers/:id) — same source the /supply
  // index uses. Both lookups run in parallel and degrade to a dash on failure.
  const [suppliers, projects] = await Promise.all([
    apiGet<SupplierRecord[]>('/supply/suppliers').catch(
      () => [] as SupplierRecord[],
    ),
    apiGet<ProjectSummary[]>('/project/projects').catch(
      () => [] as ProjectSummary[],
    ),
  ]);

  const supplierName =
    suppliers.find((s) => s.id === order.supplierId)?.name ?? '—';
  const projectRef = order.projectId
    ? (projects.find((p) => p.id === order.projectId)?.reference ??
      order.projectId)
    : undefined;

  const badge = ORDER_STATUS_BADGES[order.status];
  const linesTotalMad = order.lines.reduce(
    (sum, line) => sum + line.lineTotalMad,
    0,
  );

  const headerFacts: { label: string; value: string }[] = [
    { label: 'Fournisseur', value: supplierName },
    { label: 'Chantier', value: projectRef ?? '—' },
    { label: 'Date de commande', value: fmtDate(order.orderedAt) },
    { label: 'Créé le', value: fmtDate(order.createdAt) },
  ];

  return (
    <div>
      <Link href="/supply" className="text-sm text-muted hover:text-ink">
        ← Approvisionnements
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">{order.reference}</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        {supplierName}
        {order.objet ? ` — ${order.objet}` : ''} · commandé le{' '}
        {fmtDate(order.orderedAt)}
      </p>

      {/* ── Order header ── */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {headerFacts.map((fact) => (
          <div
            key={fact.label}
            className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              {fact.label}
            </p>
            <p className="mt-2 text-sm font-semibold text-ink-2">{fact.value}</p>
          </div>
        ))}
      </section>

      {order.objet && (
        <section className="mb-6 rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-faint">
            Objet
          </h2>
          <p className="text-sm text-ink-2">{order.objet}</p>
        </section>
      )}

      {/* ── Line items ── */}
      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Lignes ({order.lineCount})
          </h2>
          <span className="font-mono text-sm font-bold tabular-nums">
            {fmtMad(order.amountMad)}
          </span>
        </div>
        {order.lines.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="w-10 px-4 py-3">#</th>
                <th className="px-4 py-3">Désignation</th>
                <th className="px-4 py-3 text-right">Quantité</th>
                <th className="px-4 py-3 text-right">Unité</th>
                <th className="px-4 py-3 text-right">P.U.</th>
                <th className="px-4 py-3 text-right">Total ligne</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.lines.map((line, index) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 font-mono text-xs text-faint">
                    {index + 1}
                  </td>
                  <td className="px-4 py-3 font-semibold">{line.designation}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtQtyUnit(line.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {line.unit ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                    {fmtMad(line.unitPriceMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(line.lineTotalMad)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line bg-sand/40">
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-3 text-right text-sm font-semibold"
                >
                  Total
                </td>
                <td className="px-4 py-3 text-right font-mono text-base font-bold tabular-nums">
                  {fmtMad(linesTotalMad)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="p-8 text-center">
            <p className="text-sm text-faint">
              Ce bon de commande ne détaille pas de lignes — montant global
              saisi.
            </p>
            <p className="mt-3 font-mono text-lg font-bold tabular-nums">
              {fmtMad(order.amountMad)}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
