import type {
  PipelineState,
  PriceScenario,
  SubmissionOutcomeInput,
  SubmissionResult,
} from '@atlas/contracts';

/**
 * Submission outcome — Phase 0 "socle de vérité".
 *
 * Pure derivation of the reward signal. The two founding metrics live here:
 *  - recoveredRebatePct: (estimation − winner)/estimation — the join the whole
 *    pricing calibration depends on, today never computed.
 *  - gapToFirstPct: how far above the winner our offer landed.
 *
 * No I/O, no Date.now(): `now` is injected so the result is deterministic.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The founding metric: real winning rebate vs. the administrative estimation. */
export function recoveredRebatePct(
  estimationMad: number | undefined,
  winnerAmountMad: number | undefined,
): number | null {
  if (estimationMad === undefined || estimationMad <= 0) return null;
  if (winnerAmountMad === undefined) return null;
  return round2(((estimationMad - winnerAmountMad) / estimationMad) * 100);
}

/** How far above the winner our offer sat (0 when we are the winner). */
export function gapToFirstPct(
  ourAmountMad: number | undefined,
  winnerAmountMad: number | undefined,
): number | null {
  if (ourAmountMad === undefined || winnerAmountMad === undefined) return null;
  if (winnerAmountMad <= 0) return null;
  return round2(((ourAmountMad - winnerAmountMad) / winnerAmountMad) * 100);
}

/** Where a recorded result lands the tender in the pipeline. */
export function pipelineStateForResult(result: SubmissionResult): PipelineState {
  // écarté (offre rejetée administrativement) means we did not win → lost.
  return result === 'won' ? 'won' : 'lost';
}

export interface DerivedOutcome {
  result: SubmissionResult;
  montantSoumisMad?: number;
  rabaisRetenuPct?: number;
  scenarioChoisi?: PriceScenario;
  ourRank?: number;
  winnerAmountMad?: number;
  gapToFirstPct: number | null;
  motifRejet?: string;
  lessons?: string[];
  decidedAt: Date;
}

/**
 * Normalize a raw debrief into a coherent outcome record. Keeps the input's
 * facts but enforces the obvious invariants so the learning data stays clean:
 *  - won ⇒ we are the winner (rank 1, winner amount = our amount, gap 0);
 *  - lost ⇒ gap to first computed when both amounts are known;
 *  - écarté ⇒ no rank/winner assumed (administrative rejection).
 */
export function deriveOutcome(
  input: SubmissionOutcomeInput,
  now: Date,
): DerivedOutcome {
  const base: DerivedOutcome = {
    result: input.result,
    montantSoumisMad: input.montantSoumisMad,
    rabaisRetenuPct: input.rabaisRetenuPct,
    scenarioChoisi: input.scenarioChoisi,
    ourRank: input.ourRank,
    winnerAmountMad: input.winnerAmountMad,
    gapToFirstPct: null,
    motifRejet: input.motifRejet,
    lessons: input.lessons,
    decidedAt: input.decidedAt ?? now,
  };

  if (input.result === 'won') {
    const winner = input.winnerAmountMad ?? input.montantSoumisMad;
    return { ...base, ourRank: 1, winnerAmountMad: winner, gapToFirstPct: 0 };
  }

  if (input.result === 'lost') {
    return {
      ...base,
      gapToFirstPct: gapToFirstPct(input.montantSoumisMad, input.winnerAmountMad),
    };
  }

  // écarté: administrative rejection — rank/winner are not assumed.
  return base;
}
