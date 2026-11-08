import { apiGet } from '@/lib/api';
import { PrintSheet } from '@/components/sales/PrintSheet';
import { LegalDocumentNotice, LegalSellerHeader } from '@/components/sales/LegalSellerHeader';
import { buildInvoiceLegalDocument, sellerFromProfile } from '@/lib/legal-document';
import type { ComptaProfil } from '@/lib/compta';
import {
  fmtDate,
  fmtMad,
  fmtQtyUnit,
  parsePrintFormat,
  tvaMad,
  type ClientRecord,
  type InvoiceRecord,
} from '@/lib/sales';

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { id } = await params;
  const { format: formatParam } = await searchParams;
  const format = parsePrintFormat(formatParam);
  const invoice = await apiGet<InvoiceRecord>(`/sales/invoices/${id}`);
  const liveClient = await apiGet<ClientRecord>(`/sales/clients/${invoice.clientId}`);
  const fallbackSeller = invoice.legalSnapshot?.legalName ? undefined
    : sellerFromProfile(await apiGet<ComptaProfil>('/compta/profil'));
  const document = buildInvoiceLegalDocument(invoice, liveClient, fallbackSeller);
  const client = document.client;
  const detailed = format === 'detaille';
  const toggleFormat = detailed ? 'simple' : 'detaille';

  return (
    <PrintSheet
      backHref={`/sales/invoices/${invoice.id}`}
      backLabel="Retour à la facture"
      toggleHref={`/sales/invoices/${invoice.id}/print?format=${toggleFormat}`}
      toggleLabel={detailed ? 'Format simple' : 'Format détaillé'}
    >
      <LegalDocumentNotice watermark={document.watermark} compatibilityFallback={document.compatibilityFallback} />
      <div className="flex items-start justify-between gap-6">
        <LegalSellerHeader seller={document.seller} />
        <div className="text-right">
          <p className="text-xl font-black tracking-tight">FACTURE</p>
          <p className="font-mono text-sm">{invoice.reference}</p>
          <p className="text-sm text-[#555]">
            Date : {fmtDate(invoice.invoiceDate)}
          </p>
          {invoice.dueDate && (
            <p className="text-sm text-[#555]">
              Échéance : {fmtDate(invoice.dueDate)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-md border border-[#e5e5e5] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#777]">
          Facturé à
        </p>
        <p className="mt-1 font-semibold">{client.name}</p>
        {client.ice && (
          <p className="text-sm text-[#555]">ICE : {client.ice}</p>
        )}
        {client.address && <p className="text-sm text-[#555]">{client.address}</p>}
        {client.city && <p className="text-sm text-[#555]">{client.city}</p>}
      </div>

      <table className="mt-6 text-sm">
        <thead>
          <tr>
            <th style={{ width: '6%' }}>N°</th>
            <th>Désignation</th>
            <th style={{ width: '14%', textAlign: 'right' }}>Quantité</th>
            {(
              <th style={{ width: '16%', textAlign: 'right' }}>P.U. HT</th>
            )}
            <th style={{ width: '18%', textAlign: 'right' }}>Total HT</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, index) => (
            <tr key={line.id}>
              <td className="font-mono">{index + 1}</td>
              <td>{line.designation}</td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtQtyUnit(line.quantity, line.unit)}
              </td>
              {(
                <td
                  style={{ textAlign: 'right' }}
                  className="font-mono tabular-nums"
                >
                  {fmtMad(line.unitPriceMad)}
                </td>
              )}
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtMad(line.lineTotalMad)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 flex justify-end">
        <table className="text-sm" style={{ width: '55%' }}>
          <tbody>
            <tr>
              <td className="text-[#555]">Total HT</td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtMad(invoice.totalHtMad)}
              </td>
            </tr>
            <tr>
              <td className="text-[#555]">TVA ({invoice.tvaPct}%)</td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtMad(tvaMad(invoice))}
              </td>
            </tr>
            <tr>
              <td className="font-semibold">Total TTC</td>
              <td
                style={{ textAlign: 'right' }}
                className="font-mono font-bold tabular-nums"
              >
                {fmtMad(invoice.totalTtcMad)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {detailed && invoice.notes && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#777]">
            Notes
          </p>
          <p className="mt-1 text-sm">{invoice.notes}</p>
        </div>
      )}

      <p className="mt-10 text-xs text-[#777]">
        Arrêtée la présente facture à la somme de {fmtMad(invoice.totalTtcMad)} TTC.
      </p>
      <p className="mt-3 text-sm">Conditions de paiement : {document.paymentTerms} · Devise : MAD</p>

      <div className="mt-10 flex justify-end text-sm">
        <div style={{ width: '45%' }}>
          <p className="text-[#777]">Cachet &amp; signature</p>
          <div className="mt-16 border-t border-[#999] pt-1 text-xs text-[#777]">
            {document.seller?.legalName}
          </div>
        </div>
      </div>
    </PrintSheet>
  );
}
