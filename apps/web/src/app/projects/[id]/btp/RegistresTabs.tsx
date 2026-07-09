// Registres du marché: Avenants (CCAG-T art. 51/52/54), Ordres de service
// (art. 9/10), Pénalités/Cautions/Retenues (art. 60 & 40) et le circuit de
// validation multi-étapes.
import { apiGet } from '@/lib/api';
import {
  APPROVAL_STATUS_BADGES,
  AVENANT_STATUS_BADGES,
  CAUTION_STATUS_BADGES,
  CAUTION_TYPE_LABELS,
  fmtDate,
  fmtMad,
  fmtMadPrecise,
  ODS_ACTIONS_NEXT,
  ODS_STATUS_BADGES,
  ODS_TYPE_LABELS,
  PENALITE_STATUS_BADGES,
  type ApprovalRequest,
  type AvenantsView,
  type BtpProjectDetail,
  type Ods,
  type PenalitesView,
} from '@/lib/btp';
import {
  actionOds,
  createAvenant,
  createCaution,
  createOds,
  createPenalite,
  createValidation,
  decideValidation,
  deleteAvenant,
  deleteOds,
  libererRetenue,
  transitionAvenant,
  transitionCaution,
  transitionPenalite,
} from '../actions';

const inputClass =
  'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-widest text-faint';

