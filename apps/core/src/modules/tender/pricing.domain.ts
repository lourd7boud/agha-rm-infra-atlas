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
/** Below this sample size, a learned median is flagged as thin in the brief. */
const CONFIANCE_ECHANTILLON_MIN = 8;

export type PricingScenarioName = 'prudent' | 'equilibre' | 'agressif';
export type StatutReglementaire = 'conforme' | 'proche_seuil_bas';

/**
 * A trusted recovered-rebate distribution for this tender's buyer or segment,
 * selected upstream (intel/rebate-selector) once enough winners are observed.
 * Structurally a subset of SelectedRebate, declared here so the pricing engine
 * carries no dependency on the intel module.
 */
export interface RebateCalibration {
  source: 'buyer' | 'segment' | 'overall';
  /** Matched key for the brief copy (raw buyerName, segment slug, or 'overall'). */
  key: string;
  count: number;
  medianPct: number;
  p25Pct: number;
  p75Pct: number;
}

export interface PricingInput {
  estimationMad: number;
  /** Known active competitors (C1 entity-resolved). Clamped to >= 0. */
  competitorCount: number;
  /** Company cost base as a fraction of the estimation, in (0, 1). */
  costRatio?: number;
  /**
   * Learned winning-rabais distribution for this buyer/segment. When present,
   * it ANCHORS the ladder (p25→prudent, median→equilibre, p75→agressif, each
   * clamped below the legal threshold) instead of the heuristic rabais. Absent
   * (the default until enough results accrue) → today's heuristic ladder.
   */
  rebateBenchmark?: RebateCalibration;
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

  // When a trusted benchmark is present it ANCHORS the rabais ladder to the real
  // winning distribution (clamped legal); otherwise the heuristic ladder runs.
  const calibrated = input.rebateBenchmark;
  const anchoredRabais: Record<PricingScenarioName, number> | null = calibrated
    ? {
        prudent: clampCalibratedRabais(calibrated.p25Pct),
        equilibre: clampCalibratedRabais(calibrated.medianPct),
        agressif: clampCalibratedRabais(calibrated.p75Pct),
      }
    : null;

  const scenarios = LADDER.map((step) => {
    const rabaisPct = anchoredRabais ? anchoredRabais[step.nom] : step.rabaisPct(pressure);
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

  const recommandation = recommend(scenarios);

  return {
    estimationMad: input.estimationMad,
    hypotheses: {
      costRatio,
      concurrentsConnus,
      seuilAnormalementBasPct: SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT,
      methode: calibrated
        ? `Calibré sur les rabais gagnants historiques pour ${tierLabel(calibrated)} ` +
          `(médiane ${calibrated.medianPct}%, p25 ${calibrated.p25Pct}%–p75 ${calibrated.p75Pct}%, ` +
          `N=${calibrated.count}), écrêté sous le seuil d’offre anormalement basse. ` +
          'Probabilités de gain heuristiques (pression concurrentielle C1).'
        : 'Heuristique v1 : probabilités de gain calibrées sur la pression ' +
          'concurrentielle observée par C1 (nombre de concurrents actifs), ' +
          'pas encore sur les distributions historiques de rabais.',
    },
    scenarios,
    recommandation: calibrated
      ? {
          ...recommandation,
          raison: `${recommandation.raison} ${calibrationClause(calibrated)}`,
        }
      : recommandation,
  };
}

/** Clamp a learned rabais anchor into the safe, legal band [0, seuil − marge]. */
function clampCalibratedRabais(anchorPct: number): number {
  const plafond = SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT - MARGE_ALERTE_SEUIL_PCT;
  return round2(Math.min(Math.max(anchorPct, 0), plafond));
}

/** How specific the benchmark is — surfaced so the reviewer knows its altitude. */
function tierLabel(c: RebateCalibration): string {
  if (c.source === 'buyer') return `l’acheteur ${c.key}`;
  if (c.source === 'segment') return `le segment ${c.key}`;
  return 'tous marchés confondus';
}

/** Plain, honest French clause appended to the recommendation when calibrated. */
function calibrationClause(c: RebateCalibration): string {
  const confiance =
    c.count < CONFIANCE_ECHANTILLON_MIN
      ? ` (échantillon limité, N=${c.count})`
      : ` (N=${c.count})`;
  return (
    `Rabais gagnant historique pour ${tierLabel(c)} : médiane ${c.medianPct}% ` +
    `(p25 ${c.p25Pct}%–p75 ${c.p75Pct}%)${confiance} — à égaler ou creuser, non garanti.`
  );
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
