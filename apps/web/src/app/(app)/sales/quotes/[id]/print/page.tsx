import { apiGet } from '@/lib/api';
import { PrintSheet } from '@/components/sales/PrintSheet';
import {
  fmtDate,
  fmtMad,
  fmtQtyUnit,
  parsePrintFormat,
  tvaMad,
  type ClientRecord,
  type QuoteRecord,
} from '@/lib/sales';

const COMPANY = {
  name: 'AGHA RM INFRA',
  tagline: 'Travaux & Infrastructure',
};

export default async function QuotePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { id } = await params;
  const { format: formatParam } = await searchParams;
  const format = parsePrintFormat(formatParam);
  const quote = await apiGet<QuoteRecord>(`/sales/quotes/${id}`);
  const client = await apiGet<ClientRecord>(`/sales/clients/${quote.clientId}`);
  const detailed = format === 'detaille';
  const toggleFormat = detailed ? 'simple' : 'detaille';

  return (
    <PrintSheet
      backHref={`/sales/quotes/${quote.id}`}
      backLabel="Retour au devis"
      toggleHref={`/sales/quotes/${quote.id}/print?format=${toggleFormat}`}
      toggleLabel={detailed ? 'Format simple' : 'Format détaillé'}
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-lg font-black tracking-tight">{COMPANY.name}</p>
          <p className="text-sm text-[#555]">{COMPANY.tagline}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-black tracking-tight">DEVIS</p>
          <p className="font-mono text-sm">{quote.reference}</p>
          <p className="text-sm text-[#555]">Date : {fmtDate(quote.quoteDate)}</p>
          {detailed && quote.validUntil && (
            <p className="text-sm text-[#555]">
              Valide jusqu’au : {fmtDate(quote.validUntil)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-md border border-[#e5e5e5] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#777]">
          Client
        </p>
        <p className="mt-1 font-semibold">{client.name}</p>
        {detailed && client.ice && (
          <p className="text-sm text-[#555]">ICE : {client.ice}</p>
        )}
        {client.address && <p className="text-sm text-[#555]">{client.address}</p>}
        {client.city && <p className="text-sm text-[#555]">{client.city}</p>}
        {detailed && client.phone && (
          <p className="text-sm text-[#555]">Tél : {client.phone}</p>
        )}
        {quote.objet && (
          <p className="mt-2 text-sm">
            <span className="text-[#777]">Objet : </span>
            {quote.objet}
          </p>
        )}
      </div>

      {detailed ? (
        <table className="mt-6 text-sm">
          <thead>
            <tr>
              <th style={{ width: '7%' }}>N°</th>
              <th>Désignation</th>
              <th style={{ width: '16%', textAlign: 'right' }}>Quantité</th>
              <th style={{ width: '18%', textAlign: 'right' }}>P.U. HT</th>
              <th style={{ width: '18%', textAlign: 'right' }}>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line, index) => (
              <tr key={line.id}>
                <td className="font-mono">{index + 1}</td>
                <td>{line.designation}</td>
                <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                  {fmtQtyUnit(line.quantity, line.unit)}
                </td>
                <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                  {fmtMad(line.unitPriceMad)}
                </td>
                <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                  {fmtMad(line.lineTotalMad)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="mt-6 text-sm">
          <thead>
            <tr>
              <th>Désignation</th>
              <th style={{ width: '28%', textAlign: 'right' }}>Total HT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {quote.objet ?? `Prestations selon devis ${quote.reference}`}
                <span className="text-[#777]">
                  {' '}
                  ({quote.lines.length} ligne
                  {quote.lines.length > 1 ? 's' : ''})
                </span>
              </td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtMad(quote.totalHtMad)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="mt-5 flex justify-end">
        <table className="text-sm" style={{ width: '60%' }}>
          <tbody>
            <tr>
              <td className="text-[#555]">Total HT</td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtMad(quote.totalHtMad)}
              </td>
            </tr>
            <tr>
              <td className="text-[#555]">TVA ({quote.tvaPct}%)</td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtMad(tvaMad(quote))}
              </td>
            </tr>
            <tr>
              <td className="font-bold">Total TTC</td>
              <td
                style={{ textAlign: 'right' }}
                className="font-mono font-bold tabular-nums"
              >
                {fmtMad(quote.totalTtcMad)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {detailed && quote.notes && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#777]">
            Notes
          </p>
          <p className="mt-1 text-sm">{quote.notes}</p>
        </div>
      )}

      <div className="mt-12 flex justify-end gap-8 text-sm">
        <div style={{ width: '45%' }}>
          <p className="text-[#777]">Bon pour accord (client)</p>
          <div className="mt-12 border-t border-[#999] pt-1 text-xs text-[#777]">
            Date, nom, signature &amp; cachet
          </div>
        </div>
      </div>
    </PrintSheet>
  );
}
