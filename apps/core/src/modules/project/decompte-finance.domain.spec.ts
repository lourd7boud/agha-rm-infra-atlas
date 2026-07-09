import { describe, expect, test } from 'vitest';
import {
  computeDecompteTotals,
  computeRecap,
} from './decompte-finance.domain';

describe('computeDecompteTotals', () => {
  test('montant HT = quantité × prix; TTC uses ROUND, TVA uses TRUNC', () => {
    // Arrange
    const lignes = [{ quantiteRealisee: 2.7, prixUnitaireHT: 690 }];

    // Act
    const r = computeDecompteTotals(lignes, 20);

    // Assert
    expect(r.lignes[0]?.montantHT).toBe(1863);
    expect(r.totalHtMad).toBe(1863);
    expect(r.montantTvaMad).toBe(372.6); // TRUNC(372.6, 2)
    expect(r.totalTtcMad).toBe(2235.6); // ROUND(1863 + 372.60, 2)
  });

  test('TVA is truncated (ROUND_DOWN), not rounded', () => {
    // 100.13 × 0.20 = 20.026 → TRUNC = 20.02 (a ROUND would give 20.03)
    const r = computeDecompteTotals([{ quantiteRealisee: 1, prixUnitaireHT: 100.13 }], 20);
    expect(r.montantTvaMad).toBe(20.02);
    expect(r.totalTtcMad).toBe(120.15); // ROUND(100.13 + 20.02)
  });

  test('sums the internal (unrounded) montants before rounding the total', () => {
    const r = computeDecompteTotals(
      [
        { quantiteRealisee: 1, prixUnitaireHT: 0.005 },
        { quantiteRealisee: 1, prixUnitaireHT: 0.005 },
      ],
      20,
    );
    // each line rounds to 0.01 for display, but the total is ROUND(0.01) = 0.01
    expect(r.totalHtMad).toBe(0.01);
  });

  test('empty décompte yields zeros', () => {
    const r = computeDecompteTotals([], 20);
    expect(r).toMatchObject({ totalHtMad: 0, montantTvaMad: 0, totalTtcMad: 0 });
  });
});

describe('computeRecap', () => {
  test('retenue de garantie and acompte, no previous', () => {
    const r = computeRecap({
      totalTtcMad: 2235.6,
      tauxRetenue: 10,
      decomptesPrecedents: 0,
      depensesExercicesAnterieurs: 0,
    });
    expect(r.retenueGarantieMad).toBe(223.56);
    expect(r.montantActuelMad).toBe(2235.6);
    expect(r.netAPayerMad).toBe(2012.04); // 2235.60 − 223.56
  });

  test('subtracts previous décomptes from the acompte', () => {
    const r = computeRecap({
      totalTtcMad: 1000,
      tauxRetenue: 10,
      decomptesPrecedents: 300,
      depensesExercicesAnterieurs: 0,
    });
    expect(r.retenueGarantieMad).toBe(100);
    expect(r.montantActuelMad).toBe(700); // 1000 − 300
    expect(r.netAPayerMad).toBe(600); // (1000 − 100) − 300
  });
});
