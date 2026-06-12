import { describe, expect, test } from 'vitest';
import { summarizeLogs, type DailyLogView } from './field.domain';

function log(partial: Partial<DailyLogView>): DailyLogView {
  return {
    reportDate: partial.reportDate ?? new Date('2026-06-10T00:00:00Z'),
    effectifs: partial.effectifs ?? 12,
    incidentsSecurite: partial.incidentsSecurite ?? 0,
    blocages: 'blocages' in partial ? partial.blocages : undefined,
  };
}

describe('summarizeLogs', () => {
  test('averages workforce and totals incidents', () => {
    const summary = summarizeLogs([
      log({ effectifs: 10, incidentsSecurite: 0 }),
      log({ effectifs: 20, incidentsSecurite: 2 }),
    ]);

    expect(summary.jours).toBe(2);
    expect(summary.effectifMoyen).toBe(15);
    expect(summary.totalIncidents).toBe(2);
  });

  test('counts open blockers and finds the latest report date', () => {
    const summary = summarizeLogs([
      log({ reportDate: new Date('2026-06-09T00:00:00Z'), blocages: 'Pas de ciment' }),
      log({ reportDate: new Date('2026-06-11T00:00:00Z') }),
      log({ reportDate: new Date('2026-06-10T00:00:00Z'), blocages: '  ' }),
    ]);

    expect(summary.blocagesOuverts).toBe(1);
    expect(summary.dernierRapport?.toISOString()).toContain('2026-06-11');
  });

  test('empty journal produces a neutral summary', () => {
    const summary = summarizeLogs([]);

    expect(summary.jours).toBe(0);
    expect(summary.effectifMoyen).toBe(0);
    expect(summary.dernierRapport).toBeNull();
  });
});
