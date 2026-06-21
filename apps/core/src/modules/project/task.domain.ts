/**
 * Tâches de chantier — pure physical-progress arithmetic.
 *
 * This is the PHYSICAL avancement of a chantier (work breakdown), kept
 * deliberately SEPARATE from the situation-based financial avancement in
 * decompte.domain. Nothing here reads or overrides that financial logic.
 */

export type TaskStatus = 'a_faire' | 'en_cours' | 'termine' | 'bloque';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'a_faire',
  'en_cours',
  'termine',
  'bloque',
];

export interface TaskProgress {
  progressPct: number;
  status: TaskStatus;
}

export interface TaskStatusSummary {
  a_faire: number;
  en_cours: number;
  termine: number;
  bloque: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Physical avancement of a chantier: the simple average of per-task progress.
 * Empty list → 0 (nothing planned yet, nothing done).
 */
export function computeProjectPhysicalProgress(
  tasks: readonly TaskProgress[],
): number {
  if (tasks.length === 0) return 0;
  const total = tasks.reduce((sum, t) => sum + t.progressPct, 0);
  return round2(total / tasks.length);
}

/** Count of tasks in each status — drives the chantier's task dashboard. */
export function summarizeTaskStatuses(
  tasks: readonly TaskProgress[],
): TaskStatusSummary {
  const summary: TaskStatusSummary = {
    a_faire: 0,
    en_cours: 0,
    termine: 0,
    bloque: 0,
  };
  for (const task of tasks) {
    summary[task.status] += 1;
  }
  return summary;
}

export interface TaskPatch {
  label?: string;
  description?: string;
  progressPct?: number;
  status?: TaskStatus;
  startDate?: Date;
  dueDate?: Date;
  orderIndex?: number;
}

/**
 * Keep status and progress consistent so both repository implementations agree:
 * - status 'termine'  → progress is forced to 100
 * - status 'a_faire'  → progress is forced to 0
 * Other statuses leave progress as supplied. Applied on create and on update.
 */
export function normalizeTaskPatch(patch: Readonly<TaskPatch>): TaskPatch {
  if (patch.status === 'termine') {
    return { ...patch, progressPct: 100 };
  }
  if (patch.status === 'a_faire') {
    return { ...patch, progressPct: 0 };
  }
  return { ...patch };
}
