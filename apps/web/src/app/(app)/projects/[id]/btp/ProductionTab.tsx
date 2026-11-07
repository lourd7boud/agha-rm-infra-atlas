import Link from 'next/link';
import type { TerrainJourneeRecord } from '@atlas/contracts';
import { apiGet } from '@/lib/api';
import type { Bordereau, BtpProjectDetail } from '@/lib/btp';
import { summarizeTerrainProduction } from '@/lib/terrain-production';

const quantity = (value: number) => value.toLocaleString('fr-MA', { maximumFractionDigits: 3 });

export async function ProductionTab({ project }: { project: BtpProjectDetail }) {
  const [bpu, days] = await Promise.all([
    apiGet<Bordereau>(`/btp/projects/${project.id}/bordereau`),
    apiGet<TerrainJourneeRecord[]>(`/btp/projects/${project.id}/terrain/journees`),
  ]);
  const production = summarizeTerrainProduction(bpu?.lignes ?? [], days);
  return <div className="space-y-5">
    <header className="rounded-xl border border-line bg-paper-2 p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-cyan">Production déclarée</p>
      <h2 className="mt-2 text-2xl font-bold">Les quantités, ouvrage par ouvrage</h2>
      <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted">Cumul des journées vérifiées dans Terrain, comparé aux quantités du bordereau actuel. Les mesures historiques saisies uniquement dans Administratif ne sont pas reprises ici. La vérification interne ne vaut pas certification du client.</p>
      <Link className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-cyan px-4 text-sm font-semibold text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan" href={`/projects/${project.id}?section=terrain&tab=journee`}>Déclarer les travaux du jour →</Link>
    </header>
    {production.unmatched > 0 && <p role="status" className="rounded-lg border border-line bg-sand p-4 text-sm">{production.unmatched} ligne(s) en attente de rattachement à un prix, ou dont l’unité diffère du bordereau actuel. Elles sont exclues des cumuls ci-dessous.</p>}
    <section className="overflow-hidden rounded-xl border border-line bg-paper-2">
      <h3 className="px-5 py-4 text-lg font-bold">Quantités par prix</h3>
      {production.rows.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Complétez le bordereau administratif pour suivre les quantités par ouvrage.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead className="bg-sand text-left text-muted"><tr>{['Ouvrage', 'Unité', 'Bordereau', 'Vérifié Terrain', 'À vérifier', 'Écart au bordereau'].map((title) => <th key={title} className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{production.rows.map((row) => <tr key={row.id}><th scope="row" className="max-w-sm px-4 py-4 text-left font-medium">{row.numero} · {row.designation}</th><td className="px-4 py-4">{row.unite}</td><td className="px-4 py-4 font-mono">{quantity(row.quantite)}</td><td className="px-4 py-4 font-mono font-bold text-cyan">{quantity(row.reviewed)}</td><td className="px-4 py-4 font-mono">{quantity(row.pending)}</td><td className={`px-4 py-4 ${row.overrun > 0 ? 'font-semibold text-clay' : 'text-muted'}`}>{row.overrun > 0 ? `Dépassement : ${quantity(row.overrun)}` : `Non déclaré : ${quantity(row.remaining)}`}</td></tr>)}</tbody>
      </table></div>}
    </section>
    <section className="rounded-xl border border-line bg-paper-2 p-5"><h3 className="text-lg font-bold">Répartition par zone</h3>{production.zones.length ? <ul className="mt-3 divide-y divide-line">{production.zones.map((zone) => <li key={JSON.stringify([zone.zone, zone.bpuId])} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span><strong>{zone.zone}</strong> · {zone.designation}</span><span className="font-mono">{quantity(zone.reviewed)} {zone.unite}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted">Les premières journées vérifiées alimenteront cette vue. Aucune progression physique globale n’est déduite de valeurs absentes.</p>}</section>
  </div>;
}
