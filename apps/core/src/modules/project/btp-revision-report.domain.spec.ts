import { describe, expect, it } from 'vitest';
import { calculateRevisionPeriod, type PublishedIndexes, type RevisionPeriod } from './btp-revision.domain';
import { buildRevisionReport } from './btp-revision-report.domain';

const formula = { name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } };
const publication = (value: number, source = 'DATRP/TEST'): PublishedIndexes => ({
  values: { TEST: value }, source, status: 'definitif', publishedOn: '2026-03-01',
});

function period(start = '2026-01-01', end = '2026-01-31', value = 87.5): RevisionPeriod {
  return calculateRevisionPeriod({
    formula, baseIndexes: { TEST: 100 }, monthlyIndexes: new Map([['2026-01', publication(value)]]),
    start: new Date(start), end: new Date(end), amount: 1000, cutoff: '2026-03-10', allowProvisional: false,
  });
}

export function reportFixture() {
  return buildRevisionReport({
    project: { reference: 'TEST/2026', name: 'Travaux de test', ordreServiceDate: '2025-12-31' },
    mode: 'final_only', cutoff: '2026-03-10', baseDate: '2025-12-01', formula,
    basePublication: publication(100),
    rows: [{ decompteId: 'd1', numero: 1, isDernier: true, dateDecompte: '2026-03-10',
      statut: 'draft', cumulative: 0, trace: null, period: period(), origin: 'draft' }],
  });
}

describe('revision report projection', () => {
  it('identifies explicit manual base values separately from the ministry publication', () => {
    const report = buildRevisionReport({
      ...reportFixture(), basePublication: publication(120), baseIndexes: { TEST: 100 },
      rows: [{ decompteId: 'd1', numero: 1, isDernier: true, dateDecompte: null, statut: 'draft',
        cumulative: 0, trace: null, period: period(), origin: 'draft' }],
    });
    expect(report.coefficientGroups[0]?.manualBaseIndices).toEqual(['TEST']);
    expect(report.coefficientGroups[0]?.baseValues).toEqual({ TEST: 100 });
    expect(report.warnings.join(' ')).toContain('TEST 100 (registre 120)');
  });

  it('preserves signed revision and exposes the exact base values, month ratios and final total', () => {
    const report = reportFixture();
    expect(report.rows[0]).toMatchObject({ amount: -100, ht: 1000, totalDays: 31, appliedCoefficient: -0.1 });
    expect(report.summary).toMatchObject({ calculatedTotal: -100, availableTotal: -100, postedTotal: 0, balance: -100, final: true, pendingCount: 0 });
    expect(report.coefficientGroups[0]).toMatchObject({
      indices: ['TEST'], baseValues: { TEST: 100 },
      months: [{ month: '2026-01', values: { TEST: 87.5 }, ratios: { TEST: 0.875 }, coefficient: -0.1, statementNumeros: [1] }],
    });
  });

  it('keeps a missing publication blank and reports an incomplete grand total', () => {
    const calculated = period('2026-01-01', '2026-02-28');
    const report = buildRevisionReport({
      ...reportFixture(), basePublication: publication(100), rows: [{ decompteId: 'd2', numero: 2, isDernier: false, dateDecompte: null,
        statut: 'draft', cumulative: 0, trace: null, period: calculated, origin: 'draft' }],
    });
    expect(report.rows[0]?.amount).toBeNull();
    expect(report.rows[0]?.months[1]).toMatchObject({ month: '2026-02', amount: null, coefficient: null });
    expect(report.summary.calculatedTotal).toBeNull();
    expect(report.summary.pendingCount).toBe(1);
    expect(report.summary.balance).toBeNull();
  });

  it('keeps different publication versions of the same month visible and avoids duplicating identical coefficients', () => {
    const first = period();
    const second = period();
    const third = period('2026-01-01', '2026-01-31', 110);
    const report = buildRevisionReport({
      ...reportFixture(), basePublication: publication(100), rows: [first, second, third].map((value, index) => ({
        decompteId: `d${index}`, numero: index + 1, isDernier: index === 2, dateDecompte: null,
        statut: 'draft', cumulative: 0, trace: null, period: value, origin: 'draft',
      })),
    });
    expect(report.coefficientGroups).toHaveLength(1);
    expect(report.coefficientGroups[0]?.months).toHaveLength(2);
    expect(report.coefficientGroups[0]?.months[0]?.statementNumeros).toEqual([1, 2]);
    expect(report.coefficientGroups[0]?.months[1]?.statementNumeros).toEqual([3]);
  });

  it('retains separate amendment price bases and derives a mean without changing rounded monetary amounts', () => {
    const original = period();
    const added = period('2026-01-01', '2026-01-31', 110);
    const mixed: RevisionPeriod = {
      ...original, ht: 2000, amount: -20,
      months: [original.months[0]!, { ...added.months[0]!, priceBasis: {
        label: 'Prix supplémentaire AV-1', date: '2025-11-01', formula: 'CPS avenant', publication: publication(100), method: 'calendar',
      } }],
    };
    const report = buildRevisionReport({
      ...reportFixture(), basePublication: publication(100), rows: [{ decompteId: 'd1', numero: 1, isDernier: true, dateDecompte: null,
        statut: 'draft', cumulative: 0, trace: null, period: mixed, origin: 'draft' }],
    });
    expect(report.rows[0]?.amount).toBe(-20);
    expect(report.rows[0]?.totalDays).toBe(31);
    expect(report.rows[0]?.appliedCoefficient).toBe(-0.01);
    expect(report.coefficientGroups).toHaveLength(2);
  });

  it('shows the monthly formula coefficient separately from a contractual delay cap actually applied', () => {
    const capped = calculateRevisionPeriod({
      formula, baseIndexes: { TEST: 100 }, monthlyIndexes: new Map([
        ['2025-12', publication(87.5)], ['2026-01', publication(125)],
      ]), start: new Date('2026-01-01'), end: new Date('2026-01-31'), amount: 1000,
      cutoff: '2026-03-10', allowProvisional: false, contractDeadline: new Date('2025-12-31'),
    });
    const report = buildRevisionReport({
      ...reportFixture(), basePublication: publication(100), rows: [{
        decompteId: 'd1', numero: 1, isDernier: true, dateDecompte: null, statut: 'draft',
        cumulative: 0, trace: null, period: capped,
      }],
    });
    expect(report.coefficientGroups[0]?.months[0]?.coefficient).toBe(0.2);
    expect(report.rows[0]?.appliedCoefficient).toBe(-0.1);
    expect(report.rows[0]?.months[0]?.contractCoefficient).toBe(-0.1);
    expect(report.rows[0]?.amount).toBe(-100);
  });
});
