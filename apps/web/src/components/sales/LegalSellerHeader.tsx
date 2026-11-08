import type { LegalSellerSnapshot } from '@/lib/sales';

export function LegalSellerHeader({ seller }: { seller?: LegalSellerSnapshot }) {
  return (
    <div className="text-sm text-[#555]">
      <p className="text-lg font-black tracking-tight text-[#111]">
        {seller?.legalName || 'Vendeur non configuré'}
      </p>
      <p>{seller?.address}</p>
      <p>ICE : {seller?.ice || '—'} · IF : {seller?.taxId || '—'}</p>
      <p>RC : {seller?.tradeRegister || '—'}</p>
      {seller?.professionalTaxId && <p>TP : {seller.professionalTaxId}</p>}
    </div>
  );
}

export function LegalDocumentNotice({
  watermark,
  compatibilityFallback,
}: {
  watermark?: string;
  compatibilityFallback: boolean;
}) {
  return (
    <>
      {watermark && <p className="mb-5 border-2 border-[#999] p-3 text-center text-xl font-black">{watermark}</p>}
      {compatibilityFallback && (
        <p className="mb-4 text-xs text-[#777]">
          Ancien document : certaines coordonnées proviennent des fiches actuelles.
        </p>
      )}
    </>
  );
}
