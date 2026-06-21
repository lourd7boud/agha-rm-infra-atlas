import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import {
  fmtMad,
  PROJECT_STATUS_BADGES,
  SITUATION_NEXT,
  SITUATION_STATUS_BADGES,
  TASK_STATUS_BADGES,
  TASK_STATUS_OPTIONS,
  type Employee,
  type JournalResponse,
  type ProjectSummary,
  type Situation,
  type TaskStatus,
  type TasksResponse,
  type TeamResponse,
} from '@/lib/projects';
import {
  fmtQty,
  type ProjectMaterialConsumption,
} from '@/lib/stock';

interface ProjectDetail extends ProjectSummary {
  situations: Situation[];
}

// next/navigation's redirect() throws a control-flow signal (NEXT_REDIRECT) that
// must NOT be swallowed by an action's catch — re-throw it untouched.
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

// Turn an action failure into user-visible feedback: log the real cause
// server-side, then redirect back to the project with a stable error code the
// page renders as a banner. The HTTP status (when the cause is an AtlasApiError)
// distinguishes a 400 (validation) from a 5xx (server). Mirrors /stock.
function failToProject(id: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[projects] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/projects/${id}?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createTask:invalid':
    'Tâche refusée : l’intitulé doit comporter au moins 3 caractères.',
  'createTask:failed': 'Échec de l’ajout de la tâche. Réessayez.',
  'updateTask:invalid':
    'Mise à jour refusée : vérifiez l’avancement (0–100%) et le statut.',
  'updateTask:failed': 'Échec de la mise à jour de la tâche. Réessayez.',
};

function actionErrorMessage(
  error: string | undefined,
  code: string | undefined,
): string | undefined {
  if (!error) return undefined;
  return (
    ACTION_ERROR_MESSAGES[`${error}:${code ?? 'failed'}`] ??
    'Une erreur est survenue. Réessayez.'
  );
}

const NEXT_PROJECT_ACTIONS: Partial<
  Record<ProjectSummary['status'], { to: string; label: string; tone: string }[]>
