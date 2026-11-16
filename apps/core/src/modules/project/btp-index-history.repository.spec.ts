import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '../../db/client';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';
import { DrizzleBtpExecutionRepository } from './btp.repository';
import { selectPublishedIndexes, type PublishedIndexes } from './btp-revision.domain';

const url = process.env.BTP_INDEX_INTEGRATION_DATABASE_URL;
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const actor = { sub: 'index-history-test', name: 'Index history test' };
const publication = { monthDate: date('2026-01-01'), source: 'DATRP/2026-01', publishedOn: '2026-02-05', status: 'definitif' };

describe.skipIf(!url)('index correction history (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool) as Db;
  const registers = new DrizzleBtpRegistresRepository(db);
  const execution = new DrizzleBtpExecutionRepository(db);

  beforeEach(async () => {
    if (new URL(url!).pathname !== '/atlas_btp_index_test') throw new Error('Dedicated disposable index database required');
    await pool.query('TRUNCATE project.project, project.revision_index, project.revision_formula, project.revision_index_audit CASCADE');
  });
  afterAll(async () => { await pool.end(); });

  it('preserves same-metadata values and before/after audit while selecting the current correction first', async () => {
    await registers.upsertIndexMonth({ ...publication, indexValues: { TEST: 125, A: 1 } }, actor);
    await registers.upsertIndexMonth({ ...publication, indexValues: { A: 1, TEST: 150 } }, actor);
    const row = (await pool.query("SELECT * FROM project.revision_index WHERE month_date='2026-01-01'")).rows[0];
    expect(row.index_values).toEqual({ TEST: 150, A: 1 });
    expect(row.previous_publications).toEqual([{
      values: { TEST: 125, A: 1 }, status: publication.status, source: publication.source, publishedOn: publication.publishedOn,
    }]);
    const audit = (await pool.query("SELECT changes FROM project.revision_index_audit WHERE action='update' ORDER BY created_at DESC LIMIT 1")).rows[0].changes;
    expect(audit).toMatchObject({
      before: { indexValues: { TEST: 125, A: 1 }, status: 'definitif', source: publication.source, publishedOn: publication.publishedOn },
      after: { indexValues: { TEST: 150, A: 1 }, status: 'definitif', source: publication.source, publishedOn: publication.publishedOn },
    });
    const latest: PublishedIndexes = { values: row.index_values, status: row.status, source: row.source, publishedOn: publication.publishedOn };
    expect(selectPublishedIndexes(new Map([['2026-01', [latest, ...row.previous_publications]]]), '2026-01', ['TEST'], '2026-02-10', false)?.values.TEST).toBe(150);
    await registers.upsertIndexMonth({ ...publication, indexValues: { TEST: 150, A: 1 } }, actor);
    const unchanged = (await pool.query("SELECT previous_publications FROM project.revision_index WHERE month_date='2026-01-01'")).rows[0];
    expect(unchanged.previous_publications).toHaveLength(1);
  });

  it('recalculates a draft with corrected values while keeping validated values and trace intact', async () => {
    await registers.upsertIndexMonth({ ...publication, indexValues: { TEST: 125 } }, actor);
    const formula = await registers.saveFormula({ name: 'CPS correction test', fixedPart: 0.2, weights: { TEST: 0.8 } });
    const statements: { projectId: string; decompteId: string }[] = [];
    for (let index = 0; index < 2; index++) {
      const projectId = randomUUID();
      await pool.query("INSERT INTO project.project(id,reference,name,buyer_name,montant_marche_mad,ordre_service_date) VALUES($1,'TEST-IDX','Index test','Test',0,'2025-12-31')", [projectId]);
      await execution.saveBordereau(projectId, { lignes: [{ id: 'line-1', numero: 1, designation: 'Ouvrage', unite: 'U', quantite: 10, prixUnitaire: 100 }] });
      await registers.saveRevisionConfig(projectId, { formulaId: formula.id, isEnabled: true, baseDate: date('2025-12-15'), baseIndexes: { TEST: 100 } });
      const period = await execution.createPeriode(projectId, { dateFin: date('2026-01-31'), tauxRetenue: 0 });
      await execution.saveMetres(projectId, period.periode.id, [{ bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'measure', nombre: 10 }] }]);
      await execution.patchDecompte(projectId, period.decompte.id, { dateDecompte: date('2026-02-10'), ...(index === 0 ? { statut: 'validated' } : {}) });
      statements.push({ projectId, decompteId: period.decompte.id });
    }
    const locked = statements[0]!;
    const draft = statements[1]!;
    const before = await execution.getDecompte(locked.decompteId);
    expect(before?.revisionMontantMad).toBe(200);
    await registers.upsertIndexMonth({ ...publication, indexValues: { TEST: 150 } }, actor);
    const after = await execution.getDecompte(locked.decompteId);
    expect(after?.revisionMontantMad).toBe(200);
    expect(after?.revision).toEqual(before?.revision);
    expect((await execution.getDecompte(draft.decompteId))?.revisionMontantMad).toBe(400);
  });
});
