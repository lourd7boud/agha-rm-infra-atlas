import { describe, expect, it } from 'vitest';
import { computeDelaiInfo } from './btp-registres.domain';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const defaults = {
  ordreServiceDate: day('2026-01-01'),
  delaiMois: 6,
  arrets: [],
  receptionProvisoire: null,
  receptionDefinitive: null,
  today: day('2026-03-01'),
};

describe('contractual calendar deadlines', () => {
  it('uses the day after the legacy OS date and actual calendar days', () => {
    const result = computeDelaiInfo(defaults);
    expect(iso(result.dateFinInitiale)).toBe('2026-07-02');
    expect(iso(result.dateFinEffective)).toBe('2026-07-02');
    expect(result.delaiJours).toBe(181);
  });

  it('uses an explicit execution start even without a legacy OS date', () => {
    const result = computeDelaiInfo({ ...defaults, ordreServiceDate: null, executionStartDate: day('2026-02-15') });
    expect(iso(result.dateFinInitiale)).toBe('2026-08-15');
  });

  it.each([
    ['2026-01-31', 1, '2026-02-28', 28],
    ['2028-01-31', 1, '2028-02-29', 29],
    ['2028-02-29', 12, '2029-02-28', 365],
    ['2026-12-31', 2, '2027-02-28', 59],
  ])('clamps %s plus %s months to %s', (start, months, end, days) => {
    const result = computeDelaiInfo({ ...defaults, executionStartDate: day(start), delaiMois: months });
    expect(iso(result.dateFinEffective)).toBe(end);
    expect(result.delaiJours).toBe(days);
  });

  it('normalizes timestamps to UTC dates before computing days', () => {
    const result = computeDelaiInfo({
      ...defaults,
      executionStartDate: new Date('2026-01-31T23:45:00Z'),
      delaiMois: 1,
      today: new Date('2026-02-01T00:15:00Z'),
    });
    expect(iso(result.dateFinEffective)).toBe('2026-02-28');
    expect(result.joursEcoules).toBe(1);
  });

  it('adds approved extension months to the original start without intermediate clamping', () => {
    const result = computeDelaiInfo({ ...defaults, executionStartDate: day('2026-01-31'), delaiMois: 1, extraDelaiMois: 1 });
    expect(iso(result.dateFinInitiale)).toBe('2026-02-28');
    expect(iso(result.dateFinEffective)).toBe('2026-03-31');
    expect(result.delaiJours).toBe(59);
  });

  it('counts the union of duplicate, overlapping and adjoining stops once', () => {
    const result = computeDelaiInfo({
      ...defaults,
      arrets: [
        { dateArret: '2026-02-01', dateReprise: '2026-02-11' },
        { dateArret: '2026-02-01', dateReprise: '2026-02-11' },
        { dateArret: '2026-02-05', dateReprise: '2026-02-15' },
        { dateArret: '2026-02-15', dateReprise: '2026-02-20' },
      ],
    });
    expect(result.joursArret).toBe(19);
    expect(result.delaiTotal).toBe(200);
    expect(iso(result.dateFinEffective)).toBe('2026-07-21');
  });

  it('does not invent a definitive end during an open stop', () => {
    const result = computeDelaiInfo({ ...defaults, arrets: [{ dateArret: '2026-02-01' }] });
    expect(result.enArret).toBe(true);
    expect(result.dateFinEffective).toBeNull();
    expect(iso(result.dateFinInitiale)).toBe('2026-07-02');
    expect(result.status).toBe('unknown');
  });

  it('keeps a stop active until the notified effective resumption', () => {
    const result = computeDelaiInfo({ ...defaults, arrets: [{ dateArret: '2026-02-01', dateReprise: '2026-03-10' }] });
    expect(result.enArret).toBe(true);
    expect(iso(result.dateFinEffective)).toBe('2026-08-08');
  });

  it('counts only the days that suspend a running contractual deadline', () => {
    const result = computeDelaiInfo({
      ...defaults,
      arrets: [
        { dateArret: '2025-12-02', dateReprise: '2025-12-14' },
        { dateArret: '2025-12-28', dateReprise: '2026-01-05' },
        { dateArret: '2026-07-03', dateReprise: '2026-07-07' },
        { dateArret: '2026-07-20', dateReprise: '2026-07-25' },
      ],
    });
    expect(result.joursArret).toBe(7);
    expect(iso(result.dateFinEffective)).toBe('2026-07-09');
  });

  it('keeps missing durations and starts unknown', () => {
    expect(computeDelaiInfo({ ...defaults, ordreServiceDate: null }).dateFinEffective).toBeNull();
    expect(computeDelaiInfo({ ...defaults, delaiMois: null }).status).toBe('unknown');
  });
});
