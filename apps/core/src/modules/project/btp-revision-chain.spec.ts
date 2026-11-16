import { describe, expect, it } from 'vitest';
import { calculateRevisionPeriod, settleRevision } from './btp-revision.domain';

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const formula = { name: 'CPS', fixedPart: 0.2, weights: { TR3: 0.8 } };
const monthlyIndexes = new Map([
  ['2026-01', { values: { TR3: 125 }, status: 'definitif', source: 'DATRP/01', publishedOn: '2026-02-01' }],
  ['2026-02', { values: { TR3: 87.5 }, status: 'provisoire', source: 'DATRP/02', publishedOn: '2026-03-01' }],
]);
const input = {
  formula, baseIndexes: { TR3: 100 }, monthlyIndexes,
  start: date('2026-01-31'), end: date('2026-02-01'),
  amount: 10_000, cutoff: '2026-03-02', allowProvisional: false,
};

describe('liquidation de la révision BTP', () => {
  it('ventile le HT réellement exécuté et conserve une révision signée', () => {
    const result = calculateRevisionPeriod({ ...input, monthlyHt: { '2026-01': 2000, '2026-02': 8000 }, allowProvisional: true });
    expect(result.amount).toBe(-400);
    expect(result.months.map((month) => month.amount)).toEqual([400, -800]);
  });

  it('reporte tout le décompte courant si un index requis manque ou est provisoire', () => {
    expect(calculateRevisionPeriod(input).amount).toBeNull();
    expect(calculateRevisionPeriod({ ...input, baseIndexes: {} }).amount).toBeNull();
    expect(calculateRevisionPeriod({ ...input, allowProvisional: true, cutoff: '2026-02-15' }).amount).toBeNull();
  });

  it('borne le coefficient pour un retard imputable confirmé', () => {
    const result = calculateRevisionPeriod({ ...input, start: date('2026-02-01'), amount: 1000, allowProvisional: true, contractDeadline: date('2026-01-31') });
    expect(result.amount).toBe(-100);
  });

  it('porte la révision déjà comptabilisée puis régularise une seule fois', () => {
    const first = calculateRevisionPeriod({ ...input, end: input.start, amount: 2000 });
    const second = calculateRevisionPeriod({ ...input, start: input.end, amount: 8000, allowProvisional: true });
    expect(settleRevision([first, second], 400, false)).toMatchObject({ cumulative: -400, movement: -800, status: 'calculated' });
    expect(settleRevision([first, second], -400, false)).toMatchObject({ cumulative: -400, movement: 0 });
    const pending = calculateRevisionPeriod({ ...input, start: input.end, amount: 8000 });
    expect(settleRevision([first, pending], 400, true)).toMatchObject({ cumulative: 400, movement: 0, status: 'pending' });
  });

  it('calcule chaque période et diffère le report financier jusqu’au dernier décompte', () => {
    const first = calculateRevisionPeriod({ ...input, end: input.start, amount: 2000 });
    const second = calculateRevisionPeriod({ ...input, start: input.end, amount: 8000, allowProvisional: true });
    const deferred = settleRevision([first], 0, false, { postingMode: 'final_only', isLast: false });
    expect(deferred).toMatchObject({ cumulative: 0, movement: 0, calculatedCumulative: 400,
      availableCumulative: 400, deferred: true, status: 'calculated' });
    const closing = settleRevision([first, second], 0, true, { postingMode: 'final_only', isLast: true });
    expect(closing).toMatchObject({ cumulative: -400, movement: -400, calculatedCumulative: -400,
      deferred: false, status: 'calculated' });
    expect(settleRevision([first, second], -400, true, { postingMode: 'final_only', isLast: true }))
      .toMatchObject({ cumulative: -400, movement: 0 });
  });

  it('conserve le report déjà signé et indique un calcul incomplet en clôture différée', () => {
    const first = calculateRevisionPeriod({ ...input, end: input.start, amount: 2000 });
    const pending = calculateRevisionPeriod({ ...input, start: input.end, amount: 8000 });
    expect(settleRevision([first, pending], 0, true, { postingMode: 'final_only', isLast: true }))
      .toMatchObject({ cumulative: 0, movement: 0, calculatedCumulative: null,
        availableCumulative: 400, deferred: false, status: 'pending' });
  });

  it('laisse le calcul visible avec un report antérieur en mode différé', () => {
    const first = calculateRevisionPeriod({ ...input, end: input.start, amount: 2000 });
    expect(settleRevision([first], 100, false, { postingMode: 'final_only', isLast: false }))
      .toMatchObject({ cumulative: 100, movement: 0, calculatedCumulative: 400,
        availableCumulative: 400, deferred: true });
  });

  it('arrête le coefficient P/P0 avant de calculer une variation négative', () => {
    const result = calculateRevisionPeriod({
      ...input, formula: { name: 'CPS', fixedPart: 0.15, weights: { TR3: 0.85 } },
      start: date('2026-01-01'), end: date('2026-01-31'), amount: 10_000,
      monthlyIndexes: new Map([['2026-01', { values: { TR3: 88.25 }, status: 'definitif',
        source: 'TEST', publishedOn: '2026-02-01' }]]),
    });
    expect(result.amount).toBe(-999);
  });

  it('exige les mois à zéro explicites dans la ventilation réelle et garde les blocages à HT nul', () => {
    expect(calculateRevisionPeriod({ ...input, allowProvisional: true,
      monthlyHt: { '2026-01': 10_000 } }).amount).toBeNull();
    expect(calculateRevisionPeriod({ ...input, amount: 0, issues: ['Date de clôture manquante'] }).amount).toBeNull();
  });
});
