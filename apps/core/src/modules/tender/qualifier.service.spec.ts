import { describe, expect, test } from 'vitest';
import { InMemoryTenderRepository } from './tender.repository';
import { QualifierService } from './qualifier.service';
import type { QualificationResult } from './qualifier.domain';

/**
 * runOnce() qualifies the detected/parsed backlog. qualify() reads ONLY base
 * columns (never `raw`), so the sweep must ride a lean candidate projection
 * (findQualificationCandidates, pipeline_state IN detected/parsed) — NOT
 * findAll(), which detoasts every tender's `raw` jsonb. After a big ingest the
 * whole catalogue can be in 'detected', so findAll() there would fold ~97k raw
 * blobs into JS and OOM the 792 MB core. This test poisons findAll to lock that in.
 */
describe('QualifierService.runOnce (candidate selection)', () => {
  const base = {
    buyerName: "Direction Régionale de l'Équipement de Marrakech",
    procedure: 'AOO' as const,
    objet: "Construction d'un pont sur oued N'Fis",
    location: 'Marrakech',
    deadlineAt: new Date('2026-12-01T09:00:00Z'),
    sourceUrl: 'https://x/q',
  };
  const fakeResult: QualificationResult = {
    verdict: 'qualified',
    checkedAt: new Date('2026-07-11T00:00:00Z').toISOString(),
    rules: [],
  };

  test('processes only detected+parsed, never the whole-catalogue findAll (OOM guard)', async () => {
    const repo = new InMemoryTenderRepository();
    // 1 detected (fresh), 1 parsed, plus 1 qualified + 1 rejected (both terminal
    // for the sweep — must be skipped).
    await repo.create({ ...base, reference: 'AO 01/2026/DET' });
    const parsed = await repo.create({ ...base, reference: 'AO 02/2026/PAR' });
    await repo.updateState(parsed.id, 'parsed');
    const qualified = await repo.create({ ...base, reference: 'AO 03/2026/QUA' });
    await repo.updateQualification(qualified.id, 'qualified', fakeResult);
    const rejected = await repo.create({ ...base, reference: 'AO 04/2026/REJ' });
    await repo.updateQualification(rejected.id, 'rejected', fakeResult);

    repo.findAll = () => {
      throw new Error('findAll() must not be called by the qualifier (OOM)');
    };

    const summary = await new QualifierService(repo).runOnce();

    // Only the detected + parsed rows are candidates.
    expect(summary.processed).toBe(2);
  });
});
