import { apiGet } from '@/lib/api';
import { PrintSheet } from '@/components/sales/PrintSheet';
import {
  fmtDate,
  fmtQtyUnit,
  parsePrintFormat,
  type ClientRecord,
  type DeliveryNoteRecord,
} from '@/lib/sales';

const COMPANY = {
  name: 'AGHA RM INFRA',
  tagline: 'Travaux & Infrastructure',
};

export default async function DeliveryNotePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { id } = await params;
  const { format: formatParam } = await searchParams;
  const format = parsePrintFormat(formatParam);
  const note = await apiGet<DeliveryNoteRecord>(`/sales/delivery-notes/${id}`);
  const client = await apiGet<ClientRecord>(`/sales/clients/${note.clientId}`);
  const detailed = format === 'detaille';
  const toggleFormat = detailed ? 'simple' : 'detaille';

  return (
    <PrintSheet
      backHref={`/sales/delivery-notes/${note.id}`}
      backLabel="Retour au bon"
      toggleHref={`/sales/delivery-notes/${note.id}/print?format=${toggleFormat}`}
      toggleLabel={detailed ? 'Format simple' : 'Format détaillé'}
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-lg font-black tracking-tight">{COMPANY.name}</p>
          <p className="text-sm text-[#555]">{COMPANY.tagline}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-black tracking-tight">BON DE LIVRAISON</p>
          <p className="font-mono text-sm">{note.reference}</p>
          <p className="text-sm text-[#555]">
            Date : {fmtDate(note.deliveryDate)}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-md border border-[#e5e5e5] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#777]">
          Livré à
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
      </div>

      <table className="mt-6 text-sm">
        <thead>
          <tr>
            <th style={{ width: '8%' }}>N°</th>
            <th>Désignation</th>
            <th style={{ width: '22%', textAlign: 'right' }}>Quantité</th>
          </tr>
        </thead>
        <tbody>
          {note.lines.map((line, index) => (
            <tr key={line.id}>
              <td className="font-mono">{index + 1}</td>
              <td>{line.designation}</td>
              <td style={{ textAlign: 'right' }} className="font-mono tabular-nums">
                {fmtQtyUnit(line.quantity, line.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detailed && note.notes && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#777]">
            Notes
          </p>
          <p className="mt-1 text-sm">{note.notes}</p>
        </div>
      )}

      <div className="mt-12 flex justify-between gap-8 text-sm">
        <div className="flex-1">
          <p className="text-[#777]">Le livreur</p>
          <div className="mt-12 border-t border-[#999] pt-1 text-xs text-[#777]">
            Nom &amp; signature
          </div>
        </div>
        <div className="flex-1">
          <p className="text-[#777]">Le client (réception)</p>
          <div className="mt-12 border-t border-[#999] pt-1 text-xs text-[#777]">
            Nom, signature &amp; cachet
          </div>
        </div>
      </div>
    </PrintSheet>
  );
}
