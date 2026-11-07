// Section Terrain — la saisie chantier pensée pour le chef de chantier:
// gros champs, une action par carte, totaux visibles. Chaque tab est un
// Server Component qui fetch exactement son endpoint /terrain/*.
import Link from 'next/link';
import { ExpenseReconciliationPanel } from './ExpenseReconciliationPanel';
import { apiGet } from '@/lib/api';
import type { TerrainJourneeRecord } from '@atlas/contracts';
import {
  DEPENSE_CATEGORIE_LABELS,
  DEPENSE_METHODE_LABELS,
  METEO_LABELS,
  fmtMad,
  type Bordereau,
  type Periode,
  type BtpProjectDetail,
  type TerrainAttachement,
  type TerrainConsommation,
  type TerrainCrewMember,
  type TerrainDepense,
  type TerrainMateriel,
  type TerrainOverview,
  type TerrainPointage,
  type TerrainRapport,
} from '@/lib/btp';
import {
  createAttachementTerrain,
  createConsommation,
  createDepenseChantier,
  createMaterielChantier,
  createPointage,
  createRapportChantier,
  deleteAttachementTerrain,
  deleteConsommation,
  deleteDepenseChantier,
  deleteMaterielChantier,
  deleteRapportChantier,
  integrerAttachement,
} from '../actions';

const inputClass =
  'w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-base outline-none placeholder:text-faint focus:border-cyan';
const labelClass =
  'block text-[11px] font-semibold uppercase tracking-widest text-faint';
const cardClass = 'rounded-xl border border-line bg-paper-2 p-5 shadow-sm';
const btnPrimary =
  'rounded-lg bg-cyan px-6 py-2.5 text-sm font-bold text-paper transition hover:opacity-90';

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function DeleteButton({ label = 'Suppr.' }: { label?: string }) {
  return (
    <button
      type="submit"
      className="text-xs font-semibold text-clay hover:underline"
    >
      {label}
    </button>
  );
}

