import { describe, expect, test } from 'vitest';
import { measurementIncomplete, metreArticleSummary, matchesMetreSearch } from './metre-workspace';

describe('metre workspace', () => {
  test('values each quantity with its own price instead of adding unlike units', () => {
    const volume = metreArticleSummary('M³', [{ id: 'v', longueur: 2, largeur: 3, profondeur: 0.5 }], [], 40, 900, 2);
    const steel = metreArticleSummary('KG', [{ id: 's', nombre: 4, longueur: 3, diametre: 12, nombreElements: 2 }], [], 1000, 12, 0);
    expect(volume.current).toBe(3);
    expect(volume.cumulative).toBe(5);
    expect(volume.amount).toBe(2700);
    expect(steel.current).toBe(21.31);
    expect(steel.amount).toBe(255.72);
  });

  test('keeps signed deductions and subsection repetitions', () => {
    const result = metreArticleSummary('KG', [{ id: 's', nombre: 4, longueur: 3, diametre: 12, nombreElements: -2, subSectionId: 'ss' }], [{ id: 'ss', titre: 'Poteaux', nombreElements: 3 }], 1000, 12, 100);
    expect(result.current).toBe(-63.94);
    expect(result.cumulative).toBe(36.06);
  });

  test('detects a cumulative overrun and handles zero contract quantity', () => {
    expect(metreArticleSummary('U', [{ id: 'u', nombre: 3 }], [], 10, 100, 9).overrun).toBe(true);
    expect(metreArticleSummary('U', [], [], 0, 100, 0).percent).toBe(0);
  });

  test('finds accented descriptions, price numbers and units', () => {
    const article = { numero: 12, designation: 'Béton armé', unite: 'M³' };
    expect(matchesMetreSearch(article, 'beton')).toBe(true);
    expect(matchesMetreSearch(article, '12')).toBe(true);
    expect(matchesMetreSearch(article, 'm3')).toBe(true);
    expect(matchesMetreSearch(article, 'acier')).toBe(false);
  });

  test('warns about missing dimensions without rejecting deductions or stored legacy partials', () => {
    expect(measurementIncomplete('M³', { id: 'v', longueur: 2, largeur: 3 })).toBe(true);
    expect(measurementIncomplete('M³', { id: 'v', nombreSemblables: -1, longueur: 2, largeur: 3, profondeur: 0.5 })).toBe(false);
    expect(measurementIncomplete('KG', { id: 's', nombre: 4, longueur: 3 })).toBe(true);
    expect(measurementIncomplete('M³', { id: 'old', partiel: 12 })).toBe(false);
  });
});
