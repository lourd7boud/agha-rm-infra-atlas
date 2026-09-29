import { describe, expect, test } from 'vitest';
import {
  computeLignePartielClient,
  METRE_CHAMPS,
  normaliseNombreElements,
  POIDS_ACIER,
} from './btp-shared';

// Miroir client du moteur serveur : sur les lignes acier (KG/T) le partiel vaut
// Nombre × Nombre d’éléments × Longueur × poids du Ø, où « Nombre » reste le
// nombre de barres DANS un élément et « Nombre d’éléments » la répétition
// d'éléments identiques (défaut 1 → calcul historique inchangé).

describe('normaliseNombreElements', () => {
  test('conserve les entiers positifs', () => {
    expect(normaliseNombreElements(1)).toBe(1);
    expect(normaliseNombreElements(8)).toBe(8);
    expect(normaliseNombreElements(20)).toBe(20);
  });

  test('absent, vide, zéro, négatif ou NaN → 1 (compatibilité anciennes mesures)', () => {
    expect(normaliseNombreElements(undefined)).toBe(1);
    expect(normaliseNombreElements(null)).toBe(1);
    expect(normaliseNombreElements(0)).toBe(1);
    expect(normaliseNombreElements(-4)).toBe(1);
    expect(normaliseNombreElements(Number.NaN)).toBe(1);
    expect(normaliseNombreElements(0.4)).toBe(1);
  });

  test('tronque les décimales (2,7 → 2)', () => {
    expect(normaliseNombreElements(2.7)).toBe(2);
    expect(normaliseNombreElements(9.99)).toBe(9);
  });
});

describe('computeLignePartielClient — acier (KG)', () => {
  test('sans « Nombre d’éléments » ou avec 1 : résultat identique à l’ancien calcul', () => {
    const ancien = 4 * 3 * POIDS_ACIER[12]!;
    expect(
      computeLignePartielClient('KG', { id: 'l1', nombre: 4, longueur: 3, diametre: 12 }),
    ).toBeCloseTo(ancien, 10);
    expect(
      computeLignePartielClient('KG', {
        id: 'l1',
        nombre: 4,
        nombreElements: 1,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(ancien, 10);
    expect(ancien).toBeCloseTo(10.656, 10);
  });

  test('4 barres × 8 poteaux × 3 m en Ø12 = 85,248 kg', () => {
    expect(
      computeLignePartielClient('KG', {
        id: 'l2',
        nombre: 4,
        nombreElements: 8,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(85.248, 10);
  });

  test('étriers : 25 × 4 kms × 2,16 m en Ø8', () => {
    expect(
      computeLignePartielClient('KG', {
        id: 'l3',
        nombre: 25,
        nombreElements: 4,
        longueur: 2.16,
        diametre: 8,
      }),
    ).toBeCloseTo(85.32, 10);
  });

  test('valeur vide / zéro / négative : traitée comme 1, jamais de partiel cassé', () => {
    for (const nombreElements of [undefined, 0, -3, Number.NaN]) {
      expect(
        computeLignePartielClient('KG', {
          id: 'l4',
          nombre: 4,
          nombreElements,
          longueur: 3,
          diametre: 12,
        }),
      ).toBeCloseTo(10.656, 10);
    }
  });

  test('nombreSemblables (kg) et nombre d’éléments se multiplient', () => {
    expect(
      computeLignePartielClient('KG', {
        id: 'l5',
        nombreSemblables: 2,
        nombre: 4,
        nombreElements: 8,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(170.496, 10);
  });

  test('en tonnes : répétition appliquée avant la division par 1000', () => {
    expect(
      computeLignePartielClient('T', {
        id: 'l6',
        nombre: 4,
        nombreElements: 8,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(0.085248, 10);
  });
});

describe('computeLignePartielClient — unités non acier', () => {
  test('volume, surface, linéaire et unité ignorent le nombre d’éléments', () => {
    expect(
      computeLignePartielClient('M³', {
        id: 'v1',
        longueur: 2,
        largeur: 3,
        profondeur: 0.5,
        nombreElements: 9,
      }),
    ).toBe(3);
    expect(
      computeLignePartielClient('M²', { id: 's1', longueur: 4, largeur: 5, nombreElements: 9 }),
    ).toBe(20);
    expect(
      computeLignePartielClient('ML', { id: 'ml1', nombreSemblables: 2, longueur: 12.6, nombreElements: 9 }),
    ).toBeCloseTo(25.2, 10);
    expect(computeLignePartielClient('U', { id: 'u1', nombre: 5, nombreElements: 9 })).toBe(5);
  });

  test('les valeurs mémorisées restent la source de vérité sans dimensions', () => {
    expect(computeLignePartielClient('M³', { id: 'v2', partiel: 95.26 })).toBe(95.26);
  });
});

describe('METRE_CHAMPS', () => {
  test('la colonne Nombre d’éléments n’appartient qu’aux unités de poids', () => {
    expect(METRE_CHAMPS.poids).toEqual(['nombre', 'nombreElements', 'longueur', 'diametre']);
    expect(METRE_CHAMPS.volume).not.toContain('nombreElements');
    expect(METRE_CHAMPS.unite).not.toContain('nombreElements');
  });
});