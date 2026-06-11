import type { PipelineState } from '@atlas/contracts';
import { addDays, daysUntil } from '../../lib/dates';

// Pipeline state machine (tender-lifecycle §2; division-design §3).
const TRANSITIONS: Record<PipelineState, readonly PipelineState[]> = {
  detected: ['parsed', 'cancelled'],
  parsed: ['qualified', 'rejected', 'cancelled'],
  qualified: ['go_decided', 'no_go', 'cancelled'],
  rejected: ['qualified', 'cancelled'], // human override at gate G0
  go_decided: ['preparing', 'no_go', 'cancelled'],
  no_go: ['go_decided', 'cancelled'], // reversible while the deadline allows
  preparing: ['submitted', 'no_go', 'cancelled'],
  submitted: ['opened', 'cancelled'],
  opened: ['won', 'lost', 'cancelled'],
  won: [],
  lost: [],
  cancelled: [],
};

export class TransitionError extends Error {
  constructor(
    readonly from: PipelineState,
    readonly to: PipelineState,
  ) {
    super(`Illegal pipeline transition: ${from} -> ${to}`);
    this.name = 'TransitionError';
  }
}

export function canTransition(from: PipelineState, to: PipelineState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: PipelineState, to: PipelineState): PipelineState {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
  return to;
}

// Back-planning (tender-lifecycle §2): milestones in days before the deadline.
interface MilestoneTemplate {
  code: string;
  label: string;
  daysBefore: number;
}

const STANDARD_MILESTONES: readonly MilestoneTemplate[] = [
  { code: 'go_decision', label: 'Décision Go/No-Go (G1)', daysBefore: 18 },
  { code: 'mobilization', label: 'Caution provisoire + visite des lieux', daysBefore: 17 },
  { code: 'costing', label: 'Étude de prix — baseline', daysBefore: 14 },
  { code: 'technical_draft', label: 'Mémoire technique v1', daysBefore: 10 },
  { code: 'dossier_assembly', label: 'Assemblage du dossier complet', daysBefore: 7 },
  { code: 'price_approval', label: 'Validation du prix final (G2)', daysBefore: 3 },
  { code: 'final_audit', label: 'Audit de conformité final', daysBefore: 2 },
  { code: 'submission', label: 'Soumission électronique PMMP (G3)', daysBefore: 1 },
];

const STANDARD_RUNWAY_DAYS = 21;
const MIN_RUNWAY_DAYS = 3;

export interface PlanMilestone {
  code: string;
  label: string;
  dueAt: Date;
}

export interface BackPlan {
  feasible: boolean;
  compressed: boolean;
  daysAvailable: number;
  milestones: readonly PlanMilestone[];
}

/** Builds the J-X preparation plan working back from the submission deadline. */
export function buildBackPlan(deadlineAt: Date, today: Date): BackPlan {
  const daysAvailable = daysUntil(deadlineAt, today);
  if (daysAvailable < MIN_RUNWAY_DAYS) {
    return { feasible: false, compressed: true, daysAvailable, milestones: [] };
  }

  const scale = Math.min(1, daysAvailable / STANDARD_RUNWAY_DAYS);
  const milestones = STANDARD_MILESTONES.map(({ code, label, daysBefore }) => ({
    code,
    label,
    dueAt: addDays(deadlineAt, -Math.max(1, Math.round(daysBefore * scale))),
  }));

  return { feasible: true, compressed: scale < 1, daysAvailable, milestones };
}
