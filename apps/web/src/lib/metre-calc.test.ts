import { describe, expect, it } from 'vitest';
import {
  calculatePartiel,
  isKnownUnite,
  normalizeUnite,
  round2,
} from './metre-calc';

describe('calculatePartiel', () => {
  it('volume (M³) = L × l × P × Nbre', () => {
    expect(calculatePartiel('M³', { longueur: 2, largeur: 3, profondeur: 4 })).toBe(24);
    expect(
      calculatePartiel('M³', { longueur: 2, largeur: 3, profondeur: 4, nombreSemblables: 2 }),
    ).toBe(48);
  });

  it('surface (M²) = L × l; linéaire (ML/M) = L', () => {
    expect(calculatePartiel('M²', { longueur: 5, largeur: 2 })).toBe(10);
    expect(calculatePartiel('ML', { longueur: 7 })).toBe(7);
    expect(calculatePartiel('M', { longueur: 7 })).toBe(7);
  });

  it('poids: KG = nombre × longueur × POIDS_ACIER[Ø]; T = /1000', () => {
    // Ø12 = 0.888 kg/ml → 10 bars × 6 m × 0.888 = 53.28 kg
    expect(calculatePartiel('KG', { nombre: 10, longueur: 6, diametre: 12 })).toBeCloseTo(53.28, 5);
    expect(calculatePartiel('T', { nombre: 10, longueur: 6, diametre: 12 })).toBeCloseTo(0.05328, 6);
  });

  it('missing Ø on ferraillage yields 0 (would be flagged before save)', () => {
    expect(calculatePartiel('KG', { nombre: 100, longueur: 12 })).toBe(0);
  });

  it('unité/ensemble = nombre', () => {
    expect(calculatePartiel('U', { nombre: 3 })).toBe(3);
    expect(calculatePartiel('ENS', { nombre: 1 })).toBe(1);
  });
});

describe('round2 (server ROUND_HALF_UP mirror)', () => {
  it('rounds exact x.xx5 midpoints UP like decimal.js (not down)', () => {
    // The old Number.EPSILON nudge rounded these DOWN (2.17, 4.22, 2.17).
    expect(round2(2.175)).toBe(2.18);
    expect(round2(4.225)).toBe(4.23);
    expect(round2(1.5 * 1.45)).toBe(2.18); // 2.175
  });

  it('does not falsely bump genuine x.xx499 values', () => {
    expect(round2(2.1749)).toBe(2.17);
    expect(round2(2.994)).toBe(2.99);
  });
});

describe('normalizeUnite', () => {
  it('maps ASCII / lowercase bordereau unités to known unités', () => {
    expect(normalizeUnite('m3')).toBe('M³');
    expect(normalizeUnite('M2')).toBe('M²');
    expect(normalizeUnite('ml')).toBe('ML');
    expect(normalizeUnite('FFT')).toBe('ENS');
  });
  it('falls back to ENS for unknown unités (e.g. Touffe)', () => {
    expect(normalizeUnite('Touffe')).toBe('ENS');
    expect(isKnownUnite('Touffe')).toBe(false);
  });
});
