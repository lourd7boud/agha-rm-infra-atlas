/**
 * Main-d'œuvre — pure costing of logged work days against each assignment's pay
 * basis. The tables hold no running total; per-worker dues and the project total
 * are folded here so the same arithmetic backs both the in-memory and Drizzle
 * repositories (recon: one definition, two stores).
 *
 * Pay basis (per SCHEMA_SPEC):
 *   'jour' → rateAmountMad is already a daily rate
 *   'mois' → rateAmountMad is a monthly rate, divided by WORKING_DAYS_PER_MONTH
 *   null / 0 → no rate yet, dues contribute 0 (the row still surfaces)
 */

/**
 * Documented convention: a worked month is billed as 26 days (jours ouvrables),
 * so a monthly rate ÷ 26 yields the effective daily rate.
 */
export const WORKING_DAYS_PER_MONTH = 26;

export type RateType = 'jour' | 'mois';

/** The effective daily rate (MAD) for a pay basis; 0 when no usable rate. */
export function effectiveDailyRate(
  rateType: RateType | null | undefined,
  rateAmountMad: number | null | undefined,
): number {
  if (!rateAmountMad) return 0;
  if (rateType === 'jour') return rateAmountMad;
  if (rateType === 'mois') return rateAmountMad / WORKING_DAYS_PER_MONTH;
  return 0;
}

export interface AssignmentDuesInput {
  rateType?: RateType | null;
  rateAmountMad?: number | null;
  totalDays: number;
}

/** Dues (MAD) for one assignment = totalDays × effective daily rate. */
export function computeAssignmentDues(input: AssignmentDuesInput): number {
  return input.totalDays * effectiveDailyRate(input.rateType, input.rateAmountMad);
}

/** One assignment with its summed pointage, fed to the project rollup. */
export interface AssignmentWithDays {
  employeeId: string;
  fullName: string;
  metier: string;
  rateType?: RateType | null;
  rateAmountMad?: number | null;
  totalDays: number;
}

/** Per-worker line of a project's labour cost. */
export interface ProjectLaborLine {
  employeeId: string;
  fullName: string;
  metier: string;
  rateType?: RateType | null;
  rateAmountMad?: number | null;
  totalDays: number;
  duesMad: number;
}

/** A project's labour cost: per-worker lines plus the grand totals. */
export interface ProjectLabor {
  lines: ProjectLaborLine[];
  totalDays: number;
  totalDuesMad: number;
}

/**
 * Folds each assignment's summed work days into a per-worker dues line and the
 * project grand totals. A missing rate yields 0 dues for that worker but the
 * line is never dropped, so the workforce stays visible even before pay is set.
 */
export function computeProjectLabor(
  assignments: readonly AssignmentWithDays[],
): ProjectLabor {
  const lines: ProjectLaborLine[] = assignments.map((assignment) => ({
    employeeId: assignment.employeeId,
    fullName: assignment.fullName,
    metier: assignment.metier,
    rateType: assignment.rateType,
    rateAmountMad: assignment.rateAmountMad,
    totalDays: assignment.totalDays,
    duesMad: computeAssignmentDues({
      rateType: assignment.rateType,
      rateAmountMad: assignment.rateAmountMad,
      totalDays: assignment.totalDays,
    }),
  }));

  return {
    lines,
    totalDays: lines.reduce((sum, line) => sum + line.totalDays, 0),
    totalDuesMad: lines.reduce((sum, line) => sum + line.duesMad, 0),
  };
}
