// Attachement — certification des quantités (sans prix), version imprimable.
// L'en-tête est paramétré depuis la fiche (MOE / société) au lieu du papier
// à en-tête codé en dur du système source.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtDate, fmtQty, type AttachementData, type BtpProjectDetail } from '@/lib/btp';

export default async function AttachementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const periodeQuery = query.periodeId ? `?periodeId=${query.periodeId}` : '';
  const [project, attachement] = await Promise.all([
    apiGet<BtpProjectDetail>(`/btp/projects/${id}`),
    apiGet<AttachementData>(`/btp/projects/${id}/attachement${periodeQuery}`),
  ]);
  const numero = attachement.periode?.numero ?? 0;
  const title = `ATTACHEMENT ${attachement.isDernier ? `N°${numero} ET DERNIER` : `PROVISOIRE N°${numero}`}`;

  return (
    <div className="px-6 py-8 lg:px-10 print:bg-white print:px-0 print:py-0 print:text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={
            attachement.periode
              ? `/projects/${id}/metres/${attachement.periode.id}`
              : `/projects/${id}?tab=metres`
          }
          className="text-xs font-semibold text-muted hover:text-cyan"
        >
          ← Retour au métré
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/btp-export/${id}/attachement${periodeQuery}`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-emerald hover:text-emerald"
          >
            ⬇ Excel
          </a>
          <span className="rounded-lg bg-cyan-soft px-3 py-2 text-xs font-bold text-cyan">
            Ctrl+P pour imprimer
          </span>
        </div>
      </div>

      {/* Document */}
      <div className="mx-auto max-w-4xl rounded-xl border border-line bg-paper-2 p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none">
        <header className="border-b-2 border-ink pb-4 text-center print:border-black">
          <p className="text-xs font-semibold uppercase tracking-widest">
            {project.maitreOeuvre ?? project.buyerName}
          </p>
          {project.assistanceTechnique && (
            <p className="mt-0.5 text-[11px] text-muted print:text-black">
              Assistance technique : {project.assistanceTechnique}
            </p>
          )}
          <h1 className="mt-4 text-xl font-black tracking-wide">{title}</h1>
          <p className="mt-2 text-sm">
            Marché n° <span className="font-mono font-bold">{project.reference}</span>
            {project.annee ? ` — Année ${project.annee}` : ''}
          </p>
          <p className="mx-auto mt-1 max-w-2xl text-xs leading-relaxed text-muted print:text-black">
            {project.objet ?? project.name}
          </p>
          {attachement.periode && (
            <p className="mt-2 font-mono text-xs">
              Période : {fmtDate(attachement.periode.dateDebut)} →{' '}
              {fmtDate(attachement.periode.dateFin)}
            </p>
          )}
        </header>

        <table className="mt-6 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b-2 border-ink text-[10px] uppercase tracking-wider print:border-black">
              <th className="px-2 py-2">N° Prix</th>
              <th className="px-2 py-2">Désignation des ouvrages</th>
              <th className="px-2 py-2 text-center">U</th>
              <th className="px-2 py-2 text-right">Qté marché</th>
              <th className="px-2 py-2 text-right">Qté précédente</th>
              <th className="px-2 py-2 text-right">Qté période</th>
              <th className="px-2 py-2 text-right">Qté cumulée</th>
            </tr>
          </thead>
          <tbody>
            {attachement.lignes.map((ligne) => (
              <tr
                key={ligne.prixNo}
                className="border-b border-line align-top print:border-gray-400"
              >
                <td className="px-2 py-1.5 font-mono font-bold">{ligne.prixNo}</td>
                <td className="px-2 py-1.5">{ligne.designation}</td>
                <td className="px-2 py-1.5 text-center font-mono">{ligne.unite}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {fmtQty(ligne.quantiteBordereau)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {fmtQty(ligne.quantitePrecedente)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">
                  {fmtQty(ligne.quantitePeriode)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">
                  {fmtQty(ligne.quantiteCumulee)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-xs">
          <div>
            <p className="font-semibold uppercase tracking-widest">L'Entrepreneur</p>
            <p className="mt-0.5 text-[10px] text-muted print:text-black">
              {project.societe ?? ''}
            </p>
            <div className="mt-14 border-t border-line print:border-black" />
          </div>
          <div>
            <p className="font-semibold uppercase tracking-widest">Le Maître d'œuvre</p>
            <p className="mt-0.5 text-[10px] text-muted print:text-black">
              {project.maitreOeuvre ?? ''}
            </p>
            <div className="mt-14 border-t border-line print:border-black" />
          </div>
          <div>
            <p className="font-semibold uppercase tracking-widest">L'Administration</p>
            <p className="mt-0.5 text-[10px] text-muted print:text-black">{project.buyerName}</p>
            <div className="mt-14 border-t border-line print:border-black" />
          </div>
        </footer>
      </div>
    </div>
  );
}
