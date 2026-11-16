import { describe, expect, it } from 'vitest';
import { allocateRevisionFromTerrain } from './btp-terrain-revision.domain';

const date = (day: string) => new Date(`${day}T00:00:00Z`);

const input = {
  start: date('2026-01-15'), end: date('2026-03-03'), amount: 1000,
  prix: new Map([['canal', 100]]),
  metres: [{ id: 'metre', bordereauLigneId: 'canal', unite: 'ML', totalPartiel: '10',
    lignes: [{ id: 'terrain-a', partiel: 8 }, { id: 'terrain-b', partiel: 2 }] }],
  sources: new Map([
    ['a', { metreId: 'metre', ligneId: 'canal', date: date('2026-01-29'), quantite: '8' }],
    ['b', { metreId: 'metre', ligneId: 'canal', date: date('2026-03-01'), quantite: '2' }],
  ]),
};

describe('monthly revision ventilation from work dates', () => {
  it('prices the confirmed quantities in their months and records months with no work as zero', () => {
    expect(allocateRevisionFromTerrain(input)).toEqual({ '2026-01': 800, '2026-02': 0, '2026-03': 200 });
  });

  it('uses the legal calendar fallback for incomplete or inconsistent evidence', () => {
    expect(allocateRevisionFromTerrain({ ...input, sources: new Map([['a', input.sources.get('a')!]]) })).toBeUndefined();
    expect(allocateRevisionFromTerrain({ ...input, amount: 1000.01 })).toBeUndefined();
    expect(allocateRevisionFromTerrain({ ...input, start: date('2026-01-30') })).toBeUndefined();
    expect(allocateRevisionFromTerrain({ ...input, metres: [{ ...input.metres[0]!, totalPartiel: '10.001' }] })).toBeUndefined();
    expect(allocateRevisionFromTerrain({ ...input, sources: new Map([...input.sources, ['b', { ...input.sources.get('b')!, metreId: 'autre' }]]) })).toBeUndefined();
  });

  it('assigns the cent rounding remainder once across monthly pieces', () => {
    expect(allocateRevisionFromTerrain({ ...input, amount: 0.03, prix: new Map([['canal', 0.003]]) })).toEqual({
      '2026-01': 0.02, '2026-02': 0, '2026-03': 0.01,
    });
  });
});
