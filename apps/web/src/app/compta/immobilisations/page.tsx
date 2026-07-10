// Immobilisations — registre avec situation d'amortissement (dotation de
// l'exercice, cumul, VNC), plan d'amortissement détaillé, cession/sortie.
import { apiGet } from '@/lib/api';
import { CATEGORIE_IMMO_LABELS, fmtDate, fmtMad, type Immobilisation } from '@/lib/compta';
import { cederImmobilisation, createImmobilisation, deleteImmobilisation } from '../actions';
import {
  AnneePicker,
  ComptaHeader,
  KpiCard,
  SectionCard,
  StatusBanners,
  StatutBadge,
  inputClass,
} from '../ui';

export const metadata = { title: 'Immobilisations — Comptabilité ATLAS' };

export default async function ImmobilisationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    code?: string;
    annee?: string;
    immo?: string;
  }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const [immobilisations, detail] = await Promise.all([
    apiGet<Immobilisation[]>(`/compta/immobilisations?annee=${annee}`),
    params.immo
      ? apiGet<Immobilisation>(`/compta/immobilisations/${params.immo}?annee=${annee}`)
      : null,
  ]);

  const actives = immobilisations.filter((i) => i.statut === 'actif');
  const totalBrut = actives.reduce((s, i) => s + i.valeurHt, 0);
  const totalVnc = actives.reduce((s, i) => s + i.vnc, 0);
  const dotations = actives.reduce((s, i) => s + i.dotationExercice, 0);

  return (
    <div>
      <ComptaHeader
        title="Immobilisations & amortissements"
        subtitle="Amortissement linéaire prorata temporis (mois de mise en service). La dotation annuelle alimente la D.E.A. (compte 6193) et la base de la taxe professionnelle."
        actions={<AnneePicker annee={annee} path="/compta/immobilisations" />}
      />
      <StatusBanners searchParams={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Immobilisations actives" value={actives.length} accent="border-l-cyan" />
        <KpiCard label="Valeur brute" value={fmtMad(totalBrut)} accent="border-l-teal" />
        <KpiCard label={`Dotation ${annee}`} value={fmtMad(dotations)} accent="border-l-ochre" />
        <KpiCard label={`VNC fin ${annee}`} value={fmtMad(totalVnc)} accent="border-l-emerald" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Registre">
            {immobilisations.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">
                Aucune immobilisation enregistrée.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-2 text-left">Désignation</th>
                      <th className="px-3 py-2 text-left">Compte</th>
                      <th className="px-3 py-2 text-right">Valeur HT</th>
                      <th className="px-3 py-2 text-right">Taux</th>
                      <th className="px-3 py-2 text-right">Dotation {annee}</th>
                      <th className="px-3 py-2 text-right">VNC</th>
                      <th className="px-3 py-2 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {immobilisations.map((immo) => (
                      <tr
                        key={immo.id}
                        className={`transition hover:bg-sand/40 ${
                          detail?.id === immo.id ? 'bg-cyan-soft/20' : ''
                        }`}
                      >
                        <td className="max-w-56 px-4 py-2">
                          <a
                            href={`/compta/immobilisations?annee=${annee}&immo=${immo.id}`}
                            className="block truncate font-semibold hover:text-cyan"
                            title={immo.designation}
                          >
                            {immo.designation}
                          </a>
                          <span className="text-[10px] text-faint">
                            {CATEGORIE_IMMO_LABELS[immo.categorie] ?? immo.categorie} ·{' '}
                            {fmtDate(immo.dateAcquisition)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-cyan">{immo.compteCode}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {fmtMad(immo.valeurHt)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {immo.tauxAmortissement} %
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {fmtMad(immo.dotationExercice)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                          {fmtMad(immo.vnc)}
                        </td>
                        <td className="px-3 py-2">
                          <StatutBadge statut={immo.statut} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {detail?.plan && (
            <SectionCard
              title={`Plan d'amortissement — ${detail.designation}`}
              subtitle={`${detail.tauxAmortissement} % linéaire · mise en service ${fmtDate(
                detail.dateMiseEnService ?? detail.dateAcquisition,
              )}`}
              actions={
                detail.statut === 'actif' ? (
                  <div className="flex gap-2">
                    <form action={cederImmobilisation} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={detail.id} />
                      <input
                        type="hidden"
                        name="backTo"
                        value={`/compta/immobilisations?annee=${annee}`}
                      />
                      <input
                        type="date"
                        name="dateSortie"
                        className="rounded border border-line bg-paper px-2 py-1 font-mono text-[11px]"
                      />
                      <input
                        name="prixCession"
                        inputMode="decimal"
                        placeholder="Prix cession"
                        className="w-24 rounded border border-line bg-paper px-2 py-1 text-right font-mono text-[11px]"
                      />
                      <button className="rounded bg-ochre-soft/50 px-2 py-1 text-[11px] font-bold text-ochre">
                        Céder
                      </button>
                    </form>
                    <form action={deleteImmobilisation}>
                      <input type="hidden" name="id" value={detail.id} />
                      <input
                        type="hidden"
                        name="backTo"
                        value={`/compta/immobilisations?annee=${annee}`}
                      />
                      <button className="rounded px-2 py-1 text-[11px] font-bold text-faint hover:text-clay">
                        Supprimer
                      </button>
                    </form>
                  </div>
                ) : undefined
              }
            >
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Année</th>
                    <th className="px-3 py-2 text-right">Dotation</th>
                    <th className="px-3 py-2 text-right">Cumul</th>
                    <th className="px-3 py-2 text-right">VNC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono text-xs tabular-nums">
                  {detail.plan.map((ligne) => (
                    <tr
                      key={ligne.annee}
                      className={ligne.annee === annee ? 'bg-cyan-soft/20 font-semibold' : ''}
                    >
                      <td className="px-4 py-1.5">{ligne.annee}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMad(ligne.dotation)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMad(ligne.cumul)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMad(ligne.vnc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}
        </div>

        <div>
          <SectionCard
            title="Nouvelle immobilisation"
            subtitle="Compte classe 2 + taux linéaire (20 % = 5 ans)."
          >
            <form action={createImmobilisation} className="space-y-3 px-5 py-4">
              <input
                type="hidden"
                name="backTo"
                value={`/compta/immobilisations?annee=${annee}`}
              />
              <input
                name="designation"
                required
                placeholder="Camion benne Mercedes…"
                className={`${inputClass} w-full`}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  name="compteCode"
                  required
                  pattern="2\d{3,5}"
                  placeholder="2340"
                  className={`${inputClass} font-mono`}
                />
                <select name="categorie" className={inputClass} defaultValue="materiel_technique">
                  {Object.entries(CATEGORIE_IMMO_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted">
                  Acquisition
                  <input
                    type="date"
                    name="dateAcquisition"
                    required
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted">
                  Mise en service
                  <input
                    type="date"
                    name="dateMiseEnService"
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <input
                  name="valeurHt"
                  required
                  inputMode="decimal"
                  placeholder="Valeur HT"
                  className={`${inputClass} text-right font-mono`}
                />
                <input
                  name="tauxAmortissement"
                  required
                  inputMode="decimal"
                  placeholder="Taux % (ex. 20)"
                  className={`${inputClass} text-right font-mono`}
                />
              </div>
              <input
                name="fournisseur"
                placeholder="Fournisseur"
                className={`${inputClass} w-full`}
              />
              <input
                name="pieceRef"
                placeholder="N° facture / pièce"
                className={`${inputClass} w-full font-mono`}
              />
              <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
                Enregistrer
              </button>
            </form>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
