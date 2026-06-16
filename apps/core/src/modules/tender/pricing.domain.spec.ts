import { describe, expect, test } from 'vitest';
import {
  buildPricingScenarios,
  DEFAULT_COST_RATIO,
  SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT,
} from './pricing.domain';

const ESTIMATION = 10_000_000;

describe('buildPricingScenarios', () => {
  test('produces the three-scenario ladder with correct arithmetic', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 0,
    });

    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios.map((s) => s.nom)).toEqual([
      'prudent',
      'equilibre',
      'agressif',
    ]);

    const prudent = result.scenarios[0]!;
    expect(prudent.rabaisPct).toBe(5);
    expect(prudent.prixMad).toBe(9_500_000);
    // marge = prix - estimation * costRatio, rounded to centimes
    const expectedMarge =
      Math.round((9_500_000 - ESTIMATION * DEFAULT_COST_RATIO) * 100) / 100;
    expect(prudent.margeMad).toBe(expectedMarge);
    expect(prudent.esperanceMad).toBe(
      Math.round(prudent.margeMad * prudent.probabiliteGain),
    );
  });

  test('no known competitors → prudent scenario wins on expected value', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 0,
    });
    expect(result.recommandation.nom).toBe('prudent');
  });

  test('heavy competition shifts the recommendation to equilibre', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 8,
    });
    expect(result.recommandation.nom).toBe('equilibre');
  });

  test('competitive pressure deepens the aggressive rabais and flags the threshold', () => {
    const calm = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 0,
    });
    const crowded = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 8,
    });

    const calmAggressive = calm.scenarios[2]!;
    const crowdedAggressive = crowded.scenarios[2]!;
    expect(calmAggressive.rabaisPct).toBe(18);
    expect(calmAggressive.statutReglementaire).toBe('conforme');
    expect(crowdedAggressive.rabaisPct).toBe(22);
    expect(crowdedAggressive.statutReglementaire).toBe('proche_seuil_bas');
    expect(crowdedAggressive.rabaisPct).toBeLessThan(
      SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT,
    );
  });

  test('negative-margin scenarios are excluded from the recommendation', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 0,
    });
    const aggressive = result.scenarios[2]!;
    // default costRatio 0.82 → 18% rabais prices at 0.82×E exactly → marge 0
    expect(aggressive.margeMad).toBeLessThanOrEqual(0);
    expect(result.recommandation.nom).not.toBe('agressif');
    expect(aggressive.commentaire.toLowerCase()).toContain('marge');
  });

  test('all scenarios unprofitable → recommends none and says why', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 3,
      costRatio: 0.97,
    });
    expect(result.recommandation.nom).toBe('aucun');
    expect(result.recommandation.raison.toLowerCase()).toContain('rentable');
  });

  test('records its hypotheses for the G2 reviewer', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 4,
    });
    expect(result.hypotheses.costRatio).toBe(DEFAULT_COST_RATIO);
    expect(result.hypotheses.concurrentsConnus).toBe(4);
    expect(result.hypotheses.methode.length).toBeGreaterThan(20);
  });

  test('rejects invalid inputs', () => {
    expect(() =>
      buildPricingScenarios({ estimationMad: 0, competitorCount: 0 }),
    ).toThrow(/estimation/i);
    expect(() =>
      buildPricingScenarios({
        estimationMad: ESTIMATION,
        competitorCount: 0,
        costRatio: 1.2,
      }),
    ).toThrow(/costRatio/i);
  });

  test('rounds money to centimes', () => {
    const result = buildPricingScenarios({
      estimationMad: 1_234_567.89,
      competitorCount: 1,
    });
    for (const scenario of result.scenarios) {
      expect(scenario.prixMad).toBe(Math.round(scenario.prixMad * 100) / 100);
      expect(scenario.margeMad).toBe(Math.round(scenario.margeMad * 100) / 100);
    }
  });
});

describe('buildPricingScenarios with rebate calibration', () => {
  test('without a benchmark, the ladder and methode stay heuristic', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 4,
    });
    // The four legacy tests above already pin the exact heuristic values; here
    // we only assert the calibrated path did not leak in when no benchmark.
    expect(result.scenarios.map((s) => s.rabaisPct)).toEqual([5, 12, 20]);
    expect(result.hypotheses.methode.toLowerCase()).toContain('heuristique');
    expect(result.recommandation.raison).not.toContain('historique');
  });

  test('a trusted benchmark anchors the ladder to p25/median/p75 (pressure-independent)', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 3,
      rebateBenchmark: {
        source: 'buyer',
        key: 'ONEE',
        count: 6,
        medianPct: 14,
        p25Pct: 8,
        p75Pct: 21,
      },
    });
    expect(result.scenarios.map((s) => s.rabaisPct)).toEqual([8, 14, 21]);
    expect(result.scenarios[2]!.rabaisPct).toBeLessThan(
      SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT,
    );
    expect(result.hypotheses.methode).toContain('N=6');
    expect(result.hypotheses.methode.toLowerCase()).toContain('calibr');
  });

  test('a deep historical rebate is clamped below the legal threshold and flagged', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 0,
      rebateBenchmark: {
        source: 'segment',
        key: 'eau_potable',
        count: 10,
        medianPct: 30,
        p25Pct: 20,
        p75Pct: 40,
      },
    });
    const aggressive = result.scenarios[2]!;
    expect(aggressive.rabaisPct).toBe(22); // p75 40 → clamped to seuil − marge
    expect(aggressive.rabaisPct).toBeLessThan(SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT);
    expect(aggressive.statutReglementaire).toBe('proche_seuil_bas');
    expect(result.scenarios[1]!.rabaisPct).toBe(22); // median 30 → clamped
    expect(result.scenarios[0]!.rabaisPct).toBe(20); // p25 20 within band
  });

  test('a non-positive learned rebate floors at zero', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 0,
      rebateBenchmark: {
        source: 'overall',
        key: 'overall',
        count: 6,
        medianPct: -5,
        p25Pct: -10,
        p75Pct: 3,
      },
    });
    expect(result.scenarios.map((s) => s.rabaisPct)).toEqual([0, 0, 3]);
  });

  test('the recommendation cites the historical rabais, framed as not guaranteed', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 2,
      rebateBenchmark: {
        source: 'buyer',
        key: 'ORMVAH',
        count: 12,
        medianPct: 11,
        p25Pct: 7,
        p75Pct: 16,
      },
    });
    expect(result.recommandation.raison).toContain('historique');
    expect(result.recommandation.raison).toContain('ORMVAH');
    expect(result.recommandation.raison).toContain('11%');
    expect(result.recommandation.raison).toContain('N=12');
    expect(result.recommandation.raison).not.toContain('limité');
  });

  test('a thin sample is flagged as low-confidence in the brief', () => {
    const result = buildPricingScenarios({
      estimationMad: ESTIMATION,
      competitorCount: 2,
      rebateBenchmark: {
        source: 'segment',
        key: 'routes',
        count: 5,
        medianPct: 10,
        p25Pct: 6,
        p75Pct: 15,
      },
    });
    expect(result.recommandation.raison.toLowerCase()).toContain('limité');
    expect(result.recommandation.raison).toContain('le segment routes');
  });
});
