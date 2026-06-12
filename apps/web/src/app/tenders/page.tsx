import Link from 'next/link';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { apiGet } from '@/lib/api';
import { PIPELINE_LABELS, urgencyClasses } from '@/lib/labels';

interface WallTender {
  id: string;
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  objet: string;
  estimationMad?: number;
  deadlineAt: string;
  pipelineState: PipelineState;
  daysLeft: number;
}

export default async function TendersPage() {
  const tenders = await apiGet<WallTender[]>('/tender/tenders');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Mur des échéances</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tenders.length} appel{tenders.length > 1 ? 's' : ''} d&apos;offres
          suivi{tenders.length > 1 ? 's' : ''} — triés par urgence (Sentinel +
          saisie manuelle)
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Échéance</th>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Objet</th>
              <th className="px-4 py-3">Acheteur</th>
              <th className="px-4 py-3 text-right">Estimation</th>
              <th className="px-4 py-3">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenders.map((tender) => {
              const state = PIPELINE_LABELS[tender.pipelineState];
              return (
                <tr key={tender.id} className="transition hover:bg-amber-50/50">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${urgencyClasses(tender.daysLeft)}`}
                    >
                      J-{tender.daysLeft}
                    </span>
                    <div className="mt-1 text-xs text-slate-400">
                      {new Date(tender.deadlineAt).toLocaleDateString('fr-MA')}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      href={`/tenders/${tender.id}`}
                      className="underline-offset-2 hover:text-amber-700 hover:underline"
                    >
                      {tender.reference}
                    </Link>
                  </td>
                  <td className="max-w-md px-4 py-3 text-slate-600">
                    {tender.objet}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{tender.buyerName}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {tender.estimationMad
                      ? `${tender.estimationMad.toLocaleString('fr-MA')} MAD`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${state.classes}`}
                    >
                      {state.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {tenders.length === 0 && (
          <p className="p-10 text-center text-slate-400">
            Aucun appel d&apos;offres détecté pour le moment.
          </p>
        )}
      </div>
    </div>
  );
}
