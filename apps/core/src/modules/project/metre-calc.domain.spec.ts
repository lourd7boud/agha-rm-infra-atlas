import { describe, expect, test } from 'vitest';
import {
  calculatePartiel,
  computeMetreTotals,
  getPoidsUnitaire,
} from './metre-calc.domain';

describe('calculatePartiel', () => {
  test('M³ = longueur × largeur × profondeur', () => {
    expect(calculatePartiel('M³', { longueur: 2, largeur: 3, profondeur: 4 })).toBe(24);
  });

  test('nombreSemblables multiplies the result', () => {
    expect(
      calculatePartiel('M³', { longueur: 2, largeur: 3, profondeur: 4, nombreSemblables: 2 }),
    ).toBe(48);
  });

  test('M² = longueur × largeur', () => {
    expect(calculatePartiel('M²', { longueur: 5, largeur: 2 })).toBe(10);
  });

  test('ML = longueur', () => {
    expect(calculatePartiel('ML', { longueur: 7 })).toBe(7);
  });

  test('U = nombre', () => {
    expect(calculatePartiel('U', { nombre: 5 })).toBe(5);
  });

  test('KG (ferraillage) = nombre × longueur × poids unitaire(Ø)', () => {
    // Ø12 = 0.888 kg/ml → 10 × 12 × 0.888
    expect(getPoidsUnitaire(12)).toBe(0.888);
    expect(calculatePartiel('KG', { nombre: 10, longueur: 12, diametre: 12 })).toBeCloseTo(
      106.56,
      6,
    );
  });

  test('T = KG ÷ 1000', () => {
    expect(calculatePartiel('T', { nombre: 10, longueur: 12, diametre: 12 })).toBeCloseTo(
      0.10656,
      8,
    );
  });
});

describe('computeMetreTotals', () => {
  test('totalPartiel rounds Σ partiels; totalCumule adds cumulPrecedent; pourcentage', () => {
    const t = computeMetreTotals([10.001, 20.002], 5, 100);
    expect(t.totalPartiel).toBe(30); // ROUND(30.003, 2)
    expect(t.totalCumule).toBe(35); // 5 + 30
    expect(t.pourcentage).toBe(35); // 35 / 100 × 100
  });

  test('pourcentage is 0 when quantité bordereau is 0', () => {
    expect(computeMetreTotals([10], 0, 0).pourcentage).toBe(0);
  });
});
