import { describe, expect, test } from 'vitest';
import {
  assetThumbnailHref,
  computeLignePartielClient,
  METRE_CHAMPS,
  metreOpenStateKey,
  normaliseNombreElements,
  POIDS_ACIER,
  restoreMetreOpenState,
  serializeMetreOpenState,
} from './btp-shared';

describe('assetThumbnailHref', () => {
  test('uses the optimized thumbnail endpoint for stored project photos', () => {
    expect(
      assetThumbnailHref('project-1', { id: 'photo-1', storageKey: 'btp/project/photo.jpg' }),
    ).toBe('/api/btp-asset/project-1/photo-1?variant=thumbnail');
    expect(assetThumbnailHref('project-1', { id: 'photo-1', storageKey: null })).toBeNull();
  });
});

describe('état ouvert/fermé des postes de métré', () => {
  test('restaure exactement les postes ouverts et fermés pour une période', () => {
    expect(metreOpenStateKey('p1', 'per1')).not.toBe(metreOpenStateKey('p1', 'per2'));
    const keys = ['ligne-1', 'ligne-2', 'ligne-3'];
    const stored = serializeMetreOpenState(
      { 'ligne-1': false, 'ligne-2': true, 'ligne-3': false },
      keys,
    );
    expect(
      restoreMetreOpenState(stored, keys, {
        'ligne-1': true,
        'ligne-2': true,
        'ligne-3': true,
      }),
    ).toEqual({ 'ligne-1': false, 'ligne-2': true, 'ligne-3': false });
  });

  test('ignore un stockage illisible et conserve les valeurs par défaut', () => {
    expect(
      restoreMetreOpenState('{invalide', ['ligne-1'], { 'ligne-1': true }),
    ).toEqual({ 'ligne-1': true });
  });
});

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

  test('absent, vide, zéro ou NaN → 1; négatif conservé comme déduction', () => {
    expect(normaliseNombreElements(undefined)).toBe(1);
    expect(normaliseNombreElements(null)).toBe(1);
    expect(normaliseNombreElements(0)).toBe(1);
    expect(normaliseNombreElements(-4)).toBe(-4);
    expect(normaliseNombreElements(Number.NaN)).toBe(1);
    expect(normaliseNombreElements(0.4)).toBe(1);
  });

  test('tronque les décimales (2,7 → 2)', () => {
    expect(normaliseNombreElements(2.7)).toBe(2);
    expect(normaliseNombreElements(9.99)).toBe(9);
  });
});

describe('computeLignePartielClient — acier (KG)', () => {
  test('une répétition négative devient une déduction', () => {
    expect(
      computeLignePartielClient('KG', {
        id: 'deduction-acier',
        nombre: 4,
        nombreElements: -2,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(-21.312, 10);
  });

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

  test('valeur vide / zéro / NaN : traitée comme 1, jamais de partiel cassé', () => {
    for (const nombreElements of [undefined, 0, Number.NaN]) {
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
  test('nombreSemblables négatif soustrait la mesure', () => {
    expect(
      computeLignePartielClient('M³', {
        id: 'deduction-volume',
        nombreSemblables: -2,
        longueur: 2,
        largeur: 3,
        profondeur: 0.5,
      }),
    ).toBe(-6);
  });

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
