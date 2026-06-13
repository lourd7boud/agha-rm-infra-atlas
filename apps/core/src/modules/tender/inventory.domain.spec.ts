import { describe, expect, test } from 'vitest';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { buildInventory, inferRegion } from './inventory.domain';
import type { TenderRecord } from './tender.repository';

function rec(overrides: Partial<TenderRecord> & { reference: string }): TenderRecord {
  return {
    id: overrides.id ?? overrides.reference,
    reference: overrides.reference,
    buyerName: overrides.buyerName ?? 'Acheteur',
    procedure: (overrides.procedure ?? 'AOO') as TenderProcedure,
    objet: overrides.objet ?? 'Travaux divers',
    estimationMad: overrides.estimationMad,
    cautionProvisoireMad: overrides.cautionProvisoireMad,
    deadlineAt: overrides.deadlineAt ?? new Date('2026-08-01T09:00:00Z'),
    sourceUrl: overrides.sourceUrl,
    pipelineState: (overrides.pipelineState ?? 'detected') as PipelineState,
    qualification: null,
    raw: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
}

const NOW = new Date('2026-06-13T00:00:00Z');

describe('inferRegion', () => {
  test('matches a buyer city to its region (accent-insensitive)', () => {
    expect(inferRegion('Commune de Tétouan')).toBe(
      'Tanger-Tétouan-Al Hoceïma',
    );
    expect(inferRegion('ORMVA du Souss Massa')).toBe('Souss-Massa');
    expect(inferRegion('Conseil de la Région de Marrakech')).toBe(
      'Marrakech-Safi',
    );
  });

  test('falls back to the objet text when the buyer is generic', () => {
    expect(inferRegion('Ministère X', "Construction d'une école à Dakhla")).toBe(
      'Dakhla-Oued Ed-Dahab',
    );
  });

  test('returns null when nothing matches', () => {
    expect(inferRegion('Direction Générale', 'Fourniture de matériel')).toBeNull();
  });

  test('does not match short keywords inside longer words (whole-word boundaries)', () => {
    // "assa" must not match inside "assainissement" → Guelmim-Oued Noun.
    expect(inferRegion('Commune X', "Travaux d'assainissement liquide")).toBeNull();
    expect(inferRegion('Régie', "Réseau d'assainissement")).toBeNull();
    // "sale" must not match inside "dessalement" → Rabat-Salé-Kénitra.
    expect(inferRegion('ONEE', "Station de dessalement d'eau de mer")).toBeNull();
  });

  test('still matches a real city token bounded by punctuation/spaces', () => {
    expect(inferRegion('Commune de Salé')).toBe('Rabat-Salé-Kénitra');
    expect(inferRegion('Province', "Aménagement à Tan-Tan")).toBe(
      'Guelmim-Oued Noun',
    );
  });
});

describe('buildInventory', () => {
  const records = [
    rec({ reference: 'A/1', buyerName: 'Commune de Rabat', procedure: 'AOO', objet: 'Voirie' }),
    rec({ reference: 'A/2', buyerName: 'Commune de Rabat', procedure: 'bons_de_commande', objet: 'Fournitures' }),
    rec({ reference: 'B/1', buyerName: 'ORMVA Souss', procedure: 'AOO', objet: 'Irrigation à Agadir' }),
    rec({ reference: 'C/1', buyerName: 'Ministère central', procedure: 'concours', objet: 'Étude générale' }),
  ];

  test('counts facets over the whole catalogue', () => {
    const inv = buildInventory(records, {}, NOW);
    expect(inv.total).toBe(4);
    expect(inv.filteredCount).toBe(4);

    const aoo = inv.facets.procedures.find((f) => f.key === 'AOO');
    expect(aoo).toEqual({ key: 'AOO', label: "Appel d'offres ouvert", count: 2 });

    const rabat = inv.facets.buyers.find((f) => f.key === 'Commune de Rabat');
    expect(rabat?.count).toBe(2);

    expect(inv.facets.regions.find((f) => f.key === 'Souss-Massa')?.count).toBe(1);
    expect(inv.facets.regions.find((f) => f.key === 'Non localisé')?.count).toBe(1);
  });

  test('filters items by procedure without shrinking facets', () => {
    const inv = buildInventory(records, { procedure: 'AOO' }, NOW);
    expect(inv.filteredCount).toBe(2);
    expect(inv.items.every((i) => i.procedure === 'AOO')).toBe(true);
    // Facets still describe the full catalogue.
    expect(inv.facets.procedures.find((f) => f.key === 'concours')?.count).toBe(1);
  });

  test('filters by buyer and by region', () => {
    expect(buildInventory(records, { buyer: 'Commune de Rabat' }, NOW).filteredCount).toBe(2);
    expect(buildInventory(records, { region: 'Souss-Massa' }, NOW).filteredCount).toBe(1);
  });

  test('free-text search spans reference, objet and buyer', () => {
    expect(buildInventory(records, { q: 'agadir' }, NOW).filteredCount).toBe(1);
    expect(buildInventory(records, { q: 'rabat' }, NOW).filteredCount).toBe(2);
    expect(buildInventory(records, { q: 'C/1' }, NOW).filteredCount).toBe(1);
  });

  test('orders items by deadline and exposes daysLeft + region', () => {
    const soon = rec({
      reference: 'SOON',
      buyerName: 'Commune de Safi',
      deadlineAt: new Date('2026-06-20T09:00:00Z'),
    });
    const inv = buildInventory([records[0]!, soon], {}, NOW);
    expect(inv.items[0]!.reference).toBe('SOON');
    expect(inv.items[0]!.daysLeft).toBe(7);
    expect(inv.items[0]!.region).toBe('Marrakech-Safi');
  });

  test('breaks equal-deadline ties deterministically by reference', () => {
    const day = new Date('2026-07-15T10:00:00Z');
    const inv = buildInventory(
      [
        rec({ reference: 'Z/9', deadlineAt: day }),
        rec({ reference: 'A/1', deadlineAt: day }),
        rec({ reference: 'M/5', deadlineAt: day }),
      ],
      {},
      NOW,
    );
    expect(inv.items.map((i) => i.reference)).toEqual(['A/1', 'M/5', 'Z/9']);
  });

  test('AND-combines filters', () => {
    const inv = buildInventory(
      records,
      { procedure: 'AOO', region: 'Souss-Massa' },
      NOW,
    );
    expect(inv.filteredCount).toBe(1);
    expect(inv.items[0]!.reference).toBe('B/1');
  });

  test('returns zero items but full facets on a no-match search', () => {
    const inv = buildInventory(records, { q: 'zzz-introuvable' }, NOW);
    expect(inv.filteredCount).toBe(0);
    expect(inv.items).toEqual([]);
    expect(inv.facets.procedures.find((f) => f.key === 'AOO')?.count).toBe(2);
  });

  test('search is accent-insensitive across the catalogue', () => {
    const inv = buildInventory(
      [rec({ reference: 'T/1', buyerName: 'Commune de Tétouan' })],
      { q: 'tetouan' },
      NOW,
    );
    expect(inv.filteredCount).toBe(1);
  });

  test('handles an empty catalogue', () => {
    const inv = buildInventory([], {}, NOW);
    expect(inv.total).toBe(0);
    expect(inv.filteredCount).toBe(0);
    expect(inv.items).toEqual([]);
    expect(inv.facets.procedures).toEqual([]);
    expect(inv.facets.regions).toEqual([]);
    expect(inv.facets.buyers).toEqual([]);
    expect(inv.facets.states).toEqual([]);
  });

  test('omits procedures with zero records from facets', () => {
    const inv = buildInventory(records, {}, NOW);
    expect(inv.facets.procedures.find((f) => f.key === 'AOR')).toBeUndefined();
  });

  test('caps buyer facets at 30 but keeps off-list buyers searchable', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      rec({ reference: `R/${i}`, buyerName: `Acheteur ${String(i).padStart(2, '0')}` }),
    );
    const inv = buildInventory(many, {}, NOW);
    expect(inv.facets.buyers).toHaveLength(30);
    // A buyer ranked outside the top-30 is absent from facets…
    const offList = 'Acheteur 39';
    expect(inv.facets.buyers.find((f) => f.key === offList)).toBeUndefined();
    // …but still filterable and findable via search.
    expect(buildInventory(many, { buyer: offList }, NOW).filteredCount).toBe(1);
    expect(buildInventory(many, { q: offList }, NOW).filteredCount).toBe(1);
  });

  test('caps returned items while keeping filteredCount accurate', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      rec({ reference: `P/${i}`, deadlineAt: new Date(`2026-08-0${i + 1}T09:00:00Z`) }),
    );
    const inv = buildInventory(many, {}, NOW, { limit: 2 });
    expect(inv.filteredCount).toBe(5);
    expect(inv.returnedCount).toBe(2);
    expect(inv.items).toHaveLength(2);
  });

  test('offset pages through the result set', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      rec({ reference: `P/${i}`, deadlineAt: new Date(`2026-08-0${i + 1}T09:00:00Z`) }),
    );
    const inv = buildInventory(many, {}, NOW, { limit: 2, offset: 2 });
    expect(inv.items.map((i) => i.reference)).toEqual(['P/2', 'P/3']);
  });
});
