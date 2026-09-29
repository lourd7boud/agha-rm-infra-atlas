// Vue d'ensemble — fiche marché (lecture + édition), délais & arrêts,
// situation contractuelle, chronologie et actions.
import Link from 'next/link';
import {
  DELAI_STATUS_BADGES,
  fmtDate,
  fmtMad,
  fmtPct,
  type BtpProjectDetail,
} from '@/lib/btp';
import {
  addArret,
  removeArret,
  setArretReprise,
  softDeleteProject,
  transitionStatus,
  updateFiche,
} from '../actions';

const NEXT_STATUS: Record<string, { to: string; label: string; tone: string }[]> = {
  preparation: [
    { to: 'en_cours', label: 'Démarrer les travaux (OS)', tone: 'bg-emerald-soft text-emerald' },
  ],
  en_cours: [
    { to: 'suspendu', label: 'Suspendre', tone: 'bg-ochre-soft text-ochre' },
    { to: 'receptionne', label: 'Réception provisoire', tone: 'bg-cyan-soft text-cyan' },
  ],
  suspendu: [
    { to: 'en_cours', label: 'Reprendre les travaux', tone: 'bg-emerald-soft text-emerald' },
  ],
  receptionne: [{ to: 'clos', label: 'Clôturer le marché', tone: 'bg-sand text-muted' }],
};

