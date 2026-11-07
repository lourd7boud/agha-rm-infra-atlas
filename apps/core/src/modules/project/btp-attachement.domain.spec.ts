import { describe, expect, it } from 'vitest';
import { appendTerrainMeasurement, assertTerrainMeasurementsPreserved } from './btp-attachement.domain';

describe('terrain measurements', () => {
  const source = { id: 'a1', designation: 'Canal', unite: 'ML', quantite: 12.5, note: 'Zone A' };
  it('adds a traceable manual quantity without rewriting existing dimensions', () => {
    const existing = [{ id: 'office', longueur: 3 }];
    const result = appendTerrainMeasurement('ML', existing, source);
    expect(result.totalPartiel).toBe(15.5);
    expect(result.lignes[0]).toMatchObject(existing[0]!);
    expect(result.lignes[1]).toMatchObject({ id: 'terrain-a1', partiel: 12.5 });
  });
  it('is replay safe even for weight units', () => {
    const first = appendTerrainMeasurement('KG', [], { ...source, unite: 'KG' });
    expect(appendTerrainMeasurement('KG', first.lignes, { ...source, unite: 'KG' }).totalPartiel).toBe(12.5);
  });
  it('rejects unit mismatch and nonpositive quantities', () => {
    expect(() => appendTerrainMeasurement('M³', [], source)).toThrow(/unité/i);
    expect(() => appendTerrainMeasurement('ML', [], { ...source, quantite: 0 })).toThrow(/quantité/i);
  });
  it('allows office edits but refuses removal or alteration of linked terrain quantities', () => {
    const linked = appendTerrainMeasurement('ML', [], source).lignes;
    expect(() => assertTerrainMeasurementsPreserved(linked, [])).toThrow(/terrain/i);
    expect(() => assertTerrainMeasurementsPreserved(linked, [{ ...linked[0]!, partiel: 99 }])).toThrow(/terrain/i);
    expect(() => assertTerrainMeasurementsPreserved(linked, [...linked, { id: 'new', longueur: 2 }])).not.toThrow();
  });
  it('rejects duplicated source IDs rather than counting one attachement twice', () => {
    const linked = appendTerrainMeasurement('ML', [], source).lignes;
    expect(() => assertTerrainMeasurementsPreserved(linked, [...linked, ...linked])).toThrow(/dupliqu/i);
  });
});
