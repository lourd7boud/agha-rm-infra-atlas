import { describe, expect, test } from 'vitest';
import {
  INSPECTION_ITEM_STATUSES,
  INSPECTION_RESULTS,
  INSPECTION_TEMPLATES,
  INSPECTION_TYPES,
  inspectionItemSummary,
  inspectionOverallResult,
} from './equipment.inspection.domain';

describe('inspection templates & constants', () => {
  test('every inspection type ships a non-empty default checklist', () => {
    for (const type of INSPECTION_TYPES) {
      expect(INSPECTION_TEMPLATES[type].length).toBeGreaterThan(0);
    }
  });

  test('item statuses are ok / defaut / na', () => {
    expect(INSPECTION_ITEM_STATUSES).toEqual(['ok', 'defaut', 'na']);
  });

  test('results include conforme and non_conforme', () => {
    expect(INSPECTION_RESULTS).toContain('conforme');
    expect(INSPECTION_RESULTS).toContain('non_conforme');
  });
});

describe('inspectionItemSummary', () => {
  test('tallies each status', () => {
    const s = inspectionItemSummary([
      { status: 'ok' },
      { status: 'ok' },
      { status: 'defaut' },
      { status: 'na' },
    ]);
    expect(s).toEqual({ ok: 2, defaut: 1, na: 1, total: 4 });
  });
});

describe('inspectionOverallResult', () => {
  test('is conforme when all items are ok or na', () => {
    expect(
      inspectionOverallResult([{ status: 'ok' }, { status: 'na' }]),
    ).toBe('conforme');
  });

  test('is non_conforme when any item has a défaut', () => {
    expect(
      inspectionOverallResult([{ status: 'ok' }, { status: 'defaut' }]),
    ).toBe('non_conforme');
  });

  test('is conforme for an empty checklist', () => {
    expect(inspectionOverallResult([])).toBe('conforme');
  });
});