function Badge({ spec }: { spec: { label: string; classes: string } }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${spec.classes}`}>
      {spec.label}
    </span>
  );
}

// ─── Avenants ────────────────────────────────────────────────────────────────

export async function AvenantsTab({ project }: { project: BtpProjectDetail }) {
  const { avenants, summary } = await apiGet<AvenantsView>(`/btp/projects/${project.id}/avenants`);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Montant initial', value: fmtMad(summary.montantInitial) },
          { label: 'Total avenants approuvés', value: fmtMad(summary.totalAvenants) },
          { label: 'Montant actuel', value: fmtMad(summary.montantActuel) },
          { label: 'Délai supplémentaire', value: `+${summary.delaiSupplementaireMois} mois` },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-line bg-paper-2 px-4 py-3 shadow-sm"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              {kpi.label}
            </p>
            <p className="mt-1 font-mono text-sm font-bold tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h3 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Avenants ({avenants.length})
        </h3>
        {avenants.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Aucun avenant.</p>
        ) : (
          <div className="divide-y divide-line">
            {avenants.map((avenant) => {
              const badge = AVENANT_STATUS_BADGES[avenant.statut] ?? {
                label: avenant.statut,
                classes: 'bg-sand text-muted',
              };
              return (
                <div key={avenant.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-cyan">
                        Avenant n°{avenant.numero}
                      </span>
                      <Badge spec={badge} />
                      <span className="text-[11px] text-faint">
                        {avenant.typeAvenant.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-sm tabular-nums">
                      <span className={avenant.montantDeltaMad >= 0 ? 'text-emerald' : 'text-clay'}>
                        {avenant.montantDeltaMad >= 0 ? '+' : ''}
                        {fmtMadPrecise(avenant.montantDeltaMad)}
                      </span>
                      {avenant.delaiDeltaMois !== 0 && (
                        <span className="text-muted">
                          {avenant.delaiDeltaMois > 0 ? '+' : ''}
                          {avenant.delaiDeltaMois} mois
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-muted">{avenant.objet}</p>
                  <p className="mt-1 text-[11px] text-faint">
                    {avenant.reference ? `Réf. ${avenant.reference} · ` : ''}
                    {avenant.dateAvenant ? `du ${fmtDate(avenant.dateAvenant)} · ` : ''}
                    {avenant.dateApprobation
                      ? `approuvé le ${fmtDate(avenant.dateApprobation)}`
                      : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {avenant.statut === 'brouillon' && (
                      <form action={transitionAvenant}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="avenantId" value={avenant.id} />
                        <input type="hidden" name="to" value="en_attente" />
                        <button className="rounded-lg bg-ochre-soft px-3 py-1 text-[11px] font-bold text-ochre">
                          Soumettre
                        </button>
                      </form>
                    )}
                    {avenant.statut === 'en_attente' && (
                      <>
                        <form action={transitionAvenant}>
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="avenantId" value={avenant.id} />
                          <input type="hidden" name="to" value="approuve" />
                          <button className="rounded-lg bg-emerald-soft px-3 py-1 text-[11px] font-bold text-emerald">
                            Approuver (direction)
                          </button>
                        </form>
                        <form action={transitionAvenant}>
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="avenantId" value={avenant.id} />
                          <input type="hidden" name="to" value="rejete" />
                          <button className="rounded-lg bg-clay-soft px-3 py-1 text-[11px] font-bold text-clay">
                            Rejeter
                          </button>
                        </form>
                      </>
                    )}
                    {avenant.statut !== 'approuve' && (
                      <form action={deleteAvenant}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="avenantId" value={avenant.id} />
                        <button className="text-[11px] font-semibold text-faint hover:text-clay">
                          Supprimer
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form
          action={createAvenant}
          className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-2"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <div className="sm:col-span-2">
            <label className={labelClass}>
              Objet de l'avenant *
              <input name="objet" required minLength={3} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <label className={labelClass}>
            Type
            <select name="typeAvenant" className={`${inputClass} mt-1`}>
              <option value="modification">Modification</option>
              <option value="prix_nouveaux">Prix nouveaux</option>
              <option value="mixte">Mixte</option>
              <option value="diminution">Diminution</option>
            </select>
          </label>
          <label className={labelClass}>
            Référence
            <input name="reference" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Date de l'avenant
            <input type="date" name="dateAvenant" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Montant (± MAD TTC)
            <input
              type="number"
              step="0.01"
              name="montantDeltaMad"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Délai supplémentaire (mois)
            <input
              type="number"
              step="0.5"
              name="delaiDeltaMois"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              + Créer l'avenant
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ─── ODS ─────────────────────────────────────────────────────────────────────

const ODS_FLOW = ['brouillon', 'emis', 'notifie', 'accuse', 'execute', 'cloture'] as const;

export async function OdsTab({ project }: { project: BtpProjectDetail }) {
  const odsList = await apiGet<Ods[]>(`/btp/projects/${project.id}/ods`);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Ordres de service</h2>
        <p className="text-xs text-muted">
          Circuit CCAG-T : brouillon → émis → notifié → accusé → exécuté → clôturé.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        {odsList.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Aucun ordre de service.</p>
        ) : (
          <div className="divide-y divide-line">
            {odsList.map((ods) => {
              const badge = ODS_STATUS_BADGES[ods.statut] ?? {
                label: ods.statut,
                classes: 'bg-sand text-muted',
              };
              const next = ODS_ACTIONS_NEXT[ods.statut];
              const flowIndex = ODS_FLOW.indexOf(ods.statut as (typeof ODS_FLOW)[number]);
              return (
                <div key={ods.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-cyan">
                        {ods.reference ?? `ODS-${ods.numero}`}
                      </span>
                      <Badge spec={badge} />
                      <span className="text-[11px] text-faint">
                        {ODS_TYPE_LABELS[ods.type] ?? ods.type}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-faint">
                      émis {fmtDate(ods.dateEmission)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{ods.objet}</p>
                  {(ods.impactDelaiJours !== 0 || ods.impactFinancierMad !== 0) && (
                    <p className="mt-1 font-mono text-[11px] text-ochre">
                      Impact : {ods.impactDelaiJours ? `${ods.impactDelaiJours} j` : ''}
                      {ods.impactDelaiJours && ods.impactFinancierMad ? ' · ' : ''}
                      {ods.impactFinancierMad ? fmtMad(ods.impactFinancierMad) : ''}
                    </p>
                  )}
                  {ods.statut !== 'annule' && (
                    <div className="mt-2 flex items-center gap-1">
                      {ODS_FLOW.map((step, i) => (
                        <div
                          key={step}
                          className={`h-1 flex-1 rounded-full ${
                            i <= flowIndex ? 'bg-cyan' : 'bg-sand'
                          }`}
                          title={step}
                        />
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {next && (
                      <form action={actionOds}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="odsId" value={ods.id} />
                        <input type="hidden" name="action" value={next.action} />
                        <button className="rounded-lg bg-cyan-soft px-3 py-1 text-[11px] font-bold text-cyan">
                          {next.label} →
                        </button>
                      </form>
                    )}
                    {!['cloture', 'annule'].includes(ods.statut) && (
                      <form action={actionOds}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="odsId" value={ods.id} />
                        <input type="hidden" name="action" value="cancel" />
                        <button className="text-[11px] font-semibold text-faint hover:text-clay">
                          Annuler
                        </button>
                      </form>
                    )}
                    {ods.statut === 'brouillon' && (
                      <form action={deleteOds}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="odsId" value={ods.id} />
                        <button className="text-[11px] font-semibold text-faint hover:text-clay">
                          Supprimer
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form
          action={createOds}
          className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-3"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <label className={labelClass}>
            Type
            <select name="type" className={`${inputClass} mt-1`}>
              {Object.entries(ODS_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <label className={labelClass}>
              Objet *
              <input name="objet" required minLength={3} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <label className={labelClass}>
            Date d'émission
            <input type="date" name="dateEmission" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Date d'effet
            <input type="date" name="dateEffet" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Impact délai (jours)
            <input type="number" name="impactDelaiJours" className={`${inputClass} mt-1 font-mono`} />
          </label>
          <label className={labelClass}>
            Émetteur
            <input name="emetteur" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Destinataire
            <input name="destinataire" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              + Créer l'ODS
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ─── Pénalités / Cautions / Retenues ─────────────────────────────────────────

export async function PenalitesTab({ project }: { project: BtpProjectDetail }) {
  const view = await apiGet<PenalitesView>(`/btp/projects/${project.id}/penalites`);
  const totalApplique = view.penalites
    .filter((p) => p.statut === 'appliquee')
    .reduce((sum, p) => sum + p.montantAppliqueMad, 0);
  const retenueCumulee = view.retenues.reduce(
    (max, r) => Math.max(max, r.montantCumuleMad ?? 0),
    0,
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line border-l-2 border-l-clay bg-paper-2 px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Pénalités appliquées
          </p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-clay">
            {fmtMadPrecise(totalApplique)}
          </p>
        </div>
        <div className="rounded-xl border border-line border-l-2 border-l-ochre bg-paper-2 px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Retenue de garantie cumulée
          </p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-ochre">
            {fmtMadPrecise(retenueCumulee)}
          </p>
        </div>
        <div className="rounded-xl border border-line border-l-2 border-l-cyan bg-paper-2 px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Cautions actives
          </p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums">
            {view.cautions.filter((c) => c.statut === 'active').length}
          </p>
        </div>
      </div>

      {/* Pénalités */}
      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h3 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Pénalités (CCAG-T art. 60 — 1/1000 par jour, plafond 10%)
        </h3>
        {view.penalites.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">Aucune pénalité.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Jours</th>
                <th className="px-4 py-2.5 text-right">Taux</th>
                <th className="px-4 py-2.5 text-right">Montant</th>
                <th className="px-4 py-2.5 text-right">Appliqué (plafonné)</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {view.penalites.map((penalite) => {
                const badge = PENALITE_STATUS_BADGES[penalite.statut] ?? {
                  label: penalite.statut,
                  classes: 'bg-sand text-muted',
                };
                return (
                  <tr key={penalite.id}>
                    <td className="px-4 py-2.5 text-xs">{penalite.type}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {penalite.nombreJours}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {penalite.taux}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {fmtMadPrecise(penalite.montantPenaliteMad)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-clay">
                      {fmtMadPrecise(penalite.montantAppliqueMad)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge spec={badge} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-2">
                        {penalite.statut === 'calculee' && (
                          <form action={transitionPenalite}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="penaliteId" value={penalite.id} />
                            <input type="hidden" name="to" value="notifiee" />
                            <button className="text-[11px] font-bold text-ochre">Notifier</button>
                          </form>
                        )}
                        {['notifiee', 'contestee'].includes(penalite.statut) && (
                          <form action={transitionPenalite}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="penaliteId" value={penalite.id} />
                            <input type="hidden" name="to" value="appliquee" />
                            <button className="text-[11px] font-bold text-clay">Appliquer</button>
                          </form>
                        )}
                        {['calculee', 'notifiee', 'contestee'].includes(penalite.statut) && (
                          <form action={transitionPenalite}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="penaliteId" value={penalite.id} />
                            <input type="hidden" name="to" value="remise" />
                            <button className="text-[11px] font-bold text-emerald">Remise</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form
          action={createPenalite}
          className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-5"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <label className={labelClass}>
            Type
            <select name="type" className={`${inputClass} mt-1`}>
              <option value="retard">Retard</option>
              <option value="malfacon">Malfaçon</option>
              <option value="non_conformite">Non-conformité</option>
              <option value="securite">Sécurité</option>
              <option value="autre">Autre</option>
            </select>
          </label>
          <label className={labelClass}>
            Jours *
            <input
              type="number"
              name="nombreJours"
              required
              min={0}
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Taux (déf. 0.001)
            <input
              type="number"
              step="0.0001"
              name="taux"
              placeholder="0.001"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Base (déf. montant marché)
            <input
              type="number"
              step="0.01"
              name="baseCalculMad"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              + Calculer
            </button>
          </div>
        </form>
      </section>

      {/* Cautions */}
      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h3 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Cautions & garanties
        </h3>
        {view.cautions.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">Aucune caution.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Organisme</th>
                <th className="px-4 py-2.5 text-right">Montant</th>
                <th className="px-4 py-2.5">Émission</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {view.cautions.map((caution) => {
                const badge = CAUTION_STATUS_BADGES[caution.statut] ?? {
                  label: caution.statut,
                  classes: 'bg-sand text-muted',
                };
                return (
                  <tr key={caution.id}>
                    <td className="px-4 py-2.5 text-xs">
                      {CAUTION_TYPE_LABELS[caution.type] ?? caution.type}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {caution.organisme ?? '—'}
                      {caution.referenceOrganisme ? ` (${caution.referenceOrganisme})` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {fmtMadPrecise(caution.montantMad)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{fmtDate(caution.dateEmission)}</td>
                    <td className="px-4 py-2.5">
                      <Badge spec={badge} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-2">
                        {caution.statut === 'active' && (
                          <form action={transitionCaution}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="cautionId" value={caution.id} />
                            <input type="hidden" name="to" value="liberee" />
                            <button className="text-[11px] font-bold text-emerald">Mainlevée</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form
          action={createCaution}
          className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-5"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <label className={labelClass}>
            Type
            <select name="type" className={`${inputClass} mt-1`}>
              {Object.entries(CAUTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Montant (MAD)
            <input
              type="number"
              step="0.01"
              name="montantMad"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Organisme
            <input name="organisme" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Date d'émission
            <input type="date" name="dateEmission" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              + Ajouter
            </button>
          </div>
        </form>
      </section>

      {/* Retenues */}
      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h3 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Retenues de garantie par décompte (synchronisées avec le moteur)
        </h3>
        {view.retenues.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">
            Aucune retenue — elles apparaissent avec les décomptes.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Décompte</th>
                <th className="px-4 py-2.5 text-right">TTC décompte</th>
                <th className="px-4 py-2.5 text-right">Retenue période</th>
                <th className="px-4 py-2.5 text-right">Retenue cumulée</th>
                <th className="px-4 py-2.5">État</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {view.retenues.map((retenue) => (
                <tr key={retenue.id}>
                  <td className="px-4 py-2.5 font-mono font-bold text-cyan">
                    n°{retenue.decompteNumero ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {fmtMadPrecise(retenue.montantDecompteMad ?? 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {fmtMadPrecise(retenue.montantRetenueMad)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-ochre">
                    {fmtMadPrecise(retenue.montantCumuleMad ?? 0)}
                  </td>
                  <td className="px-4 py-2.5">
                    {retenue.liberee ? (
                      <span className="rounded-full bg-emerald-soft px-2 py-0.5 text-[11px] font-semibold text-emerald">
                        Libérée le {fmtDate(retenue.dateLiberation)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-[11px] font-semibold text-ochre">
                        Retenue
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!retenue.liberee && (
                      <form action={libererRetenue}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="retenueId" value={retenue.id} />
                        <button className="text-[11px] font-bold text-emerald">Libérer</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ─── Validations ─────────────────────────────────────────────────────────────

export async function ValidationsTab({ project }: { project: BtpProjectDetail }) {
  const requests = await apiGet<ApprovalRequest[]>(`/btp/projects/${project.id}/validations`);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Circuit de validation</h2>
        <p className="text-xs text-muted">
          Soumettez un décompte, un avenant, un PV ou un ODS à l'approbation — étape par étape.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        {requests.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Aucune demande.</p>
        ) : (
          <div className="divide-y divide-line">
            {requests.map((request) => {
              const badge = APPROVAL_STATUS_BADGES[request.status] ?? {
                label: request.status,
                classes: 'bg-sand text-muted',
              };
              const decidable = ['en_attente', 'en_cours'].includes(request.status);
              return (
                <div key={request.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-ink-2">
                        {request.documentType.toUpperCase()}
                        {request.documentReference ? ` — ${request.documentReference}` : ''}
                      </span>
                      <Badge spec={badge} />
                      <span className="text-[11px] text-faint">priorité {request.priority}</span>
                    </div>
                    <span className="font-mono text-[11px] text-faint">
                      soumis {fmtDate(request.submittedAt)} par {request.requestedByName ?? '—'}
                    </span>
                  </div>
                  {request.note && <p className="mt-1 text-xs text-muted">{request.note}</p>}
                  <ol className="mt-2 flex flex-wrap items-center gap-2">
                    {request.steps.map((step) => (
                      <li
                        key={step.id}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                          step.status === 'approuve'
                            ? 'border-emerald-soft bg-emerald-soft/30 text-emerald'
                            : step.status === 'rejete'
                              ? 'border-clay-soft bg-clay-soft/30 text-clay'
                              : step.status === 'en_cours'
                                ? 'border-cyan-soft bg-cyan-soft/30 text-cyan'
                                : 'border-line text-faint'
                        }`}
                        title={step.comment ?? undefined}
                      >
                        {step.stepOrder}. {step.stepLabel}
                        {step.decidedByName ? ` — ${step.decidedByName}` : ''}
                      </li>
                    ))}
                  </ol>
                  {decidable && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <form action={decideValidation} className="flex items-center gap-2">
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="requestId" value={request.id} />
                        <input type="hidden" name="decision" value="approve" />
                        <button className="rounded-lg bg-emerald-soft px-3 py-1 text-[11px] font-bold text-emerald">
                          Approuver l'étape
                        </button>
                      </form>
                      <form action={decideValidation} className="flex items-center gap-2">
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="requestId" value={request.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <input
                          name="comment"
                          placeholder="Motif du rejet…"
                          className="rounded-lg border border-line bg-paper px-2 py-1 text-[11px]"
                        />
                        <button className="rounded-lg bg-clay-soft px-3 py-1 text-[11px] font-bold text-clay">
                          Rejeter
                        </button>
                      </form>
                      <form action={decideValidation}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="requestId" value={request.id} />
                        <input type="hidden" name="decision" value="cancel" />
                        <button className="text-[11px] font-semibold text-faint hover:text-clay">
                          Annuler la demande
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <form
          action={createValidation}
          className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-4"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <label className={labelClass}>
            Document *
            <select name="documentType" className={`${inputClass} mt-1`}>
              <option value="decompte">Décompte</option>
              <option value="avenant">Avenant</option>
              <option value="pv">PV</option>
              <option value="ods">ODS</option>
              <option value="attachement">Attachement</option>
              <option value="autre">Autre</option>
            </select>
          </label>
          <label className={labelClass}>
            Référence
            <input name="documentReference" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Priorité
            <select name="priority" defaultValue="normal" className={`${inputClass} mt-1`}>
              <option value="basse">Basse</option>
              <option value="normal">Normale</option>
              <option value="haute">Haute</option>
              <option value="urgente">Urgente</option>
            </select>
          </label>
          <label className={labelClass}>
            Échéance
            <input type="date" name="dueDate" className={`${inputClass} mt-1`} />
          </label>
          <div className="sm:col-span-2">
            <label className={labelClass}>
              Étape 1 (déf. « Validation »)
              <input name="step1Label" placeholder="Validation" className={`${inputClass} mt-1`} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>
              Étape 2 (optionnelle)
              <input name="step2Label" className={`${inputClass} mt-1`} />
            </label>
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>
              Note
              <input name="note" className={`${inputClass} mt-1`} />
            </label>
          </div>
          <div className="flex items-end">
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              + Soumettre
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
