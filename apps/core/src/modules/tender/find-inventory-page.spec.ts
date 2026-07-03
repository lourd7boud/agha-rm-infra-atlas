import { describe, expect, test } from 'vitest';
import type { CompetitorBidRecord } from '../intel/intel.repository';
import {
  buildInventory,
  classifyForStorage,
  type InventoryRow,
} from './inventory.domain';
import {
  InMemoryTenderRepository,
  type CreateTender,
} from './tender.repository';

const NOW = new Date('2026-06-13T00:00:00Z');

function input(overrides: Partial<CreateTender> & { reference: string }): CreateTender {
  return {
    reference: overrides.reference,
    buyerName: overrides.buyerName ?? 'Acheteur',
    procedure: overrides.procedure ?? 'AOO',
    objet: overrides.objet ?? 'Travaux divers',
    location: overrides.location,
    estimationMad: overrides.estimationMad,
    cautionProvisoireMad: overrides.cautionProvisoireMad,
    deadlineAt: overrides.deadlineAt ?? new Date('2026-08-01T09:00:00Z'),
    sourceUrl: overrides.sourceUrl,
  };
}

/** Seeds an InMemory repo with a small, deliberately-shaped catalogue. */
async function seed(): Promise<InMemoryTenderRepository> {
  const repo = new InMemoryTenderRepository();
  await repo.create(
    input({ reference: 'A/1', buyerName: 'Commune de Rabat', objet: 'Voirie' }),
  );
  await repo.create(
    input({
      reference: 'A/2',
      buyerName: 'Commune de Rabat',
      procedure: 'bons_de_commande',
      objet: 'Fournitures de bureau',
    }),
  );
  await repo.create(
    input({
      reference: 'B/1',
      buyerName: 'ORMVA Souss',
      objet: 'Irrigation à Agadir',
    }),
  );
  await repo.create(
    input({
      reference: 'C/1',
      buyerName: 'Ministère central',
      procedure: 'concours',
      objet: 'Étude générale',
    }),
  );
  return repo;
}

describe('write-path classification (InMemory parity with the Drizzle SQL)', () => {
  test('create() stores the denormalized classification columns', async () => {
    const repo = new InMemoryTenderRepository();
    const created = await repo.create(
      input({
        reference: 'CLS/1',
        buyerName: 'Commune de Rabat',
        objet: 'Travaux de voirie',
      }),
    );
    const expected = classifyForStorage({
      buyerName: 'Commune de Rabat',
      objet: 'Travaux de voirie',
      location: null,
    });
    expect(created.region).toBe(expected.region); // Rabat-Salé-Kénitra
    expect(created.category).toBe(expected.category); // Travaux
    expect(created.secteur).toBe(expected.secteur); // Routes & voirie
    expect(created.lotCount).toBe(expected.lotCount);
    expect(created.hasBpu).toBe(false);
  });

  test('healListingBySourceUrl() re-classifies from the corrected listing', async () => {
    const repo = new InMemoryTenderRepository();
    // Ingested wrong: buyerName carried the lieu, objet was mislabelled.
    await repo.create(
      input({
        reference: 'HEAL/1',
        buyerName: 'Agadir',
        objet: 'Fourniture de matériel',
        sourceUrl: 'https://portal/heal/1',
      }),
    );
    const healed = await repo.healListingBySourceUrl('https://portal/heal/1', {
      reference: 'HEAL/1',
      buyerName: 'Commune de Tétouan',
      procedure: 'AOO',
      objet: 'Travaux de voirie urbaine',
      location: 'Tétouan',
      deadlineAt: new Date('2026-08-01T09:00:00Z'),
    });
    expect(healed).toBe(true);
    const [row] = await repo.findAllInventoryRows();
    expect(row!.region).toBe('Tanger-Tétouan-Al Hoceïma');
    expect(row!.category).toBe('Travaux');
    expect(row!.secteur).toBe('Routes & voirie');
  });

  test('updateEnrichment() recomputes has_bpu from the merged dossier', async () => {
    const repo = new InMemoryTenderRepository();
    const t = await repo.create(input({ reference: 'BPU/1' }));
    expect((await repo.findById(t.id))!.hasBpu).toBe(false);

    await repo.updateEnrichment(
      t.id,
      {},
      {
        dossierExtraction: {
          bpu: [
            { designation: 'Béton', quantite: 10, unite: 'm3', prixUnitaireMad: 900 },
          ],
          qualifications: [],
          conditionsLegales: [],
          autres: [],
          model: 'test',
          extractedAt: '2026-06-01T00:00:00.000Z',
          sourceFiles: [],
        },
      },
    );
    expect((await repo.findById(t.id))!.hasBpu).toBe(true);
  });
});

