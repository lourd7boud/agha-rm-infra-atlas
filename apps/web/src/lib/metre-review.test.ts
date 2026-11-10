import { describe, expect, test } from 'vitest';
import { reviewMetreArticle } from './metre-review';

const base = { key: 'b1', unite: 'M³', quantite: 100, previous: 0, sousSections: [] };
describe('engineering coherence review', () => {
  test('identifies duplicates by designation, dimensions and location, without changing data', () => {
    const lignes = [{ id: 'a', designation: 'Semelle S1', longueur: 2, largeur: 3, profondeur: 0.5 }, { id: 'b', designation: 'semelle s1', longueur: 2, largeur: 3, profondeur: 0.5 }, { id: 'c', designation: 'Semelle S2', longueur: 2, largeur: 3, profondeur: 0.5 }];
    const before = JSON.stringify(lignes);
    const duplicates = reviewMetreArticle({ ...base, lignes }).filter((issue) => issue.kind === 'duplicate');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].lineIds).toEqual(['a', 'b']);
    expect(JSON.stringify(lignes)).toBe(before);
  });
  test('accepts signed deductions and legacy stored partials', () => {
    const issues = reviewMetreArticle({ ...base, lignes: [{ id: 'd', nombreSemblables: -2, longueur: 2, largeur: 3, profondeur: 0.5 }, { id: 'old', partiel: 4 }] });
    expect(issues).toEqual([]);
  });
  test('explains incomplete, extreme, zero and negative dimensions and cumulative overrun', () => {
    const issues = reviewMetreArticle({ ...base, previous: 99, lignes: [{ id: 'a', longueur: 2 }, { id: 'b', longueur: 2, largeur: 3, profondeur: 50 }, { id: 'c', longueur: 0, largeur: 3, profondeur: -1 }] });
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['incomplete', 'dimension', 'zero', 'overrun']));
    expect(issues.find((issue) => issue.kind === 'overrun')?.detail).toMatch(/99/);
  });
  test('flags combined steel repetition and a count the engine normalizes', () => {
    const issues = reviewMetreArticle({ ...base, unite: 'KG', sousSections: [{ id: 'ss', titre: 'Poteaux', nombreElements: 8 }], lignes: [{ id: 'a', subSectionId: 'ss', nombre: 4, nombreElements: 2, longueur: 3, diametre: 12 }, { id: 'b', nombre: 4, nombreElements: 2.9, longueur: 3, diametre: 13 }] });
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['repetition', 'count', 'diameter']));
  });
});
