import { describe, expect, test } from 'vitest';
import {
  buildDecompte,
  PLAFOND_RETENUE_PCT,
  TAUX_RETENUE_PCT,
} from './decompte.domain';

const MARCHE = 5_000_000;

describe('buildDecompte', () => {
  test('first situation: period equals cumulative, 10% retenue withheld', () => {
    const d = buildDecompte({
      montantMarcheMad: MARCHE,
      montantCumuleMad: 1_000_000,
      previousCumuleMad: 0,
      previousRetenueCumuleMad: 0,
    });

    expect(d.montantPeriodeMad).toBe(1_000_000);
    expect(d.retenueGarantieMad).toBe(100_000); // 10% of the period
    expect(d.netAPayerMad).toBe(900_000);
    expect(d.avancementPct).toBe(20);
  });

  test('retenue stops at the 7% ceiling of the marché', () => {
    // ceiling = 350 000; already withheld 300 000 → only 50 000 more
    const d = buildDecompte({
      montantMarcheMad: MARCHE,
      montantCumuleMad: 4_000_000,
      previousCumuleMad: 3_000_000,
      previousRetenueCumuleMad: 300_000,
    });

    expect(d.montantPeriodeMad).toBe(1_000_000);
    expect(d.retenueGarantieMad).toBe(50_000);
    expect(d.netAPayerMad).toBe(950_000);
  });

  test('rejects a regression of the cumulative amount', () => {
    expect(() =>
      buildDecompte({
        montantMarcheMad: MARCHE,
        montantCumuleMad: 900_000,
        previousCumuleMad: 1_000_000,
        previousRetenueCumuleMad: 100_000,
      }),
    ).toThrow(/cumul/i);
  });

  test('rejects exceeding the contract amount', () => {
    expect(() =>
      buildDecompte({
        montantMarcheMad: MARCHE,
        montantCumuleMad: 5_000_001,
        previousCumuleMad: 4_000_000,
        previousRetenueCumuleMad: 350_000,
      }),
    ).toThrow(/marché|marche/i);
  });

  test('completion reaches 100% with total retenue at the ceiling', () => {
    const d = buildDecompte({
      montantMarcheMad: MARCHE,
      montantCumuleMad: MARCHE,
      previousCumuleMad: 4_000_000,
      previousRetenueCumuleMad: 350_000,
    });

    expect(d.avancementPct).toBe(100);
    expect(d.retenueGarantieMad).toBe(0); // ceiling already reached
    expect(d.netAPayerMad).toBe(1_000_000);
  });

  test('constants match CCAG-T recorded assumptions', () => {
    expect(TAUX_RETENUE_PCT).toBe(10);
    expect(PLAFOND_RETENUE_PCT).toBe(7);
  });
});
