import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/client';
import { DETAIL_VERSION } from '../watch/detail.parser';
import {
  DrizzleTenderRepository,
  InMemoryTenderRepository,
  type CreateTender,
} from './tender.repository';

function makeInput(overrides: Partial<CreateTender> = {}): CreateTender {
  return {
    reference: 'AO-2026-001',
    buyerName: 'Commune de Test',
    procedure: 'AOO',
    objet: 'Travaux de voirie',
    deadlineAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

describe('published listing budget refresh', () => {
  it('classifies architectural procurement as services even when its subject mentions construction works', async () => {
    const repo = new InMemoryTenderRepository();
    const row = await repo.create(makeInput({ procedure: 'consultation_architecturale', objet: 'Conception architecturale et suivi des travaux de construction' }));
    expect(row.category).toBe('Services');
  });
  it('prefers a published portal category over a keyword classification', async () => {
    const repo = new InMemoryTenderRepository();
    const row = await repo.create(makeInput({ objet: 'Travaux de construction - controle et suivi' }));
    await repo.updateEnrichment(row.id, {}, { detail: { categorie: 'Services' } });
    expect((await repo.findById(row.id))?.category).toBe('Services');
    await repo.updateEnrichment(row.id, {}, { detail: { categorie: 'inconnue' } });
    expect((await repo.findById(row.id))?.category).toBe('Services');
  });
  it('retains a verified portal category when a later listing refresh changes the deadline', async () => {
    const repo = new InMemoryTenderRepository();
    const input = makeInput({ sourceUrl: 'https://portal/category' });
    const row = await repo.create(input);
    await repo.updateEnrichment(row.id, {}, { detail: { categorie: 'Services' } });
    await repo.updateEnrichment(row.id, {}, { detail: { categorie: null } });
    await repo.updateEnrichment(row.id, {}, { detail: { categorie: 'inconnue' } });
    await repo.healListingBySourceUrl(input.sourceUrl!, { ...input, deadlineAt: new Date('2030-01-01') });
    expect((await repo.findById(row.id))?.category).toBe('Services');
  });
  it('revisits active metadata after a day so rectifications can be detected', async () => {
    const repo = new InMemoryTenderRepository();
    const row = await repo.create(makeInput({ sourceUrl: 'https://portal/active', deadlineAt: new Date('2030-01-01') }));
    await repo.updateEnrichment(row.id, {}, { detail: { v: DETAIL_VERSION, fetchedAt: '2000-01-01T00:00:00.000Z' } });
    expect((await repo.findDetailBackfillTargets(5)).map((r) => r.id)).toContain(row.id);
  });
  it('updates a changed portal budget without duplicating the tender or erasing it on a missing amount', async () => {
    const repo = new InMemoryTenderRepository();
    const input = makeInput({ sourceUrl: 'https://portal/consultation/1', estimationMad: 100 });
    const stored = await repo.create(input);
    expect(await repo.healListingBySourceUrl(input.sourceUrl!, { ...input, estimationMad: 200 })).toBe(true);
    expect((await repo.findById(stored.id))?.estimationMad).toBe(200);
    await repo.healListingBySourceUrl(input.sourceUrl!, { ...input, estimationMad: undefined, objet: 'Travaux actualisés' });
    expect((await repo.findById(stored.id))?.estimationMad).toBe(200);
    expect(await repo.findAll()).toHaveLength(1);
  });
});

// Minimal row satisfying toRecord() so stubbed selects/updates round-trip.
const DB_ROW = {
  id: 'row-1',
  reference: 'AO-2026-001',
  buyerName: 'Commune de Test',
  procedure: 'AOO',
  objet: 'Travaux de voirie',
  location: null,
  estimationMad: null,
  cautionProvisoireMad: null,
  deadlineAt: new Date('2026-08-01T10:00:00Z'),
  sourceUrl: null,
  pipelineState: 'detected',
  qualification: null,
  raw: { aiEnrichment: { resume: 'kept' } },
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
};

/**
 * Call-counting stub standing in for the drizzle Db. Lets the spec assert HOW
 * the repository talks to Postgres (single atomic statement vs read-then-write)
 * without a live database.
 */
function stubDb() {
  const calls = { select: 0, update: 0 };
  let lastSetPayload: Record<string, unknown> | null = null;
  let lastWhere: SQL | undefined;
  const db = {
    select: (..._args: unknown[]) => {
      calls.select += 1;
      return {
        from: () => ({
          where: () => {
            const rows = [DB_ROW];
            return Object.assign(Promise.resolve(rows), {
              limit: async () => rows,
            });
          },
        }),
      };
    },
    update: () => {
      calls.update += 1;
      return {
        set: (payload: Record<string, unknown>) => {
          lastSetPayload = payload;
          return {
            where: (condition: SQL) => { lastWhere = condition; return { returning: async () => [DB_ROW] }; },
          };
        },
      };
    },
  } as unknown as Db;
  return {
    db,
    calls,
    get lastSetPayload() {
      return lastSetPayload;
    },
    get lastWhere() { return lastWhere; },
  };
}

describe('InMemoryTenderRepository.findByIds', () => {
  it('returns the matching records in one call and skips unknown ids', async () => {
    const repo = new InMemoryTenderRepository();
    const a = await repo.create(makeInput());
    const b = await repo.create(
      makeInput({ reference: 'AO-2026-002', objet: 'Assainissement' }),
    );

    const found = await repo.findByIds([b.id, 'does-not-exist', a.id]);

    expect(found.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('returns an empty array for empty input', async () => {
    const repo = new InMemoryTenderRepository();
    await repo.create(makeInput());

    expect(await repo.findByIds([])).toEqual([]);
  });
});

describe('DrizzleTenderRepository.findByIds', () => {
  it('issues exactly one SELECT for any number of ids (no N+1)', async () => {
    const stub = stubDb();
    const repo = new DrizzleTenderRepository(stub.db);

    const records = await repo.findByIds(['row-1', 'row-2', 'row-3']);

    // The stub returns a fixed row set, so this test only guarantees the
    // round-trip COUNT (no N+1) and the toRecord mapping — WHERE-clause
    // filtering is covered by the InMemory tests above.
    expect(stub.calls.select).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe('row-1');
  });

  it('short-circuits to [] on empty input without touching the db', async () => {
    const stub = stubDb();
    const repo = new DrizzleTenderRepository(stub.db);

    expect(await repo.findByIds([])).toEqual([]);
    expect(stub.calls.select).toBe(0);
  });
});

describe('DrizzleTenderRepository.updateEnrichment', () => {
  it('guards the dossier generation in the same atomic UPDATE statement', async () => {
    const stub = stubDb();
    const repo = new DrizzleTenderRepository(stub.db);
    const expectedDossier = { objectKey: 'dossiers/row-1.zip', downloadedAt: '2026-11-10T10:00:00Z' };
    await repo.updateEnrichment('row-1', {}, { dossierExtraction: { bpu: [] } }, { expectedDossier });
    const query = new PgDialect().sqlToQuery(stub.lastWhere!);
    expect(stub.calls).toEqual({ select: 0, update: 1 });
    expect(query.sql).toContain("->'dossier'");
    expect(query.sql.toLowerCase()).toContain('coalesce');
    expect(query.params).toContain(JSON.stringify(expectedDossier));
  });
  it('merges raw atomically in ONE statement — no read-then-write window', async () => {
    const stub = stubDb();
    const repo = new DrizzleTenderRepository(stub.db);

    const result = await repo.updateEnrichment(
      'row-1',
      { estimationMad: 250_000 },
      { dossierExtraction: { budget: 250_000 } },
    );

    // The lost-update race exists precisely because the old code SELECTed the
    // row, merged raw in JS, then UPDATEd. Atomic = zero selects, one update.
    expect(stub.calls.select).toBe(0);
    expect(stub.calls.update).toBe(1);
    expect(result).not.toBeNull();

    // raw must be a SQL expression (jsonb || merge server-side), not a plain
    // JS object computed from a stale read.
    const payload = stub.lastSetPayload!;
    expect(payload.raw).toBeInstanceOf(SQL);
    expect(payload.estimationMad).toBe('250000');
    expect(payload.updatedAt).toBeInstanceOf(Date);
  });
});

describe('InMemoryTenderRepository.updateEnrichment (merge semantics)', () => {
  it('rejects stale extraction and attempt writes without restoring old amounts or fields', async () => {
    const repo = new InMemoryTenderRepository();
    const oldDossier = { objectKey: 'dossiers/test.zip', downloadedAt: '2026-11-10T10:00:00Z' };
    const newDossier = { ...oldDossier, downloadedAt: '2026-11-13T10:00:00Z' };
    const t = await repo.create(makeInput());
    await repo.updateEnrichment(t.id, {}, { dossier: oldDossier });
    await repo.updateEnrichment(t.id, {}, { dossier: newDossier, dossierExtraction: null });
    expect(await repo.updateEnrichment(t.id, { estimationMad: 123456 }, { dossierExtraction: { obsolete: true } }, { expectedDossier: oldDossier })).toBeNull();
    expect(await repo.updateEnrichment(t.id, {}, { dossierExtractAttempt: { at: 'old-run' } }, { expectedDossier: oldDossier })).toBeNull();
    const after = await repo.findById(t.id);
    expect(after?.raw?.dossierExtraction).toBeNull();
    expect(after?.raw?.dossierExtractAttempt).toBeUndefined();
    expect(after?.estimationMad).toBeUndefined();
    expect(await repo.updateEnrichment(t.id, {}, { dossierText: 'current source' }, { expectedDossier: newDossier })).not.toBeNull();
  });

  it('matches absent metadata as null and clears the BPU flag on invalidation', async () => {
    const repo = new InMemoryTenderRepository();
    const t = await repo.create(makeInput());
    expect(await repo.updateEnrichment(t.id, {}, { dossierText: 'transient source' }, { expectedDossier: null })).not.toBeNull();
    await repo.updateEnrichment(t.id, {}, { dossierExtraction: {
      bpu: [{ designation: 'old source', quantite: 1, unite: 'U', prixUnitaireMad: 1200 }], qualifications: [],
      model: 'test', extractedAt: '2026-11-10T10:00:00Z', sourceFiles: ['RC.pdf'],
    } });
    expect((await repo.findById(t.id))?.hasBpu).toBe(true);
    await repo.updateEnrichment(t.id, {}, { dossierExtraction: null });
    expect((await repo.findById(t.id))?.hasBpu).toBe(false);
  });
  it('preserves keys written by an earlier merge when a later merge adds different keys', async () => {
    const repo = new InMemoryTenderRepository();
    const t = await repo.create(makeInput());

    await repo.updateEnrichment(t.id, {}, { aiEnrichment: { resume: 'A' } });
    await repo.updateEnrichment(t.id, {}, { dossierExtraction: { budget: 1 } });

    const after = await repo.findById(t.id);
    expect(after?.raw).toMatchObject({
      aiEnrichment: { resume: 'A' },
      dossierExtraction: { budget: 1 },
    });
  });

  it('documents the SHALLOW merge contract: re-writing a top-level key replaces it whole', async () => {
    // Both impls share this contract (JS spread in-memory, jsonb || in SQL):
    // callers must write a COMPLETE object per top-level key — sub-keys from
    // an earlier write under the SAME key are intentionally not deep-merged.
    const repo = new InMemoryTenderRepository();
    const t = await repo.create(makeInput());

    await repo.updateEnrichment(t.id, {}, { aiEnrichment: { resume: 'A', cost: 1 } });
    await repo.updateEnrichment(t.id, {}, { aiEnrichment: { lots: ['L1'] } });

    const after = await repo.findById(t.id);
    expect(after?.raw?.aiEnrichment).toEqual({ lots: ['L1'] });
    expect(after?.raw?.aiEnrichment).not.toHaveProperty('resume');
  });
});
