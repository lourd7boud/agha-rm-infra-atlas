import { describe, expect, test } from 'vitest';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import {
  buildInventory,
  hydrateInventory,
  inferCategory,
  inferLotCount,
  inferRegion,
  inferVille,
  selectInventory,
} from './inventory.domain';
import type { TenderRecord } from './tender.repository';

function rec(overrides: Partial<TenderRecord> & { reference: string }): TenderRecord {
  return {
    id: overrides.id ?? overrides.reference,
    reference: overrides.reference,
    buyerName: overrides.buyerName ?? 'Acheteur',
    procedure: (overrides.procedure ?? 'AOO') as TenderProcedure,
    objet: overrides.objet ?? 'Travaux divers',
    location: overrides.location,
    estimationMad: overrides.estimationMad,
    cautionProvisoireMad: overrides.cautionProvisoireMad,
    deadlineAt: overrides.deadlineAt ?? new Date('2026-08-01T09:00:00Z'),
    sourceUrl: overrides.sourceUrl,
    pipelineState: (overrides.pipelineState ?? 'detected') as PipelineState,
    qualification: null,
    raw: null,
    createdAt: overrides.createdAt ?? new Date('2026-06-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-06-01T00:00:00Z'),
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

  test("prefers the lieu d'exécution over buyer/objet for the region", () => {
    // National buyer with no regional keyword; the work is in Dakhla.
    expect(
      inferRegion("Ministère de l'Intérieur", 'Travaux divers', 'Dakhla'),
    ).toBe('Dakhla-Oued Ed-Dahab');
    // Location wins even when the buyer name points at another region.
    expect(inferRegion('Wilaya de Rabat', 'Travaux', 'Agadir')).toBe(
      'Souss-Massa',
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

  test('surfaces the lieu d\'exécution and uses it for the region', () => {
    const inv = buildInventory(
      [
        rec({
          reference: 'L/1',
          buyerName: 'Ministère central',
          objet: 'Travaux divers',
          location: 'Guelmim',
        }),
      ],
      {},
      NOW,
    );
    expect(inv.items[0]!.location).toBe('Guelmim');
    // Buyer/objet have no regional keyword; the region comes from the location.
    expect(inv.items[0]!.region).toBe('Guelmim-Oued Noun');
  });

  test('orders items by publication DESC (newest first) and exposes daysLeft + region', () => {
    // Newer publication wins over deadline urgency — matches datao's UX so a
    // fresh posting with a far-future deadline still shows on page 1 instead
    // of being buried behind soon-to-expire legacy rows. daysLeft is still
    // computed from deadlineAt regardless of sort.
    const fresh = rec({
      reference: 'FRESH',
      buyerName: 'Commune de Safi',
      deadlineAt: new Date('2026-07-30T09:00:00Z'),
      createdAt: new Date('2026-06-12T08:00:00Z'),
    });
    const old = rec({
      reference: 'OLD',
      buyerName: 'Commune de Marrakech',
      deadlineAt: new Date('2026-06-20T09:00:00Z'),
      createdAt: new Date('2026-05-01T08:00:00Z'),
    });
    const inv = buildInventory([old, fresh], {}, NOW);
    expect(inv.items[0]!.reference).toBe('FRESH');
    expect(inv.items[0]!.daysLeft).toBe(47);
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

  test('since returns only rows updated after the cutoff, total stays full', () => {
    const old = rec({
      reference: 'OLD/1',
      updatedAt: new Date('2026-06-10T00:00:00Z'),
    });
    const fresh = rec({
      reference: 'NEW/1',
      updatedAt: new Date('2026-06-12T00:00:00Z'),
    });
    const inv = buildInventory([old, fresh], { since: new Date('2026-06-11T00:00:00Z') }, NOW);
    // Only the row written after the cutoff is returned …
    expect(inv.items.map((i) => i.reference)).toEqual(['NEW/1']);
    // … but total + facets still reflect the whole catalogue.
    expect(inv.total).toBe(2);
    expect(inv.items[0]!.updatedAt).toBe('2026-06-12T00:00:00.000Z');
  });

  test('offset pages through the result set', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      rec({ reference: `P/${i}`, deadlineAt: new Date(`2026-08-0${i + 1}T09:00:00Z`) }),
    );
    const inv = buildInventory(many, {}, NOW, { limit: 2, offset: 2 });
    expect(inv.items.map((i) => i.reference)).toEqual(['P/2', 'P/3']);
  });

  test('enriches items with category, secteur, ville, lots, caution and publishedAt', () => {
    const created = new Date('2026-06-10T08:00:00Z');
    const inv = buildInventory(
      [
        {
          ...rec({
            reference: 'NAC/1',
            buyerName: 'Office Régional de Mise en Valeur Agricole du Haouz',
            objet: 'Acquisition du matériel de sécurité du réseau informatique',
            cautionProvisoireMad: 4000,
            sourceUrl: 'https://portal/tender/1',
          }),
          createdAt: created,
        },
      ],
      {},
      NOW,
    );
    const item = inv.items[0]!;
    expect(item.category).toBe('Fournitures');
    expect(item.secteur).toBe('Fournitures & équipements');
    expect(item.ville).toBe('Marrakech');
    expect(item.lotCount).toBe(1);
    expect(item.cautionProvisoireMad).toBe(4000);
    expect(item.sourceUrl).toBe('https://portal/tender/1');
    expect(item.publishedAt).toEqual(created);
  });

  test('exposes category and secteur facets over the catalogue', () => {
    const inv = buildInventory(records, {}, NOW);
    // Voirie + Irrigation → Travaux; Fournitures → Fournitures; Étude → Services.
    expect(inv.facets.categories.find((f) => f.key === 'Travaux')?.count).toBe(2);
    expect(inv.facets.categories.find((f) => f.key === 'Fournitures')?.count).toBe(1);
    expect(inv.facets.categories.find((f) => f.key === 'Services')?.count).toBe(1);
    expect(inv.facets.secteurs.length).toBeGreaterThan(0);
  });

  test('parses raw enrichment only for the page: item shows the AI secteur while the facet keeps the canonical deterministic label', () => {
    const raw = {
      aiEnrichment: {
        secteur: 'Génie civil spécialisé',
        resume: 'Résumé de test',
        faq: [],
        lots: [],
        conditions: {},
        reserveAuxPme: false,
        model: 'test-model',
        enrichedAt: '2026-06-01T00:00:00.000Z',
      },
    };
    const inv = buildInventory(
      [
        {
          ...rec({
            reference: 'E/1',
            buyerName: 'Commune de Rabat',
            objet: 'Travaux de voirie',
          }),
          raw,
        },
      ],
      {},
      NOW,
    );
    const item = inv.items[0]!;
    // The DISPLAYED secteur keeps the AI override (parsed from raw for the page)…
    expect(item.secteur).toBe('Génie civil spécialisé');
    expect(item.aiResume).toBe('Résumé de test');
    // …but the secteur FACET uses the canonical deterministic label (objet=voirie
    // → routes), so free-text AI values never fragment the navigation buckets.
    expect(
      inv.facets.secteurs.find((f) => f.key === 'Génie civil spécialisé'),
    ).toBeUndefined();
    expect(inv.facets.secteurs.some((f) => f.key === 'Routes & voirie')).toBe(true);
  });

  test('two-phase split: selectInventory on light rows + hydrateInventory from a SEPARATE full-record source (the controller path)', () => {
    const base = rec({
      reference: 'S/1',
      buyerName: 'Commune de Rabat',
      objet: 'Travaux de voirie',
    });
    // Phase 1: the projected list read has NO raw (raw-less light rows).
    const lightRow = { ...base, raw: undefined };
    const selection = selectInventory([lightRow], {}, NOW);
    expect(selection.pageIds).toEqual(['S/1']);
    // Phase 2: hydrate from the FULL record loaded separately (as findByIds
    // returns), carrying the heavy raw enrichment.
    const full = {
      ...base,
      raw: {
        aiEnrichment: {
          secteur: 'Secteur X',
          resume: 'Résumé',
          faq: [],
          lots: [],
          conditions: {},
          reserveAuxPme: false,
          model: 'test-model',
          enrichedAt: '2026-06-01T00:00:00.000Z',
        },
      },
    };
    const inv = hydrateInventory(selection, [full], NOW);
    expect(inv.items[0]!.secteur).toBe('Secteur X');
    expect(inv.items[0]!.aiResume).toBe('Résumé');
    // A page row whose full record is MISSING degrades to no enrichment, not a crash.
    const inv2 = hydrateInventory(selection, [], NOW);
    expect(inv2.items[0]!.secteur).toBe('Routes & voirie');
    expect(inv2.items[0]!.aiResume).toBeUndefined();
  });
});

describe('inferCategory', () => {
  test('an explicit "travaux" wins even with a service verb present', () => {
    expect(inferCategory("Travaux d'entretien des routes")).toBe('Travaux');
    expect(inferCategory('Travaux de signalisation horizontale')).toBe('Travaux');
  });

  test('supply verbs map to Fournitures', () => {
    expect(inferCategory('Acquisition du matériel de sécurité')).toBe('Fournitures');
    expect(inferCategory("Fourniture et équipement de bureau")).toBe('Fournitures');
    expect(inferCategory('Achat de matériel médico-technique')).toBe('Fournitures');
  });

  test('service verbs map to Services', () => {
    expect(inferCategory('Entretien bâtiments techniques, dératisation')).toBe('Services');
    expect(inferCategory("Assistance technique et accompagnement")).toBe('Services');
    expect(inferCategory('Réalisation des essais de contrôle et suivi de la qualité')).toBe(
      'Services',
    );
  });
});

describe('inferVille', () => {
  test('extracts the city from buyer or objet', () => {
    expect(inferVille('Commune de Jerada')).toBe('Jerada');
    expect(inferVille('Ministère X', "Construction d'une école à Dakhla")).toBe('Dakhla');
  });

  test('returns null when no city is present', () => {
    expect(inferVille('Direction Générale', 'Fourniture de matériel')).toBeNull();
  });
});

describe('inferLotCount', () => {
  test('parses numeric and spelled-out lot counts', () => {
    expect(inferLotCount("Travaux d'aménagement des voies en deux lots (02 lots)")).toBe(2);
    expect(inferLotCount('Prestations en 3 lots')).toBe(3);
  });

  test('defaults to a single lot', () => {
    expect(inferLotCount('Lot unique — acquisition de matériel')).toBe(1);
    expect(inferLotCount('Travaux divers')).toBe(1);
  });
});
