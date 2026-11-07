import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  fmtDate,
  fmtMad,
  fmtQtyUnit,
  INVOICE_STATUS_BADGES,
  parseInvoiceAggregate,
  type ClientRecord,
} from '@/lib/sales';
import { InvoiceWorkflow } from './InvoiceWorkflow';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const aggregate = parseInvoiceAggregate(
    await apiGet<unknown>(`/sales/invoices/${id}/aggregate`),
  );
  const { invoice } = aggregate;
  const client = await apiGet<ClientRecord>(`/sales/clients/${invoice.clientId}`);
  const badge = INVOICE_STATUS_BADGES[invoice.status];

  return (
    <div>
      <Link href="/sales/invoices" className="text-sm text-muted hover:text-ink">
        ← Factures
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">
          {invoice.reference ?? 'Brouillon de facture'}
        </h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
          {badge.label}
        </span>
        <Link
          href={`/sales/invoices/${invoice.id}/print`}
          className="ml-auto rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan"
        >
          Imprimer / PDF
        </Link>
      </div>
      <p className="mb-8 text-sm text-muted">
        {client.name} — datée du {fmtDate(invoice.invoiceDate)}
        {invoice.dueDate ? ` · échéance ${fmtDate(invoice.dueDate)}` : ''}
      </p>

      <InvoiceWorkflow
        aggregate={aggregate}
        client={client}
        idempotencySeed={randomUUID()}
      />

      <section className="mt-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Lignes ({invoice.lines.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Désignation</th>
              <th className="px-4 py-3 text-right">Quantité</th>
              <th className="px-4 py-3 text-right">P.U.</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3 font-semibold">{line.designation}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmtQtyUnit(line.quantity, line.unit)}
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
          <tfoot className="border-t border-line text-sm">
            <tr>
              <td className="px-4 py-2.5 text-right text-muted" colSpan={3}>Total HT</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtMad(invoice.totalHtMad)}</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-right text-muted" colSpan={3}>TVA ({invoice.tvaPct}%)</td>
              <td className="px-4 py-2.5 text-right font-mono">{fmtMad(invoice.tvaMad)}</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-right font-semibold" colSpan={3}>Total TTC</td>
              <td className="px-4 py-2.5 text-right font-mono font-bold text-cyan">{fmtMad(invoice.totalTtcMad)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