// ─── Vue d'ensemble terrain ──────────────────────────────────────────────────
export async function TerrainApercuTab({
  project,
}: {
  project: BtpProjectDetail;
}) {
  const [overview, daily] = await Promise.all([
    apiGet<TerrainOverview>(`/btp/projects/${project.id}/terrain/overview`),
    apiGet<TerrainJourneeRecord[]>(
      `/btp/projects/${project.id}/terrain/journees`,
    ).catch(() => null),
  ]);
  const { couts, counts, derniersRapports } = overview;
  const pending =
    daily?.filter(
      (r) =>
        r.status === 'submitted' ||
        r.status === 'returned' ||
        (r.status === 'reviewed' &&
          (r.payload.attendance.some((a) => !a.assignmentId) ||
            r.payload.production.some((p) => !p.bpuLigneId))),
    ) ?? [];
  const openBlockers =
    daily?.flatMap((r) =>
      r.payload.blockers
        .filter((b) => b.status === 'open')
        .map((blocker) => ({
          blocker,
          date: r.payload.date,
          zone: r.payload.zone,
        })),
    ) ?? [];
  const missing = couts.missingValuations;
  const missingTotal =
    missing.mainOeuvre + missing.materiel + missing.consommations;
  const dailyHref = `/projects/${project.id}?section=terrain&tab=journee`;
  const kpis = [
    {
      label: 'Main d’œuvre valorisée',
      value: couts.mainOeuvreMad,
      missing: missing.mainOeuvre,
    },
    {
      label: 'Matériel & carburant valorisés',
      value: couts.materielMad,
      missing: missing.materiel,
    },
    {
      label: 'Consommations valorisées',
      value: couts.consommationsMad,
      missing: missing.consommations,
    },
  ];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line border-l-4 border-l-cyan bg-paper-2 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-cyan">
            Pilotage du chantier
          </p>
          <h2 className="mt-2 text-2xl font-bold">Le terrain, au quotidien</h2>
          <p className="mt-2 text-sm text-muted">
            Déclarez la journée, faites vérifier les ressources et suivez les
            actions du bureau.
          </p>
        </div>
        <Link
          href={dailyHref}
          className={`${btnPrimary} inline-flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan`}
        >
          Ouvrir la journée du chantier →
        </Link>
      </header>
      <section className={cardClass}>
        <h3 className="text-lg font-bold">À traiter</h3>
        {daily === null && (
          <p className="mt-3 text-sm text-clay">
            Les journées n’ont pas pu être chargées.{' '}
            <Link className="font-semibold underline" href={dailyHref}>
              Ouvrir la saisie pour réessayer
            </Link>
            .
          </p>
        )}
        <ul className="mt-3 divide-y divide-line text-sm">
          {pending.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <strong>
                  {fmtDate(r.payload.date)} · {r.payload.zone}
                </strong>
                <p className="text-muted">
                  {r.status === 'returned'
                    ? `Correction attendue : ${r.returnReason ?? 'voir la journée'}`
                    : r.status === 'reviewed'
                      ? `${r.payload.attendance.filter((a) => !a.assignmentId).length} personne(s) temporaire(s) · ${r.payload.production.filter((p) => !p.bpuLigneId).length} production(s) hors BPU à rattacher`
                      : 'Vérification du bureau attendue'}
                </p>
              </div>
              <Link
                className="inline-flex min-h-11 items-center font-semibold text-cyan underline"
                href={`${dailyHref}&date=${r.payload.date}`}
              >
                Traiter la journée →
              </Link>
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              {counts.attachementsASaisir} attachement(s) à intégrer au métré
            </span>
            <Link
              className="inline-flex min-h-11 items-center font-semibold text-cyan underline"
              href={`/projects/${project.id}?section=terrain&tab=attachements`}
            >
              Ouvrir les attachements →
            </Link>
          </li>
          {couts.unresolvedExpenseCount > 0 && (
            <li className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {couts.unresolvedExpenseCount} dépense(s) à rapprocher
              </span>
              <Link
                href={`/projects/${project.id}?section=terrain&tab=depenses`}
                className="inline-flex min-h-11 items-center font-semibold text-cyan underline"
              >
                Rapprocher les dépenses →
              </Link>
            </li>
          )}
          {missingTotal > 0 && (
            <li className="py-3 text-clay">
              {missingTotal} ressource(s) sans coût connu : compléter leur
              valorisation avant toute analyse financière.
            </li>
          )}
        </ul>
        {daily !== null && pending.length === 0 && (
          <p className="text-sm text-muted">
            Aucune journée en attente de vérification ou de correction.
          </p>
        )}
      </section>
      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold">
            Blocages ouverts ({openBlockers.length})
          </h3>
          <Link
            href={`/projects/${project.id}?section=terrain&tab=production`}
            className="inline-flex min-h-11 items-center font-semibold text-cyan underline"
          >
            Suivre la production par ouvrage →
          </Link>
        </div>
        {daily === null ? (
          <p className="mt-3 text-sm text-muted">
            Les blocages ne sont pas disponibles. Ouvrez la journée pour
            réessayer.
          </p>
        ) : openBlockers.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Aucun blocage ouvert déclaré dans les journées du chantier.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {openBlockers.map(({ blocker, date, zone }) => (
              <li
                key={blocker.id}
                className={`rounded-lg border p-4 ${blocker.severity === 'critical' ? 'border-clay' : 'border-line'}`}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {blocker.severity === 'critical'
                    ? 'Critique'
                    : blocker.severity === 'warning'
                      ? 'À traiter'
                      : 'Information'}{' '}
                  · {zone}
                </p>
                <h4 className="mt-2 font-semibold">{blocker.label}</h4>
                <p className="mt-2 text-sm text-muted">
                  Responsable : {blocker.owner}
                  <br />
                  Échéance :{' '}
                  {blocker.dueDate ? fmtDate(blocker.dueDate) : 'À préciser'} ·
                  signalé le {fmtDate(date)}
                </p>
                <Link
                  className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-cyan underline"
                  href={`${dailyHref}&date=${date}`}
                >
                  Ouvrir et traiter ce blocage →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Situation financière terrain" className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Ressources valorisées · cumul
            </p>
            <p className="mt-2 font-mono text-2xl font-bold">
              {fmtMad(couts.operationalResourceCostsMad)}
            </p>
            <p className="mt-2 text-sm text-muted">
              Somme des coûts connus de main-d’œuvre, matériel et consommations.
              {missingTotal > 0
                ? ` ${missingTotal} valorisation(s) manquante(s).`
                : ' Le rapprochement financier reste à réaliser.'}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Dépenses à rapprocher · cumul
            </p>
            <p className="mt-2 font-mono text-2xl font-bold">
              {fmtMad(couts.expensesAwaitingReconciliationMad)}
            </p>
            <p className="mt-2 text-sm text-muted">
              {couts.unresolvedExpenseCount} dépense(s) sans rapprochement. Leur
              lien avec les ressources doit être vérifié pour éviter les
              doublons.
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Dernier décompte · TTC
            </p>
            <p className="mt-2 font-mono text-2xl font-bold text-cyan">
              {couts.latestDecompte
                ? fmtMad(couts.decompteCumuleTtcMad)
                : 'Non disponible'}
            </p>
            <p className="mt-2 text-sm text-muted">
              {couts.latestDecompte
                ? `N°${couts.latestDecompte.numero} · ${couts.latestDecompte.statut}${couts.latestDecompte.dateDecompte ? ` · ${fmtDate(couts.latestDecompte.dateDecompte)}` : ''}`
                : 'Aucun décompte actif enregistré.'}
            </p>
          </div>
        </div>
        <p className="rounded-lg border border-line bg-sand p-3 text-sm text-muted">
          Coûts connus après rapprochement : {fmtMad(couts.knownCostsMad)} (dont{' '}
          {fmtMad(couts.reconciledExpensesMad)} de dépenses complémentaires
          confirmées). Coût total et marge indisponibles avant vérification
          complète des dépenses et des ressources. Le décompte TTC ne permet pas
          à lui seul de conclure à la rentabilité.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label} className={cardClass}>
              <p className="text-xs font-semibold text-muted">{k.label}</p>
              <p className="mt-2 font-mono text-xl font-bold">
                {fmtMad(k.value)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {k.missing
                  ? `${k.missing} ligne(s) non valorisée(s)`
                  : 'Coûts renseignés uniquement'}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Derniers rapports de chantier</h3>
          <span className="text-xs text-muted">
            {counts.rapports} rapports · {counts.depenses} dépenses
          </span>
        </div>
        {derniersRapports.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun rapport enregistré.{' '}
            <Link
              className="font-semibold text-cyan underline"
              href={dailyHref}
            >
              Commencer la première journée
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {derniersRapports.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap gap-x-4 gap-y-1 py-3 text-sm"
              >
                <span className="font-mono text-xs text-muted">
                  {fmtDate(r.reportDate)}
                </span>
                <span>{r.effectifs} personne(s)</span>
                <p className="min-w-0 flex-1 text-muted">{r.travauxRealises}</p>
                {r.incidentsSecurite > 0 && (
                  <span className="font-semibold text-clay">
                    {r.incidentsSecurite} incident(s)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Rapport du jour ─────────────────────────────────────────────────────────
export async function RapportsTab({ project }: { project: BtpProjectDetail }) {
  const rapports = await apiGet<TerrainRapport[]>(
    `/btp/projects/${project.id}/terrain/rapports?limit=90`,
  );
  return (
    <div className="space-y-6">
      <form action={createRapportChantier} className={cardClass}>
        <input type="hidden" name="projectId" value={project.id} />
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
          Rapport du jour · تقرير اليوم
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Date *
            <input
              type="date"
              name="reportDate"
              required
              defaultValue={today()}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={labelClass}>
            Effectif présent *
            <input
              type="number"
              name="effectifs"
              required
              min="0"
              inputMode="numeric"
              placeholder="8"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Météo
            <select
              name="meteo"
              className={`${inputClass} mt-1`}
              defaultValue="soleil"
            >
              {Object.entries(METEO_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Heures travaillées
            <input
              type="number"
              name="heuresTravail"
              step="0.5"
              min="0"
              max="24"
              inputMode="decimal"
              placeholder="8"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>
            Travaux réalisés * · الأشغال المنجزة
            <textarea
              name="travauxRealises"
              required
              rows={2}
              placeholder="Coulage béton semelles bloc A…"
              className={`${inputClass} mt-1 normal-case tracking-normal`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Matériel sur site
            <input
              name="materiel"
              placeholder="Pelle, bétonnière…"
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Blocages / remarques
            <input
              name="blocages"
              placeholder="Manque ciment…"
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={labelClass}>
            Incidents sécurité
            <input
              type="number"
              name="incidentsSecurite"
              min="0"
              defaultValue={0}
              inputMode="numeric"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Visites (MO, BET, labo…)
            <input name="visites" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Avancement (note)
            <input
              name="avancement"
              placeholder="Bloc A à 60%"
              className={`${inputClass} mt-1`}
            />
          </label>
        </div>
        <button type="submit" className={`${btnPrimary} mt-4`}>
          Enregistrer le rapport
        </button>
      </form>

      <div className={cardClass}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-faint">
          Historique ({rapports.length})
        </h3>
        {rapports.length === 0 ? (
          <p className="text-sm text-muted">Aucun rapport enregistré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Météo</th>
                  <th className="py-2 pr-3">Effectif</th>
                  <th className="py-2 pr-3">Travaux</th>
                  <th className="py-2 pr-3">Blocages</th>
                  <th className="py-2 pr-3">Incidents</th>
                  <th className="py-2 pr-3">Par</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rapports.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-2 pr-3 font-mono text-xs">
                      {fmtDate(r.reportDate)}
                    </td>
                    <td className="py-2 pr-3">
                      {r.meteo ? (METEO_LABELS[r.meteo] ?? r.meteo) : '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono">{r.effectifs}</td>
                    <td className="max-w-[280px] py-2 pr-3 text-muted">
                      {r.travauxRealises}
                    </td>
                    <td className="max-w-[180px] py-2 pr-3 text-muted">
                      {r.blocages ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {r.incidentsSecurite > 0 ? (
                        <span className="font-semibold text-clay">
                          ⚠ {r.incidentsSecurite}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-faint">
                      {r.createdBy}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deleteRapportChantier}>
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <input type="hidden" name="rapportId" value={r.id} />
                        <DeleteButton />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pointage main d'œuvre ───────────────────────────────────────────────────
export async function PointageTab({ project }: { project: BtpProjectDetail }) {
  const { crew, pointages } = await apiGet<{
    crew: TerrainCrewMember[];
    pointages: TerrainPointage[];
  }>(`/btp/projects/${project.id}/terrain/pointage`);
  const totalCout = pointages.reduce((sum, p) => sum + (p.coutMad ?? 0), 0);
  return (
    <div className="space-y-6">
      <form action={createPointage} className={cardClass}>
        <input type="hidden" name="projectId" value={project.id} />
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-cyan">
          Pointer une journée · تنقيط يوم عمل
        </h3>
        <p className="mb-4 text-xs text-muted">
          L&apos;équipe vient du module Personnel (affectations à ce chantier).
          Re-pointer le même jour remplace la saisie — pas de doublon.
        </p>
        {crew.length === 0 ? (
          <p className="rounded-lg bg-sand px-4 py-3 text-sm text-muted">
            Aucun ouvrier affecté à ce chantier. Affectez l&apos;équipe dans «
            Personnel » d&apos;abord.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className={`${labelClass} sm:col-span-2`}>
              Ouvrier *
              <select
                name="assignmentId"
                required
                className={`${inputClass} mt-1`}
              >
                {crew.map((m) => (
                  <option key={m.assignmentId} value={m.assignmentId}>
                    {m.fullName} — {m.metier}
                    {m.rateAmountMad
                      ? ` (${m.rateAmountMad} DH/${m.rateType ?? 'jour'})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Date *
              <input
                type="date"
                name="workDate"
                required
                defaultValue={today()}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Journée
              <select
                name="daysWorked"
                defaultValue="1"
                className={`${inputClass} mt-1`}
              >
                <option value="1">Journée complète</option>
                <option value="0.5">Demi-journée</option>
                <option value="1.5">Journée + heures sup</option>
                <option value="2">Double poste</option>
              </select>
            </label>
            <label className={`${labelClass} sm:col-span-3`}>
              Note
              <input
                name="notes"
                placeholder="Poste, tâche…"
                className={`${inputClass} mt-1`}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={btnPrimary}>
                Pointer
              </button>
            </div>
          </div>
        )}
      </form>

      <div className={cardClass}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Pointages récents ({pointages.length})
          </h3>
          <span className="font-mono text-sm font-bold tabular-nums">
            Coûts connus : {fmtMad(totalCout)} ·{' '}
            {pointages.filter((p) => p.coutMad === null).length} non valorisé(s)
          </span>
        </div>
        {pointages.length === 0 ? (
          <p className="text-sm text-muted">Aucun pointage.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Ouvrier</th>
                  <th className="py-2 pr-3">Métier</th>
                  <th className="py-2 pr-3">Jours</th>
                  <th className="py-2 pr-3 text-right">Coût</th>
                  <th className="py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pointages.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {fmtDate(p.workDate)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{p.employeeName}</td>
                    <td className="py-2 pr-3 text-muted">{p.metier}</td>
                    <td className="py-2 pr-3 font-mono">{p.daysWorked}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {p.coutMad === null ? 'À valoriser' : fmtMad(p.coutMad)}
                    </td>
                    <td className="py-2 text-muted">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Matériel & engins ───────────────────────────────────────────────────────
export async function MaterielTab({ project }: { project: BtpProjectDetail }) {
  const lignes = await apiGet<TerrainMateriel[]>(
    `/btp/projects/${project.id}/terrain/materiel`,
  );
  const total = lignes.reduce(
    (s, l) => s + (l.coutCarburantMad ?? 0) + (l.coutLocationMad ?? 0),
    0,
  );
  return (
    <div className="space-y-6">
      <form action={createMaterielChantier} className={cardClass}>
        <input type="hidden" name="projectId" value={project.id} />
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
          Matériel utilisé aujourd&apos;hui · المعدات المستعملة
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Date *
            <input
              type="date"
              name="date"
              required
              defaultValue={today()}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Engin / matériel *
            <input
              name="engin"
              required
              placeholder="Pelle hydraulique, camion 8T…"
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={labelClass}>
            Régime
            <select
              name="regime"
              defaultValue="propre"
              className={`${inputClass} mt-1`}
            >
              <option value="propre">Notre matériel</option>
              <option value="location">Location</option>
            </select>
          </label>
          <label className={labelClass}>
            Heures d&apos;utilisation
            <input
              type="number"
              name="heuresUtilisation"
              step="0.5"
              min="0"
              inputMode="decimal"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Carburant (L)
            <input
              type="number"
              name="carburantL"
              step="0.1"
              min="0"
              inputMode="decimal"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Coût carburant (DH)
            <input
              type="number"
              name="coutCarburantMad"
              step="0.01"
              min="0"
              inputMode="decimal"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Coût location (DH)
            <input
              type="number"
              name="coutLocationMad"
              step="0.01"
              min="0"
              inputMode="decimal"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
            Note
            <input name="note" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary}>
              Ajouter
            </button>
          </div>
        </div>
      </form>

      <div className={cardClass}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Journal matériel ({lignes.length})
          </h3>
          <span className="font-mono text-sm font-bold tabular-nums">
            Coûts connus : {fmtMad(total)}
          </span>
        </div>
        {lignes.length === 0 ? (
          <p className="text-sm text-muted">Aucune ligne matériel.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Engin</th>
                  <th className="py-2 pr-3">Régime</th>
                  <th className="py-2 pr-3">Heures</th>
                  <th className="py-2 pr-3">Carburant</th>
                  <th className="py-2 pr-3 text-right">Coût total</th>
                  <th className="py-2 pr-3">Par</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {fmtDate(l.date)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{l.engin}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.regime === 'location' ? 'bg-ochre-soft text-ochre' : 'bg-cyan-soft text-cyan'}`}
                      >
                        {l.regime === 'location' ? 'Location' : 'Propre'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {l.heuresUtilisation ?? '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {l.carburantL != null ? `${l.carburantL} L` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {l.coutCarburantMad === null || l.coutLocationMad === null
                        ? `Partiel : ${fmtMad((l.coutCarburantMad ?? 0) + (l.coutLocationMad ?? 0))} · à valoriser`
                        : fmtMad(l.coutCarburantMad + l.coutLocationMad)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-faint">
                      {l.saisiPar}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deleteMaterielChantier}>
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <input type="hidden" name="ligneId" value={l.id} />
                        <DeleteButton />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Consommations matériaux ─────────────────────────────────────────────────
export async function ConsommationsTab({
  project,
}: {
  project: BtpProjectDetail;
}) {
  const lignes = await apiGet<TerrainConsommation[]>(
    `/btp/projects/${project.id}/terrain/consommations`,
  );
  const total = lignes.reduce((s, l) => s + (l.coutMad ?? 0), 0);
  return (
    <div className="space-y-6">
      <form action={createConsommation} className={cardClass}>
        <input type="hidden" name="projectId" value={project.id} />
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
          Consommation matériaux · استهلاك المواد
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Date *
            <input
              type="date"
              name="date"
              required
              defaultValue={today()}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Article *
            <input
              name="article"
              required
              placeholder="Ciment CPJ45, fer T12…"
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={labelClass}>
            Unité
            <input
              name="unite"
              defaultValue="u"
              placeholder="sac, kg, m³"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Quantité *
            <input
              type="number"
              name="quantite"
              required
              step="0.001"
              min="0.001"
              inputMode="decimal"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Prix unitaire (DH)
            <input
              type="number"
              name="prixUnitaireMad"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="coût auto-calculé"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Coût total (DH)
            <input
              type="number"
              name="coutMad"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="ou laissez vide"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Fournisseur
            <input name="fournisseur" className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>
            Bon de livraison
            <input
              name="bonLivraison"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Note
            <input name="note" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary}>
              Ajouter
            </button>
          </div>
        </div>
      </form>

      <div className={cardClass}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Journal consommations ({lignes.length})
          </h3>
          <span className="font-mono text-sm font-bold tabular-nums">
            Coûts connus : {fmtMad(total)}
          </span>
        </div>
        {lignes.length === 0 ? (
          <p className="text-sm text-muted">Aucune consommation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Article</th>
                  <th className="py-2 pr-3 text-right">Qté</th>
                  <th className="py-2 pr-3">Unité</th>
                  <th className="py-2 pr-3 text-right">PU</th>
                  <th className="py-2 pr-3 text-right">Coût</th>
                  <th className="py-2 pr-3">Fournisseur / BL</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {fmtDate(l.date)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{l.article}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {l.quantite}
                    </td>
                    <td className="py-2 pr-3">{l.unite}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {l.prixUnitaireMad != null
                        ? fmtMad(l.prixUnitaireMad)
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {l.coutMad === null ? 'À valoriser' : fmtMad(l.coutMad)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">
                      {l.fournisseur ?? '—'}
                      {l.bonLivraison ? ` · BL ${l.bonLivraison}` : ''}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deleteConsommation}>
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <input type="hidden" name="ligneId" value={l.id} />
                        <DeleteButton />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dépenses ────────────────────────────────────────────────────────────────
export async function DepensesTab({ project }: { project: BtpProjectDetail }) {
  const depenses = await apiGet<TerrainDepense[]>(
    `/btp/projects/${project.id}/terrain/depenses`,
  );
  const total = depenses.reduce((s, d) => s + d.amountMad, 0);
  return (
    <div className="space-y-6">
      <form action={createDepenseChantier} className={cardClass}>
        <input type="hidden" name="projectId" value={project.id} />
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-cyan">
          Nouvelle dépense · مصروف جديد
        </h3>
        <p className="mb-4 text-xs text-muted">
          La plus petite dépense compte: photographiez le reçu, il est archivé
          avec la ligne.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Date *
            <input
              type="date"
              name="spentAt"
              required
              defaultValue={today()}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={labelClass}>
            Catégorie *
            <select name="category" required className={`${inputClass} mt-1`}>
              {Object.entries(DEPENSE_CATEGORIE_LABELS)
                .filter(([v]) => v !== 'sous_traitance')
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Libellé *
            <input
              name="label"
              required
              placeholder="Gasoil pelle, casse-croûte équipe…"
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className={labelClass}>
            Montant (DH) *
            <input
              type="number"
              name="amountMad"
              required
              step="0.01"
              min="0.01"
              inputMode="decimal"
              className={`${inputClass} mt-1 font-mono text-lg`}
            />
          </label>
          <label className={labelClass}>
            Paiement
            <select
              name="method"
              defaultValue="especes"
              className={`${inputClass} mt-1`}
            >
              {Object.entries(DEPENSE_METHODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Référence / n° reçu
            <input
              name="reference"
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className={labelClass}>
            Justificatif (photo)
            <input
              type="file"
              name="justificatif"
              accept="image/*,application/pdf"
              className={`${inputClass} mt-1 file:mr-2 file:rounded file:border-0 file:bg-cyan-soft file:px-2 file:py-1 file:text-xs file:font-semibold file:text-cyan`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-3`}>
            Notes
            <input name="notes" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary}>
              Enregistrer
            </button>
          </div>
        </div>
      </form>

      <div className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Dépenses du chantier ({depenses.length})
            </h3>
            <span className="font-mono text-base font-bold tabular-nums text-ink">
              Total: {fmtMad(total)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/btp-export/${project.id}/depenses`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-emerald hover:text-emerald"
              title="Télécharger le journal au format Excel (.xlsx)"
            >
              <span>📊</span>
              <span>Exporter Excel</span>
            </a>
            <a
              href={`/projects/${project.id}/depenses/print`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-cyan hover:text-cyan"
              title="Imprimer ou sauvegarder en PDF"
            >
              <span>🖨️</span>
              <span>Imprimer / PDF</span>
            </a>
          </div>
        </div>
        {depenses.length === 0 ? (
          <p className="text-sm text-muted">Aucune dépense saisie.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Catégorie</th>
                  <th className="py-2 pr-3">Libellé</th>
                  <th className="py-2 pr-3 text-right">Montant</th>
                  <th className="py-2 pr-3">Paiement</th>
                  <th className="py-2 pr-3">Justif.</th>
                  <th className="py-2 pr-3">Par</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {depenses.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {fmtDate(d.spentAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-semibold text-muted">
                        {DEPENSE_CATEGORIE_LABELS[d.category] ?? d.category}
                      </span>
                    </td>
                    <td className="max-w-[240px] py-2 pr-3">{d.label}</td>
                    <td className="py-2 pr-3 text-right font-mono font-semibold tabular-nums">
                      {fmtMad(d.amountMad)}
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      {d.method
                        ? (DEPENSE_METHODE_LABELS[d.method] ?? d.method)
                        : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {d.justificatifAssetId ? (
                        <a
                          href={`/api/btp-asset/${d.justificatifAssetId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-cyan hover:underline"
                        >
                          📎 Reçu
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-faint">
                      {d.saisiPar ?? '—'}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deleteDepenseChantier}>
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <input type="hidden" name="depenseId" value={d.id} />
                        <DeleteButton />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ExpenseReconciliationPanel projectId={project.id} expenses={depenses} />
    </div>
  );
}

// ─── Attachements terrain (quantités réalisées → métrés) ───────────────────
export async function AttachementsTab({
  project,
}: {
  project: BtpProjectDetail;
}) {
  const [attachements, bordereau, periodes] = await Promise.all([
    apiGet<TerrainAttachement[]>(
      `/btp/projects/${project.id}/terrain/attachements`,
    ),
    apiGet<Bordereau>(`/btp/projects/${project.id}/bordereau`).catch(
      () => null,
    ),
    apiGet<Periode[]>(`/btp/projects/${project.id}/periodes`),
  ]);
  const openPeriods = periodes.filter((p) => p.statut === 'en_cours');
  const lignes = bordereau?.lignes ?? [];
  return (
    <div className="space-y-6">
      <form action={createAttachementTerrain} className={cardClass}>
        <input type="hidden" name="projectId" value={project.id} />
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-cyan">
          Quantités réalisées · الكميات المنجزة
        </h3>
        <p className="mb-4 text-xs text-muted">
          Le chef de chantier déclare les quantités réellement exécutées par
          prix du bordereau; le bureau les intègre ensuite au métré officiel.
        </p>
        {lignes.length === 0 ? (
          <p className="rounded-lg bg-sand px-4 py-3 text-sm text-muted">
            Le bordereau des prix est vide — saisissez-le d&apos;abord (section
            Administratif).
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className={labelClass}>
              Date *
              <input
                type="date"
                name="date"
                required
                defaultValue={today()}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Prix du bordereau *
              <select name="ligne" required className={`${inputClass} mt-1`}>
                {lignes.map((l) => (
                  <option
                    key={l.id ?? l.numero}
                    value={`${l.id ?? l.numero}:::${l.numero}:::${l.unite}:::${l.designation}`}
                  >
                    n°{l.numero} — {l.designation.slice(0, 90)} ({l.unite})
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Quantité réalisée *
              <input
                type="number"
                name="quantite"
                required
                step="0.001"
                min="0.001"
                inputMode="decimal"
                className={`${inputClass} mt-1 font-mono text-lg`}
              />
            </label>
            <label className={`${labelClass} sm:col-span-3`}>
              Note
              <input
                name="note"
                placeholder="Zone, repère du plan…"
                className={`${inputClass} mt-1`}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={btnPrimary}>
                Déclarer
              </button>
            </div>
          </div>
        )}
      </form>

      <div className={cardClass}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-faint">
          Attachements saisis ({attachements.length})
        </h3>
        {attachements.length === 0 ? (
          <p className="text-sm text-muted">Aucun attachement terrain.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Prix n°</th>
                  <th className="py-2 pr-3">Désignation</th>
                  <th className="py-2 pr-3 text-right">Quantité</th>
                  <th className="py-2 pr-3">Unité</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2 pr-3">Par</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {attachements.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {fmtDate(a.date)}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {a.numeroPrix ?? '—'}
                    </td>
                    <td className="max-w-[280px] py-2 pr-3 text-muted">
                      {a.designation}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {a.quantite}
                    </td>
                    <td className="py-2 pr-3">{a.unite}</td>
                    <td className="py-2 pr-3">
                      {a.metreId ? (
                        <span className="rounded-full bg-emerald-soft px-2 py-0.5 text-xs font-semibold text-emerald">
                          Intégré au métré
                        </span>
                      ) : (
                        <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-xs font-semibold text-ochre">
                          {a.statut === 'integre' ? 'Ancien marquage · lien à vérifier' : 'À intégrer'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-faint">
                      {a.saisiPar}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {!a.metreId && a.statut !== 'integre' && (
                          <form
                            action={integrerAttachement}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.id}
                            />
                            <input
                              type="hidden"
                              name="attachementId"
                              value={a.id}
                            />
                            <label className="text-left text-xs text-muted">
                              Période de métré
                              <select
                                name="periodeId"
                                required
                                defaultValue=""
                                className={`${inputClass} min-h-11`}
                                aria-label={`Période pour ${a.designation}`}
                              >
                                <option value="">Choisir une période</option>
                                {openPeriods.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    N°{p.numero} · {p.libelle ?? 'En cours'}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              disabled={openPeriods.length === 0}
                              className="min-h-11 rounded-lg border border-line px-3 text-xs font-semibold text-cyan focus-visible:outline-2 focus-visible:outline-cyan disabled:opacity-50"
                            >
                              Intégrer au métré
                            </button>
                            {openPeriods.length === 0 && (
                              <Link
                                href={`/projects/${project.id}?tab=metres`}
                                className="text-xs text-cyan underline"
                              >
                                Créer une période en cours
                              </Link>
                            )}
                          </form>
                        )}
                        {a.statut === 'integre' ? (
                          <Link
                            href={`/projects/${project.id}?tab=metres`}
                            className="inline-flex min-h-11 items-center text-xs font-semibold text-cyan underline"
                          >
                            Voir les métrés
                          </Link>
                        ) : (
                          <form action={deleteAttachementTerrain}>
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.id}
                            />
                            <input
                              type="hidden"
                              name="attachementId"
                              value={a.id}
                            />
                            <DeleteButton />
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
