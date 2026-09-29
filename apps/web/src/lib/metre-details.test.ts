import { describe, expect, test } from 'vitest';
import {
  DIMENSION_COLUMNS,
  fmtMetreColumn,
  fmtMetreQty,
  fmtMetreValue,
  hasPreviousLignes,
  previousLignePartiel,
  type MetrePreviousPeriode,
} from './metre-details';

// Détails des périodes précédentes : on affiche les mesures réellement
// enregistrées (partiel stocké), jamais une valeur déduite du total.

describe('previousLignePartiel', () => {
  test('affiche le partiel enregistré, même si les dimensions suggèrent autre chose', () => {
    // 10 × 10 × 10 vaudrait 1000 en M³, mais le métré enregistré vaut 95,26 :
    // la donnée sauvegardée est la source de vérité.
    expect(
      previousLignePartiel('M³', {
        id: 'm1',
        longueur: 10,
        largeur: 10,
        profondeur: 10,
        partiel: 95.26,
      }),
    ).toBe(95.26);
  });

  test('conserve un partiel enregistré à 0', () => {
    expect(previousLignePartiel('M³', { id: 'm2', longueur: 2, largeur: 2, partiel: 0 })).toBe(0);
  });

  test('retombe sur la formule du moteur (dimensions stockées) sans partiel — anciennes lignes', () => {
    // Volume avec nb semblables : 2 × 12,6 × 12,6 × 0,6 = 190,512 → arrondi 190,51
    expect(
      previousLignePartiel('M³', {
        id: 'm3',
        nombreSemblables: 2,
        longueur: 12.6,
        largeur: 12.6,
        profondeur: 0.6,
      }),
    ).toBe(190.51);
    expect(
      previousLignePartiel('M²', { id: 'm4', nombreSemblables: 3, longueur: 4, largeur: 5 }),
    ).toBe(60);
    expect(
      previousLignePartiel('ML', { id: 'm5', nombreSemblables: 2, longueur: 12.6 }),
    ).toBe(25.2);
    expect(previousLignePartiel('KG', { id: 'm6', nombre: 10, longueur: 6, diametre: 12 })).toBe(
      53.28,
    );
    expect(previousLignePartiel('T', { id: 'm7', nombre: 10, longueur: 6, diametre: 12 })).toBe(
      0.05,
    );
    expect(previousLignePartiel('U', { id: 'm8', nombre: 7 })).toBe(7);
  });

  test('gère une ligne legacy ne portant qu’un partiel manuel', () => {
    expect(previousLignePartiel('M³', { id: 'm9', partiel: 42 })).toBe(42);
  });

  test('ne plante pas sur une ligne vide', () => {
    expect(previousLignePartiel('M³', { id: 'm10' })).toBe(0);
  });
});

describe('hasPreviousLignes', () => {
  test('faux sans période précédente ou sans mesure', () => {
    expect(hasPreviousLignes([])).toBe(false);
    expect(hasPreviousLignes([{ periodeNumero: 1, totalPartiel: 0, lignes: [] }])).toBe(false);
  });

  test('vrai dès qu’une période porte des mesures', () => {
    const previous: MetrePreviousPeriode[] = [
      { periodeNumero: 1, totalPartiel: 0, lignes: [] },
      { periodeNumero: 2, totalPartiel: 122.26, lignes: [{ id: 'a' }, { id: 'b' }] },
    ];
    expect(hasPreviousLignes(previous)).toBe(true);
  });
});

describe('formatage des détails', () => {
  test('partiels et totaux : 2 à 4 décimales, « — » si absents', () => {
    expect(fmtMetreQty(122.26)).toBe('122,26');
    expect(fmtMetreQty(96)).toBe('96,00');
    expect(fmtMetreQty(0.5)).toBe('0,50');
    expect(fmtMetreQty(undefined)).toBe('—');
    expect(fmtMetreQty(null)).toBe('—');
    expect(fmtMetreQty(Number.NaN)).toBe('—');
  });

  test('valeurs dimensionnelles : telles qu’enregistrées, « — » si vides', () => {
    expect(fmtMetreValue(12.6)).toBe('12,6');
    expect(fmtMetreValue(600)).toBe('600');
    expect(fmtMetreValue(0.4)).toBe('0,4');
    expect(fmtMetreValue(1)).toBe('1');
    expect(fmtMetreValue(0)).toBe('0');
    expect(fmtMetreValue(undefined)).toBe('—');
    expect(fmtMetreValue(Number.NaN)).toBe('—');
  });
});

describe('DIMENSION_COLUMNS', () => {
  test('colonnes identiques à l’éditeur de la période courante', () => {
    expect(DIMENSION_COLUMNS.volume.map((c) => c.label)).toEqual([
      'Nb semblables',
      'Longueur',
      'Largeur',
      'Profondeur',
    ]);
    expect(DIMENSION_COLUMNS.surface.map((c) => c.label)).toEqual([
      'Nb semblables',
      'Longueur',
      'Largeur',
    ]);
    expect(DIMENSION_COLUMNS.lineaire.map((c) => c.label)).toEqual([
      'Nb semblables',
      'Longueur',
    ]);
    expect(DIMENSION_COLUMNS.poids.map((c) => c.label)).toEqual([
      'Nombre',
      'Nombre d’éléments',
      'Longueur (ml)',
      'Ø (mm)',
    ]);
    expect(DIMENSION_COLUMNS.unite.map((c) => c.label)).toEqual(['Nombre']);
  });

  test('« Nombre » et « Nombre d’éléments » sont deux colonnes distinctes du ferraillage', () => {
    const poids = DIMENSION_COLUMNS.poids;
    expect(poids.map((c) => c.field)).toEqual(['nombre', 'nombreElements', 'longueur', 'diametre']);
    expect(poids[0]!.hint).toContain('UN seul élément');
    expect(poids[1]!.hint).toContain('répétés');
  });

  test('seule la colonne Nombre d’éléments retombe sur 1 quand la donnée est absente', () => {
    expect(DIMENSION_COLUMNS.poids.find((c) => c.field === 'nombreElements')?.fallback).toBe(1);
    expect(DIMENSION_COLUMNS.poids.find((c) => c.field === 'nombre')?.fallback).toBeUndefined();
  });
});

describe('fmtMetreColumn', () => {
  test('affiche la valeur enregistrée', () => {
    const col = DIMENSION_COLUMNS.poids.find((c) => c.field === 'nombreElements')!;
    expect(fmtMetreColumn(col, { id: 'a', nombreElements: 8 })).toBe('8');
    expect(fmtMetreColumn(col, { id: 'a', nombreElements: 1 })).toBe('1');
  });

  test('retombe sur le défaut du moteur (1) pour les mesures antérieures au champ', () => {
    const col = DIMENSION_COLUMNS.poids.find((c) => c.field === 'nombreElements')!;
    expect(fmtMetreColumn(col, { id: 'legacy', nombre: 10, longueur: 12, diametre: 8 })).toBe('1');
  });

  test('sans défaut, une valeur absente reste « — »', () => {
    const col = DIMENSION_COLUMNS.poids.find((c) => c.field === 'longueur')!;
    expect(fmtMetreColumn(col, { id: 'b' })).toBe('—');
  });
});
