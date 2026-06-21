import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  CLIENT_STATUS_BADGES,
  fmtDate,
  fmtMad,
  INVOICE_STATUS_BADGES,
  QUOTE_STATUS_BADGES,
  type ClientRecord,
  type InvoiceRecord,
  type QuoteRecord,
} from '@/lib/sales';

/** One labelled coordinate row in the client identity card. */
function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-widest text-faint">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink-2">{value && value.length > 0 ? value : '—'}</dd>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, quotes, invoices] = await Promise.all([
    apiGet<ClientRecord>(`/sales/clients/${id}`),
    apiGet<QuoteRecord[]>(`/sales/quotes?clientId=${id}`),
    apiGet<InvoiceRecord[]>(`/sales/invoices?clientId=${id}`),
  ]);

  const badge = CLIENT_STATUS_BADGES[client.status];
  const quotesTotalMad = quotes.reduce((sum, q) => sum + q.totalTtcMad, 0);
  const invoicesTotalMad = invoices.reduce((sum, i) => sum + i.totalTtcMad, 0);
  const paidMad = invoices
    .filter((i) => i.status === 'payee')
    .reduce((sum, i) => sum + i.totalTtcMad, 0);

  return (
    <div>
      <Link href="/sales/clients" className="text-sm text-muted hover:text-ink">
        ← Clients
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">{client.name}</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>
      <p className="mb-8 text-sm text-muted">
        {client.ice ? `ICE ${client.ice} · ` : ''}Client enregistré le{' '}
        {fmtDate(client.createdAt)}
      </p>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm lg:col-span-1">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Coordonnées
          </h2>
          <dl className="grid gap-4">
            <Field label="Contact" value={client.contactName} />
            <Field label="Téléphone" value={client.phone} />
            <Field label="Email" value={client.email} />
            <Field label="Adresse" value={client.address} />
            <Field label="Ville" value={client.city} />
            {client.notes && <Field label="Notes" value={client.notes} />}
          </dl>
        </section>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-1 lg:content-start xl:grid-cols-3">
          <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Devis (TTC)
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {fmtMad(quotesTotalMad)}
            </p>
            <p className="mt-1 text-xs text-faint">{quotes.length} document(s)</p>
          </div>
          <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Facturé (TTC)
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {fmtMad(invoicesTotalMad)}
            </p>
            <p className="mt-1 text-xs text-faint">
              {invoices.length} facture(s)
            </p>
          </div>
          <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Encaissé
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums text-emerald">
              {fmtMad(paidMad)}
            </p>
            <p className="mt-1 text-xs text-faint">
              reste {fmtMad(invoicesTotalMad - paidMad)}
            </p>
          </div>
        </div>
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Devis ({quotes.length})
          </h2>
          <Link
            href={`/sales/quotes?clientId=${id}`}
            className="text-xs font-medium text-cyan hover:underline"
          >
            Tous les devis →
          </Link>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Objet</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">HT</th>
              <th className="px-4 py-3 text-right">TTC</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {quotes.map((quote) => {
              const qBadge = QUOTE_STATUS_BADGES[quote.status];
              return (
                <tr key={quote.id} className="transition hover:bg-sand/40">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    <Link
                      href={`/sales/quotes/${quote.id}`}
                      className="hover:text-cyan"
                    >
                      {quote.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{quote.objet ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(quote.quoteDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(quote.totalHtMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(quote.totalTtcMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${qBadge.classes}`}
                    >
                      {qBadge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {quotes.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun devis pour ce client.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Factures ({invoices.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Échéance</th>
              <th className="px-4 py-3 text-right">HT</th>
              <th className="px-4 py-3 text-right">TTC</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoices.map((invoice) => {
              const iBadge = INVOICE_STATUS_BADGES[invoice.status];
              return (
                <tr key={invoice.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    {invoice.reference}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(invoice.invoiceDate)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(invoice.dueDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(invoice.totalHtMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(invoice.totalTtcMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${iBadge.classes}`}
                    >
                      {iBadge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invoices.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucune facture pour ce client.
          </p>
        )}
      </section>
    </div>
  );
}
