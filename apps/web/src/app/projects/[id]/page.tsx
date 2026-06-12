import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { apiGet, apiPost } from '@/lib/api';
import {
  fmtMad,
  PROJECT_STATUS_BADGES,
  SITUATION_NEXT,
  SITUATION_STATUS_BADGES,
  type Employee,
  type JournalResponse,
  type ProjectSummary,
  type Situation,
  type TeamResponse,
} from '@/lib/projects';

interface ProjectDetail extends ProjectSummary {
  situations: Situation[];
}

const NEXT_PROJECT_ACTIONS: Partial<
  Record<ProjectSummary['status'], { to: string; label: string; tone: string }[]>
> = {
  preparation: [
    {
      to: 'en_cours',
      label: 'Démarrer les travaux (OS)',
      tone: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
  ],
  en_cours: [
    {
      to: 'suspendu',
      label: 'Suspendre',
      tone: 'bg-amber-600 text-white hover:bg-amber-700',
    },
    {
      to: 'receptionne',
      label: 'Réception provisoire',
      tone: 'bg-violet-600 text-white hover:bg-violet-700',
    },
  ],
  suspendu: [
    {
      to: 'en_cours',
      label: 'Reprendre les travaux',
      tone: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
  ],
  receptionne: [
    {
      to: 'clos',
      label: 'Clôturer le marché',
      tone: 'bg-slate-700 text-white hover:bg-slate-800',
    },
  ],
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, journal, team, employees] = await Promise.all([
    apiGet<ProjectDetail>(`/project/projects/${id}`),
    apiGet<JournalResponse>(`/field/projects/${id}/logs`),
    apiGet<TeamResponse>(`/people/projects/${id}/team`),
    apiGet<Employee[]>('/people/employees'),
  ]);
  const assignedIds = new Set(
    team.membres.filter((m) => m.actif).map((m) => m.employeeId),
  );
  const assignable = employees.filter(
    (e) => e.status === 'actif' && !assignedIds.has(e.id),
  );
  const badge = PROJECT_STATUS_BADGES[project.status];
  const actions = NEXT_PROJECT_ACTIONS[project.status] ?? [];

  async function transitionProject(formData: FormData) {
    'use server';
    await apiPost(`/project/projects/${id}/transition`, {
      to: String(formData.get('to')),
    });
    revalidatePath(`/projects/${id}`);
    revalidatePath('/projects');
  }

  async function createSituation(formData: FormData) {
    'use server';
    const montant = Number(formData.get('montantCumuleMad'));
    const periodEnd = String(formData.get('periodEnd'));
    if (Number.isFinite(montant) && montant >= 0 && periodEnd) {
      await apiPost(`/project/projects/${id}/situations`, {
        periodEnd,
        montantCumuleMad: montant,
      });
      revalidatePath(`/projects/${id}`);
      revalidatePath('/projects');
    }
  }

  async function assignEmployee(formData: FormData) {
    'use server';
    const employeeId = String(formData.get('employeeId'));
    const startDate = String(formData.get('startDate'));
    if (employeeId && startDate) {
      await apiPost(`/people/employees/${employeeId}/assign`, {
        projectId: id,
        startDate,
      });
      revalidatePath(`/projects/${id}`);
    }
  }

  async function endAssignment(formData: FormData) {
    'use server';
    await apiPost(
      `/people/assignments/${String(formData.get('aid'))}/end`,
    );
    revalidatePath(`/projects/${id}`);
  }

  async function createDailyLog(formData: FormData) {
    'use server';
    const effectifs = Number(formData.get('effectifs'));
    const travaux = String(formData.get('travauxRealises') ?? '');
    const reportDate = String(formData.get('reportDate'));
    if (Number.isInteger(effectifs) && effectifs >= 0 && travaux.trim().length >= 10) {
      await apiPost(`/field/projects/${id}/logs`, {
        reportDate,
        effectifs,
        travauxRealises: travaux,
        blocages: String(formData.get('blocages') ?? '') || undefined,
        incidentsSecurite: Number(formData.get('incidentsSecurite')) || 0,
      });
      revalidatePath(`/projects/${id}`);
    }
  }

  async function transitionSituation(formData: FormData) {
    'use server';
    await apiPost(
      `/project/situations/${String(formData.get('sid'))}/transition`,
      { to: String(formData.get('to')) },
    );
    revalidatePath(`/projects/${id}`);
  }

  return (
    <div>
      <Link href="/projects" className="text-sm text-slate-500 hover:text-slate-900">
        ← Chantiers
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">{project.reference}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
          {badge.label}
        </span>
      </div>
      <p className="mb-8 max-w-3xl text-sm text-slate-600">
        {project.name} — {project.buyerName}
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Montant du marché
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.montantMarcheMad)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Travaux réalisés
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.montantCumuleMad)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Avancement
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {project.avancementPct.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Retenue de garantie
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.retenueCumuleeMad)}
          </p>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-3">
          {actions.map((action) => (
            <form key={action.to} action={transitionProject}>
              <input type="hidden" name="to" value={action.to} />
              <button
                className={`rounded-md px-4 py-2 text-sm font-semibold transition ${action.tone}`}
              >
                {action.label}
              </button>
            </form>
          ))}
        </div>
      )}

      <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-5 py-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Situations de travaux ({project.situations.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">N°</th>
              <th className="px-4 py-3">Période</th>
              <th className="px-4 py-3 text-right">Cumulé</th>
              <th className="px-4 py-3 text-right">Période</th>
              <th className="px-4 py-3 text-right">Retenue</th>
              <th className="px-4 py-3 text-right">Net à payer</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {project.situations.map((situation) => {
              const sBadge = SITUATION_STATUS_BADGES[situation.status];
              const next = SITUATION_NEXT[situation.status];
              return (
                <tr key={situation.id}>
                  <td className="px-4 py-3 font-mono font-bold">
                    {situation.numero}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-500">
                    {new Date(situation.periodEnd).toLocaleDateString('fr-MA')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(situation.montantCumuleMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(situation.montantPeriodeMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700">
                    {fmtMad(situation.retenueGarantieMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(situation.netAPayerMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sBadge.classes}`}
                    >
                      {sBadge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {next && (
                      <form action={transitionSituation}>
                        <input type="hidden" name="sid" value={situation.id} />
                        <input type="hidden" name="to" value={next} />
                        <button className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100">
                          → {SITUATION_STATUS_BADGES[next].label}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {project.situations.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            Aucune situation — la première apparaît après le démarrage des travaux.
          </p>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Équipe ({team.effectifActif} actif{team.effectifActif > 1 ? 's' : ''})
          </h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {team.membres.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{member.fullName}</p>
                <p className="text-xs text-slate-400">
                  {member.metier} · depuis{' '}
                  {new Date(member.startDate).toLocaleDateString('fr-MA')}
                  {member.endDate &&
                    ` → ${new Date(member.endDate).toLocaleDateString('fr-MA')}`}
                </p>
              </div>
              {member.actif ? (
                <form action={endAssignment}>
                  <input type="hidden" name="aid" value={member.id} />
                  <button className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100">
                    Clôturer l&apos;affectation
                  </button>
                </form>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                  Terminée
                </span>
              )}
            </li>
          ))}
        </ul>
        {team.membres.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            Aucune affectation — composer l&apos;équipe ci-dessous.
          </p>
        )}
        {assignable.length > 0 &&
          (project.status === 'en_cours' || project.status === 'preparation') && (
            <form
              action={assignEmployee}
              className="flex flex-wrap items-end gap-3 border-t border-slate-100 px-5 py-4"
            >
              <label className="text-sm">
                <span className="mb-1 block text-xs text-slate-500">Employé</span>
                <select
                  name="employeeId"
                  required
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                >
                  {assignable.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} — {employee.metier}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-slate-500">Début</span>
                <input
                  type="date"
                  name="startDate"
                  required
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                />
              </label>
              <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
                Affecter au chantier
              </button>
            </form>
          )}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Journal de chantier ({journal.summary.jours} jour
            {journal.summary.jours > 1 ? 's' : ''})
          </h2>
          <div className="flex gap-4 text-xs text-slate-500">
            <span>
              Effectif moyen{' '}
              <strong className="font-mono tabular-nums">
                {journal.summary.effectifMoyen}
              </strong>
            </span>
            <span>
              Incidents{' '}
              <strong
                className={`font-mono tabular-nums ${journal.summary.totalIncidents > 0 ? 'text-rose-600' : ''}`}
              >
                {journal.summary.totalIncidents}
              </strong>
            </span>
            <span>
              Blocages{' '}
              <strong
                className={`font-mono tabular-nums ${journal.summary.blocagesOuverts > 0 ? 'text-amber-600' : ''}`}
              >
                {journal.summary.blocagesOuverts}
              </strong>
            </span>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {journal.items.map((log) => (
            <li key={log.id} className="px-5 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span className="font-mono font-semibold tabular-nums text-slate-600">
                  {new Date(log.reportDate).toLocaleDateString('fr-MA')}
                </span>
                <span>{log.effectifs} ouvriers</span>
                {log.meteo && <span>{log.meteo}</span>}
                <span>par {log.createdBy}</span>
                {log.incidentsSecurite > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
                    {log.incidentsSecurite} incident
                    {log.incidentsSecurite > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-700">{log.travauxRealises}</p>
              {log.blocages && (
                <p className="mt-1 text-sm font-medium text-amber-700">
                  ⚠ {log.blocages}
                </p>
              )}
            </li>
          ))}
        </ul>
        {journal.items.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            Aucun rapport — le terrain remplit le journal quotidiennement.
          </p>
        )}
        {(project.status === 'en_cours' || project.status === 'suspendu') && (
          <form
            action={createDailyLog}
            className="flex flex-wrap items-end gap-3 border-t border-slate-100 px-5 py-4"
          >
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Date</span>
              <input
                type="date"
                name="reportDate"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Effectifs</span>
              <input
                type="number"
                name="effectifs"
                required
                min={0}
                className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Incidents</span>
              <input
                type="number"
                name="incidentsSecurite"
                min={0}
                defaultValue={0}
                className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="min-w-64 flex-1 text-sm">
              <span className="mb-1 block text-xs text-slate-500">
                Travaux réalisés
              </span>
              <input
                type="text"
                name="travauxRealises"
                required
                minLength={10}
                maxLength={5000}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-slate-500">
                Blocages (optionnel)
              </span>
              <input
                type="text"
                name="blocages"
                maxLength={2000}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
              Consigner
            </button>
          </form>
        )}
      </section>

      {project.status === 'en_cours' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Nouvelle situation de travaux
          </h2>
          <form action={createSituation} className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">
                Fin de période
              </span>
              <input
                type="date"
                name="periodEnd"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">
                Montant cumulé des travaux (MAD)
              </span>
              <input
                type="number"
                name="montantCumuleMad"
                required
                min={0}
                step="0.01"
                className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
              Calculer le décompte
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-400">
            Retenue de garantie 10% plafonnée à 7% du marché — calcul automatique
            (CCAG-T, hypothèses v1).
          </p>
        </section>
      )}
    </div>
  );
}
