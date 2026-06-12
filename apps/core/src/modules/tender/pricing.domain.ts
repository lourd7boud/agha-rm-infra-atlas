/**
 * Financial Modeler (B4) — deterministic pricing-scenario engine for gate G2.
 *
 * Moroccan public works are won on the rabais (discount vs the buyer's
 * estimation administrative). The engine prices a three-step ladder and
 * scores each step with a heuristic win probability that reacts to the
 * competitive pressure observed by the Result Miner (C1).
 *
 * RECORDED ASSUMPTIONS (v1 — every figure is surfaced in `hypotheses` so the
 * G2 reviewer sees them; replace with real accounting data when available):
 * - cost base ≈ 82% of the estimation (direct + indirect costs)
 * - offre anormalement basse threshold: rabais > 25% (décret 2-22-431,
 *   travaux — verify the exact article before a real G2)
 * - win probabilities are heuristic: C1 currently records winner amounts but
 *   not the historical estimations, so true rabais distributions are not yet
 *   computable.
 */

export const DEFAULT_COST_RATIO = 0.82;
export const SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT = 25;
/** Within this many points of the threshold → flag for written justification. */
const MARGE_ALERTE_SEUIL_PCT = 3;
/** Competitor count at which competitive pressure saturates. */
const PRESSION_SATURATION = 8;

export type PricingScenarioName = 'prudent' | 'equilibre' | 'agressif';
export type StatutReglementaire = 'conforme' | 'proche_seuil_bas';

export interface PricingInput {
  estimationMad: number;
  /** Known active competitors (C1 entity-resolved). Clamped to >= 0. */
  competitorCount: number;
  /** Company cost base as a fraction of the estimation, in (0, 1). */
  costRatio?: number;
}

export interface PricingScenario {
  nom: PricingScenarioName;
  rabaisPct: number;
  prixMad: number;
  margeMad: number;
  margePct: number;
  probabiliteGain: number;
  /** Expected value: margeMad × probabiliteGain, rounded to the dirham. */
  esperanceMad: number;
  statutReglementaire: StatutReglementaire;
  commentaire: string;
}

export interface PricingScenarios {
  estimationMad: number;
  hypotheses: {
    costRatio: number;
    concurrentsConnus: number;
    seuilAnormalementBasPct: number;
    methode: string;
  };
  scenarios: PricingScenario[];
  recommandation: { nom: PricingScenarioName | 'aucun'; raison: string };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

interface LadderStep {
  nom: PricingScenarioName;
  rabaisPct: (pressure: number) => number;
  probabiliteGain: (pressure: number) => number;
}

/**
 * The ladder. Pressure ∈ [0, 1] (0 = no known competitor, 1 = saturated):
 * conservative bids lose the most win probability as pressure rises, and the
 * aggressive rabais deepens from 18% to 22% — never past the legal threshold.
 */
const LADDER: readonly LadderStep[] = [
  {
    nom: 'prudent',
    rabaisPct: () => 5,
    probabiliteGain: (p) => 0.3 * (1 - 0.7 * p),
  },
  {
    nom: 'equilibre',
    rabaisPct: () => 12,
    probabiliteGain: (p) => 0.45 * (1 - 0.4 * p),
  },
  {
    nom: 'agressif',
    rabaisPct: (p) => 18 + Math.round(4 * p),
    probabiliteGain: (p) => 0.55 * (1 - 0.15 * p),
  },
];

export function buildPricingScenarios(input: PricingInput): PricingScenarios {
  if (!Number.isFinite(input.estimationMad) || input.estimationMad <= 0) {
    throw new Error('estimationMad invalide — estimation administrative requise');
  }
  const costRatio = input.costRatio ?? DEFAULT_COST_RATIO;
  if (!Number.isFinite(costRatio) || costRatio <= 0 || costRatio >= 1) {
    throw new Error('costRatio doit être strictement entre 0 et 1');
  }

  const concurrentsConnus = Math.max(0, Math.floor(input.competitorCount));
  const pressure = Math.min(concurrentsConnus, PRESSION_SATURATION) / PRESSION_SATURATION;
  const coutMad = input.estimationMad * costRatio;

  const scenarios = LADDER.map((step) => {
    const rabaisPct = step.rabaisPct(pressure);
    const prixMad = round2(input.estimationMad * (1 - rabaisPct / 100));
    const margeMad = round2(prixMad - coutMad);
    const probabiliteGain = round3(step.probabiliteGain(pressure));
    const statutReglementaire: StatutReglementaire =
      rabaisPct >= SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT - MARGE_ALERTE_SEUIL_PCT
        ? 'proche_seuil_bas'
        : 'conforme';
    return {
      nom: step.nom,
      rabaisPct,
      prixMad,
      margeMad,
      margePct: prixMad > 0 ? round3(margeMad / prixMad) : 0,
      probabiliteGain,
      esperanceMad: Math.round(margeMad * probabiliteGain),
      statutReglementaire,
      commentaire: buildCommentaire(margeMad, statutReglementaire),
    };
  });

  return {
    estimationMad: input.estimationMad,
    hypotheses: {
      costRatio,
      concurrentsConnus,
      seuilAnormalementBasPct: SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT,
      methode:
        'Heuristique v1 : probabilités de gain calibrées sur la pression ' +
        'concurrentielle observée par C1 (nombre de concurrents actifs), ' +
        'pas encore sur les distributions historiques de rabais.',
    },
    scenarios,
    recommandation: recommend(scenarios),
  };
}

function buildCommentaire(
  margeMad: number,
  statut: StatutReglementaire,
): string {
  const parts: string[] = [];
  if (margeMad <= 0) {
    parts.push(
      'Marge nulle ou négative au ratio de coût retenu — ' +
        "à n'envisager qu'après optimisation réelle des coûts",
    );
  }
  if (statut === 'proche_seuil_bas') {
    parts.push(
      'Rabais proche du seuil d’offre anormalement basse — ' +
        'préparer la justification écrite des prix',
    );
  }
  return parts.join(' ; ') || 'Scénario conforme au ratio de coût retenu';
}

function recommend(
  scenarios: PricingScenario[],
): PricingScenarios['recommandation'] {
  const profitable = scenarios.filter((s) => s.margeMad > 0);
  if (profitable.length === 0) {
    return {
      nom: 'aucun',
      raison:
        'Aucun scénario rentable au ratio de coût retenu — revoir les coûts, ' +
        'négocier les fournisseurs, ou reconsidérer le Go en G1.',
    };
  }
  const best = profitable.reduce((acc, s) =>
    s.esperanceMad > acc.esperanceMad ? s : acc,
  );
  return {
    nom: best.nom,
    raison:
      `Meilleure espérance de marge (${best.esperanceMad.toLocaleString('fr-MA')} MAD) ` +
      `au rabais de ${best.rabaisPct}% avec une probabilité de gain estimée à ` +
      `${Math.round(best.probabiliteGain * 100)}%.`,
  };
}
