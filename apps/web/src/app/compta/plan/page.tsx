// Plan comptable CGNC — arbre par classe, recherche, comptes personnalisés.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { CLASSE_LABELS, type Compte } from '@/lib/compta';
import { createCompte, toggleCompte } from '../actions';
import { ComptaHeader, SectionCard, StatusBanners, btnGhost, inputClass } from '../ui';

export const metadata = { title: 'Plan comptable — Comptabilité ATLAS' };

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    code?: string;
    q?: string;
    classe?: string;
  }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.classe) query.set('classe', params.classe);
  const comptes = await apiGet<Compte[]>(`/compta/plan?${query}`);
  const parClasse = new Map<number, Compte[]>();
  for (const compte of comptes) {
    const list = parClasse.get(compte.classe) ?? [];
    list.push(compte);
    parClasse.set(compte.classe, list);
  }

  return (
    <div>
      <ComptaHeader
        title="Plan comptable (CGNC)"
        subtitle={`${comptes.filter((c) => c.code.length >= 4).length} comptes de détail — plan marocain normalisé, extensible par vos propres subdivisions.`}
      />
      <StatusBanners searchParams={params} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form className="flex flex-1 flex-wrap gap-2">
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Code ou intitulé (ex. 6125, carburant…)"
            className={`${inputClass} min-w-60 flex-1`}
          />
          <button className="rounded-lg bg-sand px-4 py-2 text-sm font-semibold text-ink-2">
            Rechercher
          </button>
        </form>
        <div className="flex gap-1">
          <Link href="/compta/plan" className={btnGhost}>
            Toutes
          </Link>
          {[1, 2, 3, 4, 5, 6, 7].map((classe) => (
            <Link
              key={classe}
              href={`/compta/plan?classe=${classe}`}
              className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-bold transition ${
                Number(params.classe) === classe
                  ? 'bg-cyan text-paper'
                  : 'border border-line text-muted hover:bg-sand'
              }`}
            >
              {classe}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {[...parClasse.entries()]
            .sort(([a], [b]) => a - b)
            .map(([classe, rows]) => (
              <SectionCard key={classe} title={`Classe ${classe} — ${CLASSE_LABELS[classe] ?? ''}`}>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {rows.map((compte) => {
                      const rubrique = compte.code.length <= 2;
                      return (
                        <tr
                          key={compte.code}
                          className={rubrique ? 'bg-sand/50' : 'transition hover:bg-sand/30'}
                        >
                          <td
                            className={`w-24 px-4 py-1.5 font-mono tabular-nums ${
                              rubrique ? 'text-xs font-bold text-ink-2' : 'text-xs text-cyan'
                            }`}
                          >
                            {compte.code}
                          </td>
                          <td
                            className={`px-3 py-1.5 ${
                              rubrique
                                ? 'text-xs font-bold uppercase tracking-wide text-ink-2'
                                : compte.actif
                                  ? 'text-sm'
                                  : 'text-sm text-faint line-through'
                            }`}
                          >
                            {compte.intitule}
                            {compte.isCustom && (
                              <span className="ml-2 rounded bg-cyan-soft/50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan">
                                perso
                              </span>
                            )}
                          </td>
                          <td className="w-28 px-3 py-1.5 text-right">
                            {!rubrique && (
                              <div className="flex justify-end gap-2">
                                <Link
                                  href={`/compta/livres?compte=${compte.code}`}
                                  className="text-[11px] font-semibold text-cyan hover:underline"
                                >
                                  Grand livre
                                </Link>
                                <form action={toggleCompte}>
                                  <input type="hidden" name="code" value={compte.code} />
                                  <input
                                    type="hidden"
                                    name="actif"
                                    value={compte.actif ? '0' : '1'}
                                  />
                                  <button
                                    className="text-[11px] font-semibold text-faint hover:text-ink"
                                    title={compte.actif ? 'Désactiver' : 'Réactiver'}
                                  >
                                    {compte.actif ? '⏸' : '▶'}
                                  </button>
                                </form>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SectionCard>
            ))}
        </div>

        <div>
          <SectionCard
            title="Ajouter un compte"
            subtitle="Subdivision propre à l'entreprise (4 à 6 chiffres)."
          >
            <form action={createCompte} className="space-y-3 px-5 py-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Code
                <input
                  name="code"
                  required
                  pattern="\d{4,6}"
                  placeholder="61255"
                  className={`${inputClass} font-mono`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Intitulé
                <input
                  name="intitule"
                  required
                  placeholder="Carburants engins de chantier"
                  className={inputClass}
                />
              </label>
              <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper hover:opacity-90">
                Créer le compte
              </button>
            </form>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
