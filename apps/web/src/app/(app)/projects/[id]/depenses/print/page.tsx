// Impression / Export PDF du journal des dépenses de chantier.
import { apiGet } from '@/lib/api';
import {
  DEPENSE_CATEGORIE_LABELS,
  DEPENSE_METHODE_LABELS,
  fmtDate,
  fmtMad,
  type BtpProjectDetail,
  type TerrainDepense,
} from '@/lib/btp';
import { PrintActionButtons } from '@/components/ui/PrintActionButtons';

const COMPANY = {
  name: 'AGHA RM INFRA',
  legal: 'SARL AU',
  ice: '003939552000065',
  rc: '20823',
  siege: 'Centre Boudnib',
};

const PRINT_STYLES = `
@page {
  size: A4 portrait;
  margin: 12mm 10mm;
}
@media print {
  body {
    background: #fff !important;
    color: #000 !important;
  }
  .no-print {
    display: none !important;
  }
  .print-page {
    box-shadow: none !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
  }
  table {
    page-break-inside: auto;
  }
  tr {
    page-break-inside: avoid;
    page-break-after: auto;
  }
  thead {
    display: table-header-group;
  }
  tfoot {
    display: table-footer-group;
  }
}
`;

export default async function DepensesPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, depenses] = await Promise.all([
    apiGet<BtpProjectDetail>(`/btp/projects/${id}`),
    apiGet<TerrainDepense[]>(`/btp/projects/${id}/terrain/depenses`),
  ]);

  const total = depenses.reduce((s, d) => s + d.amountMad, 0);

  // Totaux par méthode de paiement
  const totalsByMethod = depenses.reduce<Record<string, number>>((acc, d) => {
    const m = d.method || 'autre';
    acc[m] = (acc[m] || 0) + d.amountMad;
    return acc;
  }, {});

  const todayStr = new Date().toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-sand/30 px-4 py-8 lg:px-10 print:min-h-0 print:bg-white print:p-0 print:text-black">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Barre d'outils écran */}
      <div className="mx-auto mb-6 flex max-w-5xl items-center justify-between gap-4 print:hidden">
        <a
          href={`/projects/${id}?section=terrain&tab=depenses`}
          className="text-xs font-semibold text-muted hover:text-cyan"
        >
          ← Retour au chantier ({project.reference})
        </a>
        <PrintActionButtons
          excelHref={`/api/btp-export/${id}/depenses`}
          backHref={`/projects/${id}?section=terrain&tab=depenses`}
          backLabel="Retour aux dépenses"
        />
      </div>

      {/* Feuille imprimable */}
      <div className="print-page mx-auto max-w-5xl rounded-xl border border-line bg-paper p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none">
        {/* En-tête officiel */}
        <header className="border-b-2 border-ink pb-4 print:border-black">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-base font-black tracking-tight text-ink print:text-black">
                {COMPANY.name}
              </p>
              <p className="text-[11px] text-muted print:text-black">
                {COMPANY.legal} · ICE: {COMPANY.ice} · RC: {COMPANY.rc}
              </p>
              <p className="text-[11px] text-muted print:text-black">{COMPANY.siege}</p>
            </div>
            <div className="text-right">
              <span className="inline-block rounded border border-line px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-muted print:border-black print:text-black">
                Marché N° {project.reference}
              </span>
              <p className="mt-1 text-[11px] text-muted print:text-black">
                Date d&apos;édition : <span className="font-mono font-medium">{todayStr}</span>
              </p>
            </div>
          </div>

          <div className="mt-4 text-center">
            <h1 className="text-lg font-black uppercase tracking-wide text-ink print:text-black">
              État récapitulatif des dépenses de chantier
            </h1>
            <p className="text-xs font-semibold text-muted print:text-black">
              بيان مصاريف ونفقات الورش
            </p>
            <p className="mx-auto mt-2 max-w-3xl text-xs leading-relaxed text-muted print:text-black">
              <span className="font-semibold text-ink print:text-black">Objet du marché : </span>
              {project.objet ?? project.name}
            </p>
            {project.buyerName && (
              <p className="mt-0.5 text-xs text-muted print:text-black">
                <span className="font-semibold text-ink print:text-black">Maître d&apos;ouvrage : </span>
                {project.buyerName}
              </p>
            )}
          </div>
        </header>

        {/* Synthèse rapide */}
        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4 print:gap-2">
          <div className="rounded-lg border border-line bg-paper-2 p-3 print:border-neutral-400 print:bg-white print:p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint print:text-black">
              Nombre de dépenses
            </p>
            <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-ink print:text-black">
              {depenses.length}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-paper-2 p-3 print:border-neutral-400 print:bg-white print:p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint print:text-black">
              Total général (MAD)
            </p>
            <p className="mt-0.5 font-mono text-base font-black tabular-nums text-cyan print:text-black">
              {fmtMad(total)}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-paper-2 p-3 print:border-neutral-400 print:bg-white print:p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint print:text-black">
              Total Espèces
            </p>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-ink print:text-black">
              {fmtMad(totalsByMethod['especes'] || 0)}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-paper-2 p-3 print:border-neutral-400 print:bg-white print:p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint print:text-black">
              Autres règlements
            </p>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-ink print:text-black">
              {fmtMad(total - (totalsByMethod['especes'] || 0))}
            </p>
          </div>
        </section>

        {/* Tableau des dépenses */}
        <section className="mt-6">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b-2 border-ink bg-sand/60 text-[10px] uppercase tracking-wider print:border-black print:bg-neutral-100">
                <th className="border border-neutral-300 px-2.5 py-2 text-center font-bold text-ink print:border-black print:text-black" style={{ width: '4%' }}>
                  N°
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 font-bold text-ink print:border-black print:text-black" style={{ width: '11%' }}>
                  Date
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 font-bold text-ink print:border-black print:text-black" style={{ width: '16%' }}>
                  Catégorie
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 font-bold text-ink print:border-black print:text-black">
                  Libellé / Désignation
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 font-bold text-ink print:border-black print:text-black" style={{ width: '11%' }}>
                  Paiement
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 font-bold text-ink print:border-black print:text-black" style={{ width: '12%' }}>
                  Réf. / Reçu
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 text-right font-bold text-ink print:border-black print:text-black" style={{ width: '14%' }}>
                  Montant (DH)
                </th>
                <th className="border border-neutral-300 px-2.5 py-2 font-bold text-ink print:border-black print:text-black" style={{ width: '10%' }}>
                  Saisi par
                </th>
              </tr>
            </thead>
            <tbody>
              {depenses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border border-neutral-300 px-4 py-6 text-center text-muted print:border-black">
                    Aucune dépense enregistrée sur ce chantier.
                  </td>
                </tr>
              ) : (
                depenses.map((d, index) => (
                  <tr
                    key={d.id}
                    className="border-b border-line align-top transition hover:bg-sand/30 print:border-neutral-300"
                  >
                    <td className="border border-neutral-300 px-2.5 py-2 text-center font-mono text-[11px] text-muted print:border-neutral-300 print:text-black">
                      {index + 1}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 font-mono text-[11px] print:border-neutral-300">
                      {fmtDate(d.spentAt)}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 font-medium print:border-neutral-300">
                      {DEPENSE_CATEGORIE_LABELS[d.category] ?? d.category}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 print:border-neutral-300">
                      <p className="font-semibold text-ink print:text-black">{d.label}</p>
                      {d.notes && (
                        <p className="mt-0.5 text-[11px] text-muted print:text-neutral-700">
                          Note : {d.notes}
                        </p>
                      )}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 text-muted print:border-neutral-300 print:text-black">
                      {d.method ? (DEPENSE_METHODE_LABELS[d.method] ?? d.method) : '—'}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 font-mono text-[11px] text-muted print:border-neutral-300 print:text-black">
                      {d.reference ?? '—'}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 text-right font-mono font-bold tabular-nums text-ink print:border-neutral-300 print:text-black">
                      {fmtMad(d.amountMad)}
                    </td>
                    <td className="border border-neutral-300 px-2.5 py-2 font-mono text-[11px] text-muted print:border-neutral-300 print:text-black">
                      {d.saisiPar ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink bg-sand/40 font-bold print:border-black print:bg-neutral-100">
                <td colSpan={6} className="border border-neutral-300 px-3 py-2.5 text-right uppercase tracking-wider text-ink print:border-black print:text-black">
                  Total Général des Dépenses (MAD) :
                </td>
                <td className="border border-neutral-300 px-3 py-2.5 text-right font-mono text-sm font-black tabular-nums text-ink print:border-black print:text-black">
                  {fmtMad(total)}
                </td>
                <td className="border border-neutral-300 px-3 py-2.5 print:border-black" />
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Visas et signatures */}
        <footer className="mt-12 grid grid-cols-2 gap-8 text-center text-xs print:mt-10">
          <div className="rounded-lg border border-line p-4 print:border-black">
            <p className="font-bold uppercase tracking-widest text-ink print:text-black">
              Le Chef de Chantier
            </p>
            <p className="mt-0.5 text-[10px] text-muted print:text-black">
              Date, Visa & Signature
            </p>
            <div className="mt-16 border-t border-dashed border-neutral-400 print:border-black" />
          </div>

          <div className="rounded-lg border border-line p-4 print:border-black">
            <p className="font-bold uppercase tracking-widest text-ink print:text-black">
              Direction des Travaux / Gérance
            </p>
            <p className="mt-0.5 text-[10px] text-muted print:text-black">
              Date, Visa & Cachet
            </p>
            <div className="mt-16 border-t border-dashed border-neutral-400 print:border-black" />
          </div>
        </footer>
      </div>
    </div>
  );
}
