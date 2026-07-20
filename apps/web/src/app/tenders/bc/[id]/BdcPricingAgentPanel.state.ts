import type {
  PricingEvidenceSummary,
  PricingRunStatus,
  PricingRunView,
} from '@/lib/bdc';

export interface PricingAgentState {
  run: PricingRunView | null;
  error: string | null;
  expandedLineIdx: number | null;
}

export type PricingAgentAction =
  | { type: 'run_received'; run: PricingRunView }
  | { type: 'failed'; message: string }
  | { type: 'toggle_evidence'; lineIdx: number }
  | { type: 'reset' };

export const initialPricingAgentState: PricingAgentState = {
  run: null,
  error: null,
  expandedLineIdx: null,
};

export function pricingAgentReducer(
  state: PricingAgentState,
  action: PricingAgentAction,
): PricingAgentState {
  if (action.type === 'run_received') {
    return { ...state, run: action.run, error: null };
  }
  if (action.type === 'failed') {
    return { ...state, error: action.message };
  }
  if (action.type === 'toggle_evidence') {
    return {
      ...state,
      expandedLineIdx: state.expandedLineIdx === action.lineIdx ? null : action.lineIdx,
    };
  }
  return initialPricingAgentState;
}

export function pricingPollInterval(status: PricingRunStatus): number | null {
  return status === 'queued' || status === 'running' ? 2_000 : null;
}

export function canApplyPricingRun(
  run: PricingRunView | null,
): run is PricingRunView & { status: 'completed' } {
  return run?.status === 'completed' && run.decisions.length > 0;
}

export function selectLineEvidence(
  run: PricingRunView,
  lineIdx: number,
): PricingEvidenceSummary[] {
  const sourceIds = new Set(
    run.decisions.find((decision) => decision.idx === lineIdx)?.sourceIds ?? [],
  );
  return run.evidence.filter((item) => sourceIds.has(item.id));
}