> = {
  preparation: [
    {
      to: 'en_cours',
      label: 'Démarrer les travaux (OS)',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
  ],
  en_cours: [
    {
      to: 'suspendu',
      label: 'Suspendre',
      tone: 'bg-amber-600 text-paper hover:bg-amber-700',
    },
    {
      to: 'receptionne',
      label: 'Réception provisoire',
      tone: 'bg-violet-600 text-paper hover:bg-violet-700',
    },
  ],
  suspendu: [
    {
      to: 'en_cours',
      label: 'Reprendre les travaux',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
  ],
  receptionne: [
    {
      to: 'clos',
      label: 'Clôturer le marché',
      tone: 'bg-slate-700 text-paper hover:bg-slate-800',
    },
  ],
};

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const [project, journal, team, employees, consumption, taskData] =
    await Promise.all([
      apiGet<ProjectDetail>(`/project/projects/${id}`),
      apiGet<JournalResponse>(`/field/projects/${id}/logs`),
      apiGet<TeamResponse>(`/people/projects/${id}/team`),
      apiGet<Employee[]>('/people/employees'),
      apiGet<ProjectMaterialConsumption[]>(`/stock/projects/${id}/consumption`),
      apiGet<TasksResponse>(`/project/projects/${id}/tasks`),
    ]);
  const consumptionTotalMad = consumption.reduce(
    (sum, row) => sum + row.totalCostMad,
    0,
  );
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

  async function createTask(formData: FormData) {
    'use server';
    const label = String(formData.get('label') ?? '').trim();
    if (label.length < 3) {
      redirect(`/projects/${id}?error=createTask&code=invalid`);
    }
    try {
      const dueDate = String(formData.get('dueDate') ?? '');
      const description = String(formData.get('description') ?? '').trim();
      await apiPost(`/project/projects/${id}/tasks`, {
        label,
        description: description || undefined,
        dueDate: dueDate || undefined,
        status: 'a_faire',
      });
    } catch (error) {
      failToProject(id, 'createTask', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function updateTask(formData: FormData) {
    'use server';
    const taskId = String(formData.get('taskId') ?? '');
    const progress = Number(formData.get('progressPct'));
    const status = String(formData.get('status') ?? '') as TaskStatus;
    if (!taskId || !Number.isFinite(progress) || progress < 0 || progress > 100) {
      redirect(`/projects/${id}?error=updateTask&code=invalid`);
    }
    try {
      await apiPatch(`/project/projects/${id}/tasks/${taskId}`, {
        progressPct: progress,
        status,
      });
    } catch (error) {
      failToProject(id, 'updateTask', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  return (
    <div>
      <Link href="/projects" className="text-sm text-muted hover:text-ink">
        ← Chantiers
      </Link>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-black tracking-tight">{project.reference}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
          {badge.label}
        </span>
      </div>
      <p className="mb-8 max-w-3xl text-sm text-muted">
        {project.name} — {project.buyerName}
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Montant du marché
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.montantMarcheMad)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Travaux réalisés
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(project.montantCumuleMad)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Avancement
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {project.avancementPct.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
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

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Situations de travaux ({project.situations.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
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
          <tbody className="divide-y divide-line">
            {project.situations.map((situation) => {
              const sBadge = SITUATION_STATUS_BADGES[situation.status];
              const next = SITUATION_NEXT[situation.status];
              return (
                <tr key={situation.id}>
                  <td className="px-4 py-3 font-mono font-bold">
                    {situation.numero}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {new Date(situation.periodEnd).toLocaleDateString('fr-MA')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(situation.montantCumuleMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(situation.montantPeriodeMad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-cyan">
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
                        <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
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
          <p className="p-8 text-center text-sm text-faint">
            Aucune situation — la première apparaît après le démarrage des travaux.
          </p>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Tâches ({taskData.tasks.length})
          </h2>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
            <span>
              Avancement physique{' '}
              <strong className="font-mono tabular-nums text-ink-2">
                {taskData.physicalProgressPct.toFixed(1)}%
              </strong>
            </span>
            <span className="flex flex-wrap gap-1.5">
              {TASK_STATUS_OPTIONS.map((option) => (
                <span
                  key={option.value}
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TASK_STATUS_BADGES[option.value].classes}`}
                >
                  {option.label} {taskData.statusSummary[option.value]}
                </span>
              ))}
            </span>
          </div>
        </div>
        <ul className="divide-y divide-line">
          {taskData.tasks.map((task) => {
            const tBadge = TASK_STATUS_BADGES[task.status];
            return (
              <li key={task.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{task.label}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tBadge.classes}`}
                      >
                        {tBadge.label}
                      </span>
                      {task.dueDate && (
                        <span className="font-mono text-xs tabular-nums text-faint">
                          échéance{' '}
                          {new Date(task.dueDate).toLocaleDateString('fr-MA')}
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="mt-1 text-sm text-ink-2">{task.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-2 w-48 max-w-full overflow-hidden rounded-full bg-sand">
                        <div
                          className="h-full rounded-full bg-cyan-deep"
                          style={{
                            width: `${Math.min(100, Math.max(0, task.progressPct))}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {task.progressPct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <form
                    action={updateTask}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="taskId" value={task.id} />
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-muted">
                        Avancement
                      </span>
                      <input
                        type="number"
                        name="progressPct"
                        required
                        min={0}
                        max={100}
                        step="1"
                        defaultValue={task.progressPct}
                        className="w-20 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-muted">Statut</span>
                      <select
                        name="status"
                        defaultValue={task.status}
                        className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                      >
                        {TASK_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="rounded-md border border-line-2 px-2.5 py-2 text-xs font-medium text-muted transition hover:bg-sand">
                      Mettre à jour
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        {taskData.tasks.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucune tâche — découpez le chantier en tâches ci-dessous.
          </p>
        )}
        {(project.status === 'en_cours' ||
          project.status === 'preparation' ||
          project.status === 'suspendu') && (
          <form
            action={createTask}
            className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
          >
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Intitulé</span>
              <input
                type="text"
                name="label"
                required
                minLength={3}
                maxLength={300}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">
                Description (optionnel)
              </span>
              <input
                type="text"
                name="description"
                maxLength={2000}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Échéance (optionnel)
              </span>
              <input
                type="date"
                name="dueDate"
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Ajouter la tâche
            </button>
          </form>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Équipe ({team.effectifActif} actif{team.effectifActif > 1 ? 's' : ''})
          </h2>
        </div>
        <ul className="divide-y divide-line">
          {team.membres.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{member.fullName}</p>
                <p className="text-xs text-faint">
                  {member.metier} · depuis{' '}
                  {new Date(member.startDate).toLocaleDateString('fr-MA')}
                  {member.endDate &&
                    ` → ${new Date(member.endDate).toLocaleDateString('fr-MA')}`}
                </p>
              </div>
              {member.actif ? (
                <form action={endAssignment}>
                  <input type="hidden" name="aid" value={member.id} />
                  <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
                    Clôturer l&apos;affectation
                  </button>
                </form>
              ) : (
                <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs text-muted">
                  Terminée
                </span>
              )}
            </li>
          ))}
        </ul>
        {team.membres.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucune affectation — composer l&apos;équipe ci-dessous.
          </p>
        )}
        {assignable.length > 0 &&
          (project.status === 'en_cours' || project.status === 'preparation') && (
            <form
              action={assignEmployee}
              className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
            >
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Employé</span>
                <select
                  name="employeeId"
                  required
                  className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                >
                  {assignable.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} — {employee.metier}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Début</span>
                <input
                  type="date"
                  name="startDate"
                  required
                  className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                />
              </label>
              <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
                Affecter au chantier
              </button>
            </form>
          )}
      </section>

      <section className="mb-6 rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Journal de chantier ({journal.summary.jours} jour
            {journal.summary.jours > 1 ? 's' : ''})
          </h2>
          <div className="flex gap-4 text-xs text-muted">
            <span>
              Effectif moyen{' '}
              <strong className="font-mono tabular-nums">
                {journal.summary.effectifMoyen}
              </strong>
            </span>
            <span>
              Incidents{' '}
              <strong
                className={`font-mono tabular-nums ${journal.summary.totalIncidents > 0 ? 'text-clay' : ''}`}
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
        <ul className="divide-y divide-line">
          {journal.items.map((log) => (
            <li key={log.id} className="px-5 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-faint">
                <span className="font-mono font-semibold tabular-nums text-muted">
                  {new Date(log.reportDate).toLocaleDateString('fr-MA')}
                </span>
                <span>{log.effectifs} ouvriers</span>
                {log.meteo && <span>{log.meteo}</span>}
                <span>par {log.createdBy}</span>
                {log.incidentsSecurite > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-clay">
                    {log.incidentsSecurite} incident
                    {log.incidentsSecurite > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-ink-2">{log.travauxRealises}</p>
              {log.blocages && (
                <p className="mt-1 text-sm font-medium text-cyan">
                  ⚠ {log.blocages}
                </p>
              )}
            </li>
          ))}
        </ul>
        {journal.items.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun rapport — le terrain remplit le journal quotidiennement.
          </p>
        )}
        {(project.status === 'en_cours' || project.status === 'suspendu') && (
          <form
            action={createDailyLog}
            className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
          >
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Date</span>
              <input
                type="date"
                name="reportDate"
                required
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Effectifs</span>
              <input
                type="number"
                name="effectifs"
                required
                min={0}
                className="w-24 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Incidents</span>
              <input
                type="number"
                name="incidentsSecurite"
                min={0}
                defaultValue={0}
                className="w-20 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="min-w-64 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">
                Travaux réalisés
              </span>
              <input
                type="text"
                name="travauxRealises"
                required
                minLength={10}
                maxLength={5000}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">
                Blocages (optionnel)
              </span>
              <input
                type="text"
                name="blocages"
                maxLength={2000}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Consigner
            </button>
          </form>
        )}
      </section>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Matériaux consommés ({consumption.length})
          </h2>
          <span className="text-xs text-muted">
            Coût total{' '}
            <strong className="font-mono tabular-nums text-ink-2">
              {fmtMad(consumptionTotalMad)}
            </strong>
          </span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Matériau</th>
              <th className="px-4 py-3 text-right">Quantité</th>
              <th className="px-4 py-3 text-right">Coût valorisé</th>
              <th className="px-4 py-3">Sorties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {consumption.map((row) => (
              <tr key={row.materialId}>
                <td className="px-4 py-3 font-semibold">{row.designation}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmtQty(row.totalQuantity, row.unit)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                  {fmtMad(row.totalCostMad)}
                </td>
                <td className="px-4 py-3">
                  <ul className="space-y-0.5">
                    {row.history.map((entry, index) => (
                      <li
                        key={`${row.materialId} ${index}`}
                        className="flex flex-wrap items-center gap-2 text-xs text-faint"
                      >
                        <span className="font-mono tabular-nums text-muted">
                          {new Date(entry.occurredAt).toLocaleDateString('fr-MA')}
                        </span>
                        <span className="font-mono tabular-nums">
                          {fmtQty(entry.quantity, row.unit)}
                        </span>
                        {entry.reference && (
                          <span className="font-mono">{entry.reference}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {consumption.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucune consommation — les sorties de stock affectées à ce chantier
            apparaissent ici.
          </p>
        )}
      </section>

      {project.status === 'en_cours' && (
        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Nouvelle situation de travaux
          </h2>
          <form action={createSituation} className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Fin de période
              </span>
              <input
                type="date"
                name="periodEnd"
                required
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Montant cumulé des travaux (MAD)
              </span>
              <input
                type="number"
                name="montantCumuleMad"
                required
                min={0}
                step="0.01"
                className="w-56 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Calculer le décompte
            </button>
          </form>
          <p className="mt-3 text-xs text-faint">
            Retenue de garantie 10% plafonnée à 7% du marché — calcul automatique
            (CCAG-T, hypothèses v1).
          </p>
        </section>
      )}
    </div>
  );
}