const inputClass =
  'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-widest text-faint';

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-faint">{label}</dt>
      <dd className={`mt-0.5 text-sm text-ink-2 ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

export function ApercuTab({ project }: { project: BtpProjectDetail }) {
  const delai = project.delai;
  const delaiBadge = DELAI_STATUS_BADGES[delai.status] ?? {
    label: delai.status,
    classes: 'bg-sand text-faint',
  };
  const statusActions = NEXT_STATUS[project.status] ?? [];
  const contractuelle = project.situationContractuelle;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      {/* Colonne principale */}
      <div className="space-y-6 xl:col-span-2">
        {/* Informations générales */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Informations générales
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Detail label="Objet du marché" value={project.objet ?? project.name} />
            </div>
            <Detail label="Numéro de marché" value={project.reference} mono />
            <Detail label="Année" value={project.annee ?? '—'} />
            <Detail
              label="Type de marché"
              value={project.typeMarche === 'negocie' ? 'Négocié' : 'Normal'}
            />
            <Detail label="Mode de passation" value={project.modePassation ?? '—'} />
            <Detail label="Commune" value={project.commune ?? '—'} />
            <Detail label="Date d'ouverture" value={fmtDate(project.dateOuverture)} />
            <Detail label="Montant (TTC)" value={fmtMad(project.montantMarcheMad)} mono />
            <Detail label="Maître d'œuvre" value={project.maitreOeuvre ?? project.buyerName} />
            <Detail label="Assistance technique" value={project.assistanceTechnique ?? '—'} />
          </dl>
        </section>

        {/* Informations administratives */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Société & imputation budgétaire
          </h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Detail label="Société attributaire" value={project.societe ?? '—'} />
            </div>
            <Detail label="RC" value={project.rc ?? '—'} mono />
            <Detail label="CB" value={project.cb ?? '—'} mono />
            <Detail label="CNSS" value={project.cnss ?? '—'} mono />
            <Detail label="Patente" value={project.patente ?? '—'} mono />
            <Detail label="Programme" value={project.programme ?? '—'} />
            <Detail label="Projet" value={project.projetLibelle ?? '—'} />
            <Detail label="Ligne" value={project.ligneBudgetaire ?? '—'} />
            <Detail label="Chapitre" value={project.chapitre ?? '—'} />
          </dl>
        </section>

        {/* Édition de la fiche */}
        <details className="group rounded-xl border border-line bg-paper-2 shadow-sm">
          <summary className="cursor-pointer select-none px-5 py-4 text-xs font-semibold uppercase tracking-widest text-cyan transition group-open:border-b group-open:border-line">
            ✎ Modifier la fiche marché
          </summary>
          <form action={updateFiche} className="grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="projectId" value={project.id} />
            <div className="sm:col-span-2">
              <label className={labelClass}>
                Objet
                <textarea
                  name="objet"
                  rows={3}
                  defaultValue={project.objet ?? ''}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
            <label className={labelClass}>
              N° marché
              <input
                name="reference"
                defaultValue={project.reference}
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              Année
              <input
                name="annee"
                defaultValue={project.annee ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Type de marché
              <select
                name="typeMarche"
                defaultValue={project.typeMarche ?? 'normal'}
                className={`${inputClass} mt-1`}
              >
                <option value="normal">Normal</option>
                <option value="negocie">Négocié</option>
              </select>
            </label>
            <label className={labelClass}>
              Mode de passation
              <input
                name="modePassation"
                defaultValue={project.modePassation ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Commune
              <input
                name="commune"
                defaultValue={project.commune ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Société
              <input
                name="societe"
                defaultValue={project.societe ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              RC
              <input
                name="rc"
                defaultValue={project.rc ?? ''}
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              CB
              <input
                name="cb"
                defaultValue={project.cb ?? ''}
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              CNSS
              <input
                name="cnss"
                defaultValue={project.cnss ?? ''}
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              Patente
              <input
                name="patente"
                defaultValue={project.patente ?? ''}
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              Programme
              <input
                name="programme"
                defaultValue={project.programme ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Projet
              <input
                name="projetLibelle"
                defaultValue={project.projetLibelle ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Ligne
              <input
                name="ligneBudgetaire"
                defaultValue={project.ligneBudgetaire ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Chapitre
              <input
                name="chapitre"
                defaultValue={project.chapitre ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Maître d'œuvre
              <input
                name="maitreOeuvre"
                defaultValue={project.maitreOeuvre ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Assistance technique
              <input
                name="assistanceTechnique"
                defaultValue={project.assistanceTechnique ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Date d'ouverture
              <input
                type="date"
                name="dateOuverture"
                defaultValue={project.dateOuverture?.slice(0, 10) ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              O.S.C
              <input
                type="date"
                name="osc"
                defaultValue={project.ordreServiceDate?.slice(0, 10) ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Délai (mois)
              <input
                type="number"
                step="0.5"
                min="0.5"
                name="delaiMois"
                defaultValue={project.delaiMois ?? ''}
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              Réception provisoire
              <input
                type="date"
                name="receptionProvisoire"
                defaultValue={project.receptionProvisoire?.slice(0, 10) ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Réception définitive
              <input
                type="date"
                name="receptionDefinitive"
                defaultValue={project.receptionDefinitive?.slice(0, 10) ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Achèvement des travaux
              <input
                type="date"
                name="achevementTravaux"
                defaultValue={project.achevementTravaux?.slice(0, 10) ?? ''}
                className={`${inputClass} mt-1`}
              />
            </label>
            <div className="sm:col-span-2">
              <button className="rounded-lg bg-cyan px-5 py-2 text-sm font-bold text-paper transition hover:opacity-90">
                Enregistrer la fiche
              </button>
            </div>
          </form>
        </details>
      </div>

      {/* Colonne latérale */}
      <div className="space-y-6">
        {/* Délais */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Délai d'exécution
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${delaiBadge.classes}`}
            >
              {delaiBadge.label}
            </span>
          </div>
          {delai.status === 'unknown' ? (
            <p className="mt-3 text-xs text-faint">
              Renseignez l'O.S.C et le délai (mois) pour suivre l'échéance.
            </p>
          ) : (
            <>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sand">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan to-ochre"
                  style={{ width: `${Math.min(100, delai.pourcentage)}%` }}
                />
              </div>
              <dl className="mt-3 space-y-1.5 text-xs text-muted">
                <div className="flex justify-between">
                  <dt>O.S.C</dt>
                  <dd className="font-mono">{fmtDate(project.ordreServiceDate)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Délai contractuel</dt>
                  <dd className="font-mono">
                    {project.delaiMois} mois ({delai.delaiJours} j)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Jours d'arrêt</dt>
                  <dd className="font-mono">{delai.joursArret} j</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Fin initiale</dt>
                  <dd className="font-mono">{fmtDate(delai.dateFinInitiale)}</dd>
                </div>
                <div className="flex justify-between font-semibold text-ink-2">
                  <dt>Fin effective</dt>
                  <dd className="font-mono">{fmtDate(delai.dateFinEffective)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Jours restants</dt>
                  <dd
                    className={`font-mono font-bold ${delai.joursRestants < 0 ? 'text-clay' : 'text-emerald'}`}
                  >
                    {delai.joursRestants} j
                  </dd>
                </div>
              </dl>
            </>
          )}

          {/* Arrêts */}
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Arrêts de travaux (OSA / OSR)
            </h3>
            {project.arrets.length === 0 ? (
              <p className="mt-2 text-xs text-faint">Aucun arrêt enregistré.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {project.arrets.map((arret) => (
                  <li
                    key={arret.id ?? arret.dateArret}
                    className="rounded-lg border border-line bg-paper px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-clay">⏸ {fmtDate(arret.dateArret)}</span>
                      <span className="text-emerald">
                        {arret.dateReprise ? `▶ ${fmtDate(arret.dateReprise)}` : 'en cours…'}
                      </span>
                    </div>
                    {arret.motif && <p className="mt-1 text-faint">{arret.motif}</p>}
                    <div className="mt-1.5 flex items-center gap-3">
                      {!arret.dateReprise && (
                        <form action={setArretReprise} className="flex items-center gap-1.5">
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="arretId" value={arret.id ?? ''} />
                          <input
                            type="date"
                            name="dateReprise"
                            required
                            className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[11px]"
                          />
                          <button className="font-semibold text-emerald hover:underline">
                            Reprise
                          </button>
                        </form>
                      )}
                      <form action={removeArret}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="arretId" value={arret.id ?? ''} />
                        <button className="font-semibold text-faint hover:text-clay">Retirer</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form action={addArret} className="mt-3 space-y-2">
              <input type="hidden" name="projectId" value={project.id} />
              <div className="flex gap-2">
                <input
                  type="date"
                  name="dateArret"
                  required
                  className="flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
                />
                <input
                  type="date"
                  name="dateReprise"
                  className="flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
                />
              </div>
              <div className="flex gap-2">
                <input
                  name="motif"
                  placeholder="Motif de l'arrêt"
                  className="flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
                />
                <button className="rounded-lg bg-sand px-3 py-1.5 text-xs font-bold text-ink-2 hover:bg-line">
                  + Arrêt
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Situation contractuelle */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Situation contractuelle
          </h2>
          <dl className="mt-3 space-y-1.5 text-xs text-muted">
            <div className="flex justify-between">
              <dt>Montant initial</dt>
              <dd className="font-mono tabular-nums">{fmtMad(contractuelle.montantInitial)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Avenants approuvés ({contractuelle.approuves})</dt>
              <dd className="font-mono tabular-nums">{fmtMad(contractuelle.totalAvenants)}</dd>
            </div>
            <div className="flex justify-between font-semibold text-ink-2">
              <dt>Montant actuel</dt>
              <dd className="font-mono tabular-nums">{fmtMad(contractuelle.montantActuel)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Délai supplémentaire</dt>
              <dd className="font-mono tabular-nums">
                +{contractuelle.delaiSupplementaireMois} mois
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Avancement financier</dt>
              <dd className="font-mono tabular-nums">{fmtPct(project.progressPct)}</dd>
            </div>
          </dl>
        </section>

        {/* Chronologie */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Chronologie
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-muted">
            <li className="flex justify-between">
              <span>Projet créé</span>
              <span className="font-mono">{fmtDate(project.createdAt)}</span>
            </li>
            {project.ordreServiceDate && (
              <li className="flex justify-between">
                <span>O.S. de commencement</span>
                <span className="font-mono">{fmtDate(project.ordreServiceDate)}</span>
              </li>
            )}
            {project.achevementTravaux && (
              <li className="flex justify-between">
                <span>Achèvement des travaux</span>
                <span className="font-mono">{fmtDate(project.achevementTravaux)}</span>
              </li>
            )}
            {project.receptionProvisoire && (
              <li className="flex justify-between">
                <span>Réception provisoire</span>
                <span className="font-mono">{fmtDate(project.receptionProvisoire)}</span>
              </li>
            )}
            {project.receptionDefinitive && (
              <li className="flex justify-between">
                <span>Réception définitive</span>
                <span className="font-mono">{fmtDate(project.receptionDefinitive)}</span>
              </li>
            )}
            <li className="flex justify-between">
              <span>Dernière modification</span>
              <span className="font-mono">{fmtDate(project.updatedAt)}</span>
            </li>
          </ul>
        </section>

        {/* Actions */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Actions rapides
          </h2>
          <div className="mt-3 space-y-2">
            <Link
              href={`/projects/${project.id}?tab=bordereau`}
              className="block rounded-lg border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-cyan hover:text-cyan"
            >
              ▦ Saisir le bordereau des prix
            </Link>
            <Link
              href={`/projects/${project.id}?tab=metres`}
              className="block rounded-lg border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-cyan hover:text-cyan"
            >
              ⌗ Nouveau métré (période + décompte auto)
            </Link>
            <Link
              href={`/projects/${project.id}?tab=photos`}
              className="block rounded-lg border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-cyan hover:text-cyan"
            >
              ◫ Ajouter des photos
            </Link>
            <Link
              href={`/projects/${project.id}?tab=documents`}
              className="block rounded-lg border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-cyan hover:text-cyan"
            >
              ◳ Joindre un document / PV
            </Link>
          </div>
          {statusActions.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              {statusActions.map((action) => (
                <form key={action.to} action={transitionStatus}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="to" value={action.to} />
                  <button
                    className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80 ${action.tone}`}
                  >
                    {action.label}
                  </button>
                </form>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <form action={softDeleteProject}>
              <input type="hidden" name="projectId" value={project.id} />
              <button className="w-full rounded-lg border border-clay-soft px-3 py-2 text-xs font-bold text-clay transition hover:bg-clay-soft/30">
                Mettre à la corbeille
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
