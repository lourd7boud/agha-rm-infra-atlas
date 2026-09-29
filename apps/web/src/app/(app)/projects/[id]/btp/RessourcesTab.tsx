// Onglets « Ressources » et « Journal » — la composition cross-modules héritée
// du chantier ATLAS (coûts, situations legacy, tâches, équipe, matériaux,
// matériel, journal de chantier), portée telle quelle depuis la page master.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type {
  EmployeeListItem,
  JournalResponse,
  Paged,
  ProjectCost,
  ProjectLabor,
  TaskStatus,
  TasksResponse,
  TeamResponse,
} from '@/lib/projects';
import { type ProjectMaterialConsumption } from '@/lib/stock';
import { type ProjectEquipmentRecord } from '@/lib/equipment';
import type { BtpProjectDetail } from '@/lib/btp';
import type { ProjectDetail } from '../types';
import { FinancialSummarySection } from '../sections/FinancialSummarySection';
import { NewSituationSection, SituationsSection } from '../sections/SituationsSection';
import { TasksSection } from '../sections/TasksSection';
import { TeamSection } from '../sections/TeamSection';
import { JournalSection } from '../sections/JournalSection';
import { ConsumptionSection } from '../sections/ConsumptionSection';
import { EquipmentSection } from '../sections/EquipmentSection';

function failTo(id: string, tab: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(`[projects] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`, error);
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/projects/${id}?tab=${tab}&error=${action}&code=${code}`);
}

export async function RessourcesTab({ project: btpProject }: { project: BtpProjectDetail }) {
  const id = btpProject.id;
  const [project, team, employees, consumption, taskData, labor, projectEquipment, cost] =
    await Promise.all([
      apiGet<ProjectDetail>(`/project/projects/${id}`),
      apiGet<TeamResponse>(`/people/projects/${id}/team`),
      apiGet<Paged<EmployeeListItem>>('/people/employees?limit=100').then((p) => p.items),
      apiGet<ProjectMaterialConsumption[]>(`/stock/projects/${id}/consumption`),
      apiGet<TasksResponse>(`/project/projects/${id}/tasks`),
      apiGet<ProjectLabor>(`/people/projects/${id}/labor`),
      apiGet<ProjectEquipmentRecord[]>(`/equipment/projects/${id}`),
      apiGet<ProjectCost>(`/project/projects/${id}/cost`),
    ]);
  const laborByEmployee = new Map(labor.lines.map((line) => [line.employeeId, line]));
  const consumptionTotalMad = consumption.reduce((sum, row) => sum + row.totalCostMad, 0);
  const assignedIds = new Set(team.membres.filter((m) => m.actif).map((m) => m.employeeId));
  const assignable = employees.filter((e) => e.status === 'actif' && !assignedIds.has(e.id));

  async function createSituation(formData: FormData) {
    'use server';
    const montant = Number(formData.get('montantCumuleMad'));
    const periodEnd = String(formData.get('periodEnd'));
    if (!(Number.isFinite(montant) && montant >= 0 && periodEnd)) {
      redirect(`/projects/${id}?tab=ressources&error=createSituation&code=invalid`);
    }
    try {
      await apiPost(`/project/projects/${id}/situations`, {
        periodEnd,
        montantCumuleMad: montant,
      });
    } catch (error) {
      failTo(id, 'ressources', 'createSituation', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function transitionSituation(formData: FormData) {
    'use server';
    try {
      await apiPost(`/project/situations/${String(formData.get('sid'))}/transition`, {
        to: String(formData.get('to')),
      });
    } catch (error) {
      failTo(id, 'ressources', 'transitionSituation', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function assignEmployee(formData: FormData) {
    'use server';
    const employeeId = String(formData.get('employeeId'));
    const startDate = String(formData.get('startDate'));
    if (!employeeId || !startDate) {
      redirect(`/projects/${id}?tab=ressources&error=assignEmployee&code=invalid`);
    }
    const rateType = String(formData.get('rateType') ?? '');
    const rateRaw = String(formData.get('rateAmountMad') ?? '').trim();
    const rateAmountMad = rateRaw ? Number(rateRaw) : undefined;
    if ((rateType && rateAmountMad === undefined) || (rateAmountMad !== undefined && !rateType)) {
      redirect(`/projects/${id}?tab=ressources&error=assignEmployee&code=invalid`);
    }
    try {
      await apiPost(`/people/employees/${employeeId}/assign`, {
        projectId: id,
        startDate,
        ...(rateType && rateAmountMad !== undefined ? { rateType, rateAmountMad } : {}),
      });
    } catch (error) {
      failTo(id, 'ressources', 'assignEmployee', error);
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
      redirect(`/projects/${id}?tab=ressources&error=logWorkDay&code=invalid`);
    }
    try {
      const notes = String(formData.get('notes') ?? '').trim();
      await apiPost(`/people/assignments/${assignmentId}/workdays`, {
        workDate,
        daysWorked,
        notes: notes || undefined,
      });
    } catch (error) {
      failTo(id, 'ressources', 'logWorkDay', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function endAssignment(formData: FormData) {
    'use server';
    try {
      await apiPost(`/people/assignments/${String(formData.get('aid'))}/end`);
    } catch (error) {
      failTo(id, 'ressources', 'endAssignment', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function createTask(formData: FormData) {
    'use server';
    const label = String(formData.get('label') ?? '').trim();
    if (label.length < 3) {
      redirect(`/projects/${id}?tab=ressources&error=createTask&code=invalid`);
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
      failTo(id, 'ressources', 'createTask', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  async function updateTask(formData: FormData) {
    'use server';
    const taskId = String(formData.get('taskId') ?? '');
    const progress = Number(formData.get('progressPct'));
    const status = String(formData.get('status') ?? '') as TaskStatus;
    if (!taskId || !Number.isFinite(progress) || progress < 0 || progress > 100) {
      redirect(`/projects/${id}?tab=ressources&error=updateTask&code=invalid`);
    }
    try {
      await apiPatch(`/project/projects/${id}/tasks/${taskId}`, { progressPct: progress, status });
    } catch (error) {
      failTo(id, 'ressources', 'updateTask', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  return (
    <div>
      <FinancialSummarySection project={project} cost={cost} />
      <SituationsSection project={project} transitionSituation={transitionSituation} />
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
      <ConsumptionSection consumption={consumption} consumptionTotalMad={consumptionTotalMad} />
      <EquipmentSection projectEquipment={projectEquipment} />
      {project.status === 'en_cours' && <NewSituationSection createSituation={createSituation} />}
    </div>
  );
}

export async function JournalTab({ project: btpProject }: { project: BtpProjectDetail }) {
  const id = btpProject.id;
  const [project, journal] = await Promise.all([
    apiGet<ProjectDetail>(`/project/projects/${id}`),
    apiGet<JournalResponse>(`/field/projects/${id}/logs`),
  ]);

  async function createDailyLog(formData: FormData) {
    'use server';
    const effectifs = Number(formData.get('effectifs'));
    const travaux = String(formData.get('travauxRealises') ?? '');
    const reportDate = String(formData.get('reportDate'));
    if (
      !(Number.isInteger(effectifs) && effectifs >= 0 && travaux.trim().length >= 10 && reportDate)
    ) {
      redirect(`/projects/${id}?tab=journal&error=createDailyLog&code=invalid`);
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
      failTo(id, 'journal', 'createDailyLog', error);
    }
    revalidatePath(`/projects/${id}`);
  }

  return <JournalSection project={project} journal={journal} createDailyLog={createDailyLog} />;
}
