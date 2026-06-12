/**
 * Field division v1 — journal de chantier arithmetic. The daily report is
 * the terrain role's first write surface: workforce on site, works done,
 * blockers, and safety incidents, one report per project per day.
 */

export interface DailyLogView {
  reportDate: Date;
  effectifs: number;
  incidentsSecurite: number;
  blocages?: string;
}

export interface JournalSummary {
  jours: number;
  effectifMoyen: number;
  totalIncidents: number;
  blocagesOuverts: number;
  dernierRapport: Date | null;
}

export function summarizeLogs(logs: DailyLogView[]): JournalSummary {
  if (logs.length === 0) {
    return {
      jours: 0,
      effectifMoyen: 0,
      totalIncidents: 0,
      blocagesOuverts: 0,
      dernierRapport: null,
    };
  }

  const sorted = [...logs].sort(
    (a, b) => b.reportDate.getTime() - a.reportDate.getTime(),
  );

  return {
    jours: logs.length,
    effectifMoyen:
      Math.round(
        (logs.reduce((sum, l) => sum + l.effectifs, 0) / logs.length) * 10,
      ) / 10,
    totalIncidents: logs.reduce((sum, l) => sum + l.incidentsSecurite, 0),
    blocagesOuverts: logs.filter((l) => (l.blocages ?? '').trim().length > 0)
      .length,
    dernierRapport: sorted[0]?.reportDate ?? null,
  };
}
