import { describe, expect, it } from 'vitest';
import type { TerrainJourneeRecord } from '@atlas/contracts';
import { summarizeTerrainProduction } from './terrain-production';

describe('declared terrain production', () => {
  const day = (status: TerrainJourneeRecord['status'], quantity: number, unit = 'ML', zone = 'Canal A') => ({ id: status, status, payload: { zone, production: [{ bpuLigneId: 'bpu', designation: 'Canal', unite: unit, quantite: quantity }] } }) as TerrainJourneeRecord;
  it('separates reviewed from pending and never adds different units', () => {
    const result = summarizeTerrainProduction([{ id: 'bpu', designation: 'Canal', unite: 'ML', quantite: 100, numero: 1 }], [day('reviewed', 25), day('submitted', 10), day('draft', 99), day('returned', 50), day('reviewed', 4, 'M³')]);
    expect(result.rows[0]).toMatchObject({ reviewed: 25, pending: 10, remaining: 75, percent: 25 });
    expect(result.unmatched).toBe(1);
    expect(result.zones[0]).toMatchObject({ zone: 'Canal A', reviewed: 25, unite: 'ML' });
  });
  it('exposes overrun without capping quantities or inventing an overall progress', () => {
    const result = summarizeTerrainProduction([{ id: 'bpu', designation: 'Canal', unite: 'ML', quantite: 10, numero: 1 }], [day('reviewed', 25)]);
    expect(result.rows[0]).toMatchObject({ reviewed: 25, remaining: 0, overrun: 15, percent: 250 });
  });
  it('rounds zone and item totals only after accumulation', () => {
    const result = summarizeTerrainProduction([{ id: 'bpu', designation: 'Canal', unite: 'ML', quantite: 10, numero: 1 }], [day('reviewed', 0.0004), day('reviewed', 0.0004)]);
    expect(result.zones[0]?.reviewed).toBe(result.rows[0]?.reviewed);
  });
});