describe('findInventoryPage (InMemory, contract parity with the JS pipeline)', () => {
  test('preserves the exact response shape', async () => {
    const repo = await seed();
    const page = await repo.findInventoryPage({}, {}, NOW, []);
    expect(Object.keys(page).sort()).toEqual(
      ['facets', 'filteredCount', 'filters', 'items', 'returnedCount', 'total'].sort(),
    );
    expect(page.total).toBe(4);
    expect(page.filteredCount).toBe(4);
    expect(page.returnedCount).toBe(4);
  });

  test('filters by category AND region together', async () => {
    const repo = await seed();
    // B/1 = Travaux in Souss-Massa (Agadir). A/1 = Travaux but Rabat.
    const page = await repo.findInventoryPage(
      { categories: ['Travaux'], region: 'Souss-Massa' },
      {},
      NOW,
      [],
    );
    expect(page.filteredCount).toBe(1);
    expect(page.items.map((i) => i.reference)).toEqual(['B/1']);
    // Facets still describe the whole catalogue.
    expect(page.facets.categories.find((f) => f.key === 'Fournitures')?.count).toBe(1);
  });

  test('sorts by buyer asc, reference breaks ties', async () => {
    const repo = await seed();
    const page = await repo.findInventoryPage(
      { sort: 'buyer', dir: 'asc' },
      {},
      NOW,
      [],
    );
    // Commune de Rabat (A/1, A/2), Ministère central (C/1), ORMVA Souss (B/1).
    expect(page.items.map((i) => i.reference)).toEqual(['A/1', 'A/2', 'C/1', 'B/1']);
  });

  test('paginates the sorted result set', async () => {
    const repo = new InMemoryTenderRepository();
    for (let i = 0; i < 5; i += 1) {
      await repo.create(
        input({
          reference: `P/${i}`,
          deadlineAt: new Date(`2026-08-0${i + 1}T09:00:00Z`),
        }),
      );
    }
    const page = await repo.findInventoryPage(
      { sort: 'deadline', dir: 'asc' },
      { limit: 2, offset: 2 },
      NOW,
      [],
    );
    expect(page.filteredCount).toBe(5);
    expect(page.returnedCount).toBe(2);
    expect(page.items.map((i) => i.reference)).toEqual(['P/2', 'P/3']);
  });

  test('facet counts span the whole catalogue even under an active filter', async () => {
    const repo = await seed();
    const page = await repo.findInventoryPage({ procedure: 'AOO' }, {}, NOW, []);
    expect(page.filteredCount).toBe(2); // A/1, B/1
    expect(page.facets.procedures.find((f) => f.key === 'concours')?.count).toBe(1);
    expect(page.facets.regions.find((f) => f.key === 'Souss-Massa')?.count).toBe(1);
    expect(page.facets.buyers.find((f) => f.key === 'Commune de Rabat')?.count).toBe(2);
  });

  test('lifecycle status + facet come from the bid set (attribué when a winner exists)', async () => {
    const repo = new InMemoryTenderRepository();
    const won = await repo.create(
      input({ reference: 'W/1', deadlineAt: new Date('2026-05-01T09:00:00Z') }),
    );
    const bids: CompetitorBidRecord[] = [
      {
        id: 'bid-1',
        reference: 'W/1',
        buyerName: 'Acheteur',
        bidderName: 'Concurrent A',
        competitorId: 'c1',
        amountMad: 100,
        isWinner: true,
        resultDate: new Date('2026-05-10T00:00:00Z'),
        createdAt: new Date('2026-05-10T00:00:00Z'),
      },
    ];
    const page = await repo.findInventoryPage({}, {}, NOW, bids);
    const item = page.items.find((i) => i.reference === 'W/1')!;
    expect(item.lifecycleStatus).toBe('attribue');
    expect(item.winner?.bidderName).toBe('Concurrent A');
    expect(page.facets.lifecycles.find((f) => f.key === 'attribue')?.count).toBe(1);
    expect(won.id).toBe(item.id);
  });
});

describe('NULL-column fallback (pre-backfill correctness)', () => {
  test('classify falls back to on-the-fly inference PER FIELD when a stored column is null', () => {
    // A projected row with NO stored classification (as a legacy row reads before
    // the backfill): every dimension must still resolve via inference.
    const row: InventoryRow = {
      id: 'legacy-1',
      reference: 'L/1',
      buyerName: 'Commune de Tétouan',
      procedure: 'AOO',
      objet: 'Travaux de voirie urbaine',
      deadlineAt: new Date('2026-08-01T09:00:00Z'),
      pipelineState: 'detected',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
      region: null,
      ville: null,
      category: null,
      secteur: null,
      lotCount: null,
    };
    const inv = buildInventory([row], {}, NOW);
    const item = inv.items[0]!;
    expect(item.region).toBe('Tanger-Tétouan-Al Hoceïma');
    expect(item.category).toBe('Travaux');
    expect(item.secteur).toBe('Routes & voirie');
    // And the facet built from the fallback classification matches.
    expect(
      inv.facets.regions.find((f) => f.key === 'Tanger-Tétouan-Al Hoceïma')?.count,
    ).toBe(1);
    expect(inv.facets.categories.find((f) => f.key === 'Travaux')?.count).toBe(1);
  });

  test('a stored classification column overrides inference (denormalized value wins)', () => {
    // Stored region deliberately DIFFERS from what inference would produce, proving
    // the read path trusts the column when present.
    const row: InventoryRow = {
      id: 'stored-1',
      reference: 'S/1',
      buyerName: 'Commune de Tétouan',
      procedure: 'AOO',
      objet: 'Travaux de voirie',
      deadlineAt: new Date('2026-08-01T09:00:00Z'),
      pipelineState: 'detected',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
      region: 'Casablanca-Settat',
      ville: 'Casablanca',
      category: 'Services',
      secteur: 'Génie civil',
      lotCount: 3,
    };
    const inv = buildInventory([row], {}, NOW);
    const item = inv.items[0]!;
    expect(item.region).toBe('Casablanca-Settat');
    expect(item.category).toBe('Services');
    expect(item.secteur).toBe('Génie civil');
    expect(item.lotCount).toBe(3);
  });
});
