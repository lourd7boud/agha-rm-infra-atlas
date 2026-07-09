import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import {
  PROJECT_STATUS_BADGES,
  type Bordereau,
  type Decompte,
  type EmployeeListItem,
  type JournalResponse,
  type Paged,
  type ProjectCost,
  type ProjectLabor,
  type ProjectSummary,
  type RevisionResponse,
  type TaskStatus,
  type TasksResponse,
  type TeamResponse,
} from '@/lib/projects';
import { type ProjectMaterialConsumption } from '@/lib/stock';
import { type ProjectEquipmentRecord } from '@/lib/equipment';
import type { ProjectDetail } from './types';
import { FinancialSummarySection } from './sections/FinancialSummarySection';
import {
  NewSituationSection,
  SituationsSection,
} from './sections/SituationsSection';
import { TasksSection } from './sections/TasksSection';
import { TeamSection } from './sections/TeamSection';
import { JournalSection } from './sections/JournalSection';
import { ConsumptionSection } from './sections/ConsumptionSection';
import { EquipmentSection } from './sections/EquipmentSection';
import {
  BordereauSection,
  DecomptesSection,
  MarcheInfoSection,
  RevisionSection,
} from './sections/ExecutionSections';

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
  'assignEmployee:invalid':
    'Affectation refusée : tarif et base (jour/mois) doivent être renseignés ensemble.',
  'assignEmployee:failed':
    'Échec de l’affectation. Une affectation active existe peut-être déjà.',
  'logWorkDay:invalid':
    'Pointage refusé : la date est requise et les jours travaillés doivent être entre 0 et 2.',
  'logWorkDay:failed': 'Échec du pointage. Réessayez.',
  'endAssignment:failed':
    'Échec de la clôture de l’affectation. L’affectation est introuvable ou déjà clôturée.',
  'createSituation:invalid':
    'Situation refusée : la fin de période est requise et le montant cumulé doit être positif.',
  'createSituation:failed': 'Échec de l’enregistrement de la situation. Réessayez.',
  'createDailyLog:invalid':
    'Rapport refusé : effectifs ≥ 0 et travaux réalisés d’au moins 10 caractères requis.',
  'createDailyLog:failed': 'Échec de la consignation du rapport. Réessayez.',
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
  const [
    project,
    journal,
    team,
    employees,
    consumption,
    taskData,
    labor,
    projectEquipment,
    cost,
    bordereaux,
    decomptes,
    revision,
  ] = await Promise.all([
    apiGet<ProjectDetail>(`/project/projects/${id}`),
    apiGet<JournalResponse>(`/field/projects/${id}/logs`),
    apiGet<TeamResponse>(`/people/projects/${id}/team`),
    apiGet<Paged<EmployeeListItem>>('/people/employees?limit=100').then(
      (p) => p.items,
    ),
    apiGet<ProjectMaterialConsumption[]>(`/stock/projects/${id}/consumption`),
    apiGet<TasksResponse>(`/project/projects/${id}/tasks`),
    apiGet<ProjectLabor>(`/people/projects/${id}/labor`),
    apiGet<ProjectEquipmentRecord[]>(`/equipment/projects/${id}`),
    apiGet<ProjectCost>(`/project/projects/${id}/cost`),
    // Execution detail — degrade to empty rather than break the page.
    apiGet<Bordereau[]>(`/project/projects/${id}/bordereaux`).catch(() => []),
    apiGet<Decompte[]>(`/project/projects/${id}/decomptes`).catch(() => []),
    apiGet<RevisionResponse>(`/project/projects/${id}/revision`).catch(
      () => ({ config: null, formulas: [], indexes: [] }) as RevisionResponse,
    ),
  ]);
  // projectEquipment carries each machine's open assignment inline (affecté-le /
  // retour-prévu) from a single list call — no per-machine getEquipment fetch.
  // The labor summary keys off employeeId; team members carry the assignment id
  // (member.id). Joining here lets each row show its dues and own a pointage form.
  const laborByEmployee = new Map(
    labor.lines.map((line) => [line.employeeId, line]),
  );
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
    if (!(Number.isFinite(montant) && montant >= 0 && periodEnd)) {
      redirect(`/projects/${id}?error=createSituation&code=invalid`);
    }
    try {
      await apiPost(`/project/projects/${id}/situations`, {
        periodEnd,
        montantCumuleMad: montant,
      });
    } catch (error) {
      failToProject(id, 'createSituation', error);
    }
    revalidatePath(`/projects/${id}`);
    revalidatePath('/projects');
  }

  async function assignEmployee(formData: FormData) {
    'use server';
    const employeeId = String(formData.get('employeeId'));
    const startDate = String(formData.get('startDate'));
    if (!employeeId || !startDate) {
      redirect(`/projects/${id}?error=assignEmployee&code=invalid`);
    }
    // rate is optional, but a basis and an amount go together: the backend
    // rejects the half-set shape, so only forward the pair when both are present.
    const rateType = String(formData.get('rateType') ?? '');
    const rateRaw = String(formData.get('rateAmountMad') ?? '').trim();
    const rateAmountMad = rateRaw ? Number(rateRaw) : undefined;
    if ((rateType && rateAmountMad === undefined) || (rateAmountMad !== undefined && !rateType)) {
      redirect(`/projects/${id}?error=assignEmployee&code=invalid`);
    }
    try {
      await apiPost(`/people/employees/${employeeId}/assign`, {
        projectId: id,
        startDate,
        ...(rateType && rateAmountMad !== undefined
          ? { rateType, rateAmountMad }
          : {}),
      });
    } catch (error) {
      failToProject(id, 'assignEmployee', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function logWorkDay(formData: FormData) {
    'use server';
    const assignmentId = String(formData.get('aid') ?? '');
    const workDate = String(formData.get('workDate') ?? '');
    const daysWorked = Number(formData.get('daysWorked'));
    if (
      !assignmentId ||
      !workDate ||
      !Number.isFinite(daysWorked) ||
      daysWorked <= 0 ||
      daysWorked > 2
    ) {
      redirect(`/projects/${id}?error=logWorkDay&code=invalid`);
    }
    try {
      const notes = String(formData.get('notes') ?? '').trim();
      await apiPost(`/people/assignments/${assignmentId}/workdays`, {
        workDate,
        daysWorked,
        notes: notes || undefined,
      });
    } catch (error) {
      failToProject(id, 'logWorkDay', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function endAssignment(formData: FormData) {
    'use server';
    try {
      await apiPost(`/people/assignments/${String(formData.get('aid'))}/end`);
    } catch (error) {
      failToProject(id, 'endAssignment', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function createDailyLog(formData: FormData) {
    'use server';
    const effectifs = Number(formData.get('effectifs'));
    const travaux = String(formData.get('travauxRealises') ?? '');
    const reportDate = String(formData.get('reportDate'));
    if (
      !(
        Number.isInteger(effectifs) &&
        effectifs >= 0 &&
        travaux.trim().length >= 10 &&
        reportDate
      )
    ) {
      redirect(`/projects/${id}?error=createDailyLog&code=invalid`);
    }
    try {
      await apiPost(`/field/projects/${id}/logs`, {
        reportDate,
        effectifs,
        travauxRealises: travaux,
        blocages: String(formData.get('blocages') ?? '') || undefined,
        incidentsSecurite: Number(formData.get('incidentsSecurite')) || 0,
      });
    } catch (error) {
      failToProject(id, 'createDailyLog', error);
    }
    revalidatePath(`/projects/${id}`);
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

      <FinancialSummarySection project={project} cost={cost} />

      <MarcheInfoSection project={project} />

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

      <SituationsSection
        project={project}
        transitionSituation={transitionSituation}
      />

      <DecomptesSection decomptes={decomptes} />

      <BordereauSection bordereaux={bordereaux} />

      <RevisionSection revision={revision} />

      <TasksSection
        project={project}
        taskData={taskData}
        createTask={createTask}
        updateTask={updateTask}
      />

      <TeamSection
        project={project}
        team={team}
        labor={labor}
        laborByEmployee={laborByEmployee}
        assignable={assignable}
        assignEmployee={assignEmployee}
        logWorkDay={logWorkDay}
        endAssignment={endAssignment}
      />

      <JournalSection
        project={project}
        journal={journal}
        createDailyLog={createDailyLog}
      />

      <ConsumptionSection
        consumption={consumption}
        consumptionTotalMad={consumptionTotalMad}
      />

      <EquipmentSection projectEquipment={projectEquipment} />

      {project.status === 'en_cours' && (
        <NewSituationSection createSituation={createSituation} />
      )}
    </div>
  );
}
