import { describe, expect, it } from 'vitest';
import { calculateAvenantRevisionPeriod, splitAvenantRevisionGroups } from './btp-avenant-revision.domain';
import type { PublishedIndexes } from './btp-revision.domain';

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const initial = { id: 'line-A', numero: 1, designation: 'Base', unite: 'U', quantite: 100, prixUnitaire: 70 };
const extra = { id: 'line-B', numero: 2, designation: 'Nouveau prix', unite: 'U', quantite: 80, prixUnitaire: 30,
  avenant: { id: 'amendment', numero: 1, reference: 'AV-01', baseDate: '2026-01-18', dateEffet: '2026-02-10', formuleId: null } };
const publication = (value: number): PublishedIndexes => ({ values: { X: value }, status: 'definitif', source: 'DATRP/TEST', publishedOn: '2026-03-04' });

describe('revision des travaux supplémentaires', () => {
  it('prices measured quantities in separate bases and reuses the market basis only for initial prices', () => {
    const split = splitAvenantRevisionGroups([initial, extra], new Map([['line-A', 5], ['line-B', 5]]), date('2026-02-01'), 500)!;
    expect(split.groups.map((group) => group.amount)).toEqual([350, 150]);
    expect(split.groups[1]?.start).toEqual(date('2026-02-10'));
    const result = calculateAvenantRevisionPeriod({
      ...split, start: date('2026-02-01'), end: date('2026-02-28'), amount: 500, issues: [],
      baseDate: date('2025-12-01'), baseOverrides: { X: 100 }, formula: { name: 'CPS', fixedPart: 0.2, weights: { X: 0.8 } },
      formulas: new Map(), monthlyIndexes: new Map([['2026-01', [publication(125)]], ['2026-02', [publication(150)]]]),
      cutoff: '2026-03-08', allowProvisional: false, contractDeadline: null, limitedIndexes: true,
    });
    expect(result.amount).toBe(164);
    expect(result.months.map(({ amount, priceBasis }) => [amount, priceBasis?.date])).toEqual([[140, '2025-12-01'], [24, '2026-01-18']]);
  });

  it('returns to the existing workflow when only estimated amendment quantities exist', () => {
    expect(splitAvenantRevisionGroups([initial, extra], new Map([['line-A', 5]]), date('2026-02-01'), 350)).toBeUndefined();
  });

  it('detects unreconciled measurements before producing component amounts', () => {
    expect(splitAvenantRevisionGroups([initial, extra], new Map([['line-B', 5]]), date('2026-02-01'), 550)?.reconciled).toBe(false);
  });
});
