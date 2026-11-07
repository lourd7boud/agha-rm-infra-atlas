import type { TerrainJourneeRecord } from '@atlas/contracts';

type ProductionLine = { id?: string; numero: number; designation: string; unite: string; quantite: number };
const unitKey = (value: string) => value.trim().toUpperCase().replace('3', '³').replace('2', '²');
const round = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function summarizeTerrainProduction(bpu: ProductionLine[], days: TerrainJourneeRecord[]) {
  const rows = bpu.map((line) => ({ ...line, id: line.id ?? String(line.numero), reviewed: 0, pending: 0 }));
  const zones = new Map<string, { zone: string; bpuId: string; designation: string; unite: string; reviewed: number }>();
  let unmatched = 0;
  for (const day of days) {
    if (day.status !== 'reviewed' && day.status !== 'submitted') continue;
    for (const production of day.payload.production) {
      const row = rows.find((line) => line.id === production.bpuLigneId && unitKey(line.unite) === unitKey(production.unite));
      if (!row) { unmatched++; continue; }
      if (day.status === 'submitted') { row.pending += production.quantite; continue; }
      row.reviewed += production.quantite;
      const zone = production.zone ?? day.payload.zone;
      const key = JSON.stringify([zone, row.id]);
      const current = zones.get(key) ?? { zone, bpuId: row.id, designation: row.designation, unite: row.unite, reviewed: 0 };
      current.reviewed += production.quantite;
      zones.set(key, current);
    }
  }
  return {
    unmatched,
    rows: rows.map((row) => ({ ...row, reviewed: round(row.reviewed), pending: round(row.pending),
      remaining: round(Math.max(0, row.quantite - row.reviewed)), overrun: round(Math.max(0, row.reviewed - row.quantite)),
      percent: row.quantite > 0 ? round(row.reviewed / row.quantite * 100) : null,
    })),
    zones: [...zones.values()].map((zone) => ({ ...zone, reviewed: round(zone.reviewed) })).sort((a, b) => a.zone.localeCompare(b.zone)),
  };
}
