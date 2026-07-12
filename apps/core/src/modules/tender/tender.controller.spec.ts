import { describe, expect, test } from 'vitest';
import { InMemoryTenderRepository, type TenderRepository } from './tender.repository';
import { TenderController } from './tender.controller';

/**
 * `list()` (GET /tender/tenders — the "deadline wall") must ride the lean
 * `findAllInventoryRows()` projection, NOT `findAll()`. findAll() ships every
 * tender's toasted `raw`/`detail` jsonb (~97k rows), and folding that whole
 * catalogue into JS OOM-crashed the 792 MB core (the same class of bug that took
 * down the Assistant IA endpoint). These tests poison the heavy loader so they
 * fail the day someone reintroduces the whole-catalogue detoast on this path.
 */

/** Construct the controller with only the dependency `list()` touches (the
 *  repository). The other 12 injected deps are unused by this handler. */
function makeController(repo: TenderRepository): TenderController {
  const unused = undefined as never;
  return new TenderController(
    repo,
    unused, // qualifier
    unused, // enrichment
    unused, // dossierService
    unused, // dossierExtraction
    unused, // intel
    unused, // chat
    unused, // assistant
    unused, // pricing
    unused, // vault
    unused, // outcomes
    unused, // events
    unused, // liveParticipants
  );
}

async function seedTwoTenders(repo: InMemoryTenderRepository): Promise<void> {
  await repo.create({
    reference: 'AO 12/2026/DRETLH',
    buyerName: "Direction Régionale de l'Équipement de Marrakech",
    procedure: 'AOO',
    objet: "Construction d'un pont sur oued N'Fis",
    location: 'Marrakech',
    deadlineAt: new Date('2026-09-01T09:00:00Z'),
    sourceUrl: 'https://x/1',
  });
  await repo.create({
    reference: 'AO 07/2026/ORMVAO',
    buyerName: 'ORMVA de Ouarzazate',
    procedure: 'AOO',
    objet: "Travaux d'irrigation à Errachidia",
    location: 'Errachidia',
    deadlineAt: new Date('2026-08-01T09:00:00Z'),
    sourceUrl: 'https://x/2',
  });
}

describe('TenderController.list (deadline wall)', () => {
  test('returns every tender ordered by urgency with daysLeft', async () => {
    const repo = new InMemoryTenderRepository();
    await seedTwoTenders(repo);

    const rows = await makeController(repo).list();

    expect(rows).toHaveLength(2);
    // Soonest deadline first (urgency ordering).
    expect(rows[0]!.reference).toBe('AO 07/2026/ORMVAO');
    expect(rows[1]!.reference).toBe('AO 12/2026/DRETLH');
    // The deadline-wall contract: each row carries daysLeft.
    expect(rows[0]).toHaveProperty('daysLeft');
    expect(typeof rows[0]!.daysLeft).toBe('number');
  });

  test('uses the lean projection, never the whole-catalogue findAll (OOM guard)', async () => {
    const repo = new InMemoryTenderRepository();
    await seedTwoTenders(repo);
    // Poison the heavy loader: findAll() detoasts every tender's `raw` jsonb and
    // OOM-crashed the 792 MB core. list() must not call it.
    repo.findAll = () => {
      throw new Error('findAll() must not be called by list() (OOM)');
    };

    const rows = await makeController(repo).list();

    expect(rows).toHaveLength(2);
    // The lean projection omits the heavy `raw` jsonb — it never crosses the wire.
    expect(rows[0]).not.toHaveProperty('raw');
  });
});
