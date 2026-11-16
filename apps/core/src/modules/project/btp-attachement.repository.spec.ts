import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '../../db/client';
import { DrizzleBtpExecutionRepository } from './btp.repository';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';

const url = process.env.TERRAIN_INTEGRATION_DATABASE_URL;
describe.skipIf(!url)('terrain official measurement integration (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const repo = new DrizzleBtpExecutionRepository(drizzle(pool) as Db);
  let projectId: string, periodId: string, attachmentId: string;
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/atlas_terrain_integration_test') throw new Error('Dedicated disposable database required');
  });
  beforeEach(async () => {
    projectId = randomUUID(); attachmentId = randomUUID();
    await pool.query("INSERT INTO project.project(id,reference,name,buyer_name,montant_marche_mad) VALUES($1,'TEST','Terrain test','Test',12000)", [projectId]);
    await repo.saveBordereau(projectId, { lignes: [{ id: 'line-1', numero: 1, designation: 'Canal', unite: 'ML', quantite: 100, prixUnitaire: 100 }] });
    periodId = (await repo.createPeriode(projectId, {})).periode.id;
    await pool.query("INSERT INTO project.chantier_attachement(id,project_id,date,ligne_id,designation,unite,quantite,saisi_par) VALUES($1,$2,'2026-10-27','line-1','Canal','ML',12.5,'chef')", [attachmentId, projectId]);
  });
  afterAll(async () => { await pool.end(); });
  it('links real quantity and rebuilds the decompte once on retry', async () => {
    const result = await repo.integrateTerrainAttachement(projectId, attachmentId, periodId, 'bureau');
    expect(await repo.integrateTerrainAttachement(projectId, attachmentId, periodId, 'bureau')).toEqual(result);
    const context = await repo.getMetreContext(projectId, periodId);
    expect(context?.metres[0]?.totalPartiel).toBe(12.5);
    expect((await repo.listDecomptes(projectId))[0]?.totalTtcMad).toBe(1500);
    expect((await pool.query('SELECT metre_id,integrated_by FROM project.chantier_attachement WHERE id=$1', [attachmentId])).rows[0]).toEqual({ metre_id: result.metreId, integrated_by: 'bureau' });
    await expect(repo.deletePeriode(projectId, periodId)).rejects.toThrow(/terrain/i);
  });
  it('rejects foreign references and refuses to rewrite a later locked decompte', async () => {
    await expect(repo.integrateTerrainAttachement(randomUUID(), attachmentId, periodId, 'bureau')).rejects.toThrow();
    const later = await repo.createPeriode(projectId, {});
    await pool.query("UPDATE project.decompte SET statut='validated' WHERE periode_id=$1", [later.periode.id]);
    await expect(repo.integrateTerrainAttachement(projectId, attachmentId, periodId, 'bureau')).rejects.toThrow(/ultérieur/i);
    expect((await repo.getMetreContext(projectId, periodId))?.metres).toHaveLength(0);
  });
  it('protects a linked source against duplicate or altered office measurement input', async () => {
    await repo.integrateTerrainAttachement(projectId, attachmentId, periodId, 'bureau');
    const m = (await repo.getMetreContext(projectId, periodId))!.metres[0]!;
    await expect(repo.saveMetres(projectId, periodId, [{ bordereauLigneId: m.bordereauLigneId, sections: m.sections, sousSections: m.sousSections, lignes: [...m.lignes, ...m.lignes] }])).rejects.toThrow(/dupliqu/i);
    await expect(repo.saveMetres(projectId, periodId, [{ bordereauLigneId: m.bordereauLigneId, sections: m.sections, sousSections: m.sousSections, lignes: [] }])).rejects.toThrow(/terrain/i);
    expect((await repo.listDecomptes(projectId))[0]?.totalTtcMad).toBe(1500);
  });
  it('does not append quantities for a legacy integrated flag without a measurement link', async () => {
    await pool.query("UPDATE project.chantier_attachement SET statut='integre' WHERE id=$1", [attachmentId]);
    await expect(repo.integrateTerrainAttachement(projectId, attachmentId, periodId, 'bureau')).rejects.toThrow(/Ancien marquage/);
    expect((await repo.getMetreContext(projectId, periodId))?.metres).toHaveLength(0);
  });

  async function createDatedBatch() {
    await repo.updateFiche(projectId, { executionStartDate: new Date('2026-10-01') });
    await repo.updatePeriode(projectId, periodId, { dateFin: new Date('2026-10-25') });
    const next = (await repo.createPeriode(projectId, { dateFin: new Date('2026-10-31') })).periode.id;
    const secondId = randomUUID();
    await pool.query("INSERT INTO project.chantier_attachement(id,project_id,date,ligne_id,designation,unite,quantite,saisi_par) VALUES($1,$2,'2026-10-31','line-1','Canal','ML',7.5,'chef')", [secondId, projectId]);
    return { next, secondId };
  }

  it('integrates a dated batch atomically and safely retries overlapping or duplicate IDs', async () => {
    const { next, secondId } = await createDatedBatch();
    const selection = [attachmentId, secondId, attachmentId.toUpperCase()];
    const [first, retry] = await Promise.all([
      repo.integrateTerrainAttachements(projectId, selection, next, 'bureau'),
      repo.integrateTerrainAttachements(projectId, selection, next, 'bureau'),
    ]);
    expect(first).toEqual(retry);
    expect(first.attachements).toHaveLength(2);
    const context = await repo.getMetreContext(projectId, next);
    expect(context?.metres[0]?.totalPartiel).toBe(20);
    expect((await repo.listDecomptes(projectId)).at(-1)?.totalTtcMad).toBe(2400);
    await expect(repo.integrateTerrainAttachements(projectId, [attachmentId], periodId, 'bureau')).rejects.toThrow(/autre métré/i);
    await pool.query("UPDATE project.decompte SET statut='validated' WHERE periode_id=$1", [next]);
    expect(await repo.integrateTerrainAttachements(projectId, selection, next, 'bureau')).toEqual(first);
  });

  it('rejects missing, foreign or out-of-window records without integrating any selected source', async () => {
    await expect(repo.integrateTerrainAttachements(projectId, [attachmentId], periodId, 'bureau')).rejects.toThrow(/dates|début/i);
    const { next, secondId } = await createDatedBatch();
    const wrongDay = new Date('2026-10-25');
    await pool.query('UPDATE project.chantier_attachement SET date=$1 WHERE id=$2', [wrongDay, secondId]);
    await expect(repo.integrateTerrainAttachements(projectId, [attachmentId, secondId], next, 'bureau')).rejects.toThrow(/date/i);
    await expect(repo.integrateTerrainAttachements(projectId, [attachmentId, randomUUID()], next, 'bureau')).rejects.toThrow(/projet/i);
    expect((await repo.getMetreContext(projectId, next))?.metres).toHaveLength(0);
    expect((await pool.query('SELECT metre_id FROM project.chantier_attachement WHERE id=$1', [attachmentId])).rows[0]?.metre_id).toBeNull();
  });

  it('rolls back the first attachment when a later one no longer matches the BPU', async () => {
    const { next, secondId } = await createDatedBatch();
    const selection = [attachmentId, secondId].sort();
    await pool.query("UPDATE project.chantier_attachement SET unite='KG' WHERE id=$1", [selection[1]]);
    await expect(repo.integrateTerrainAttachements(projectId, selection, next, 'bureau')).rejects.toThrow(/unité/i);
    expect((await repo.getMetreContext(projectId, next))?.metres).toHaveLength(0);
    for (const id of selection) {
      expect((await pool.query('SELECT metre_id FROM project.chantier_attachement WHERE id=$1', [id])).rows[0]?.metre_id).toBeNull();
    }
  });

  it('checks known date bounds when integrating a single attachment via the legacy endpoint', async () => {
    const { next } = await createDatedBatch();
    await expect(repo.integrateTerrainAttachement(projectId, attachmentId, periodId, 'bureau')).rejects.toThrow(/date/i);
    expect((await repo.getMetreContext(projectId, periodId))?.metres).toHaveLength(0);
    expect(await repo.integrateTerrainAttachement(projectId, attachmentId, next, 'bureau')).toMatchObject({ periodeId: next });
  });

  it('blocks cutoff changes that displace dates in the current or following tranche', async () => {
    const { next } = await createDatedBatch();
    await pool.query("UPDATE project.chantier_attachement SET date='2026-10-26' WHERE id=$1", [attachmentId]);
    await repo.integrateTerrainAttachements(projectId, [attachmentId], next, 'bureau');
    await expect(repo.updatePeriode(projectId, periodId, { dateFin: new Date('2026-10-27') })).rejects.toThrow(/terrain/i);
    await expect(repo.updatePeriode(projectId, periodId, { dateFin: null })).rejects.toThrow(/terrain/i);
    await expect(repo.updatePeriode(projectId, next, { dateFin: new Date('2026-10-25') })).rejects.toThrow(/terrain/i);
    expect((await repo.listPeriodes(projectId)).map(({ dateFin }) => dateFin?.toISOString().slice(0, 10)))
      .toEqual(['2026-10-25', '2026-10-31']);
    await expect(repo.updatePeriode(projectId, periodId, { dateFin: new Date('2026-10-24') })).resolves.toBeTruthy();
    await expect(repo.updatePeriode(projectId, next, { dateFin: new Date('2026-11-03') })).resolves.toBeTruthy();
  });

  it('keeps linked dates inside the chantier start after both fiche and ODS edits', async () => {
    await repo.updateFiche(projectId, { executionStartDate: new Date('2026-10-01') });
    await repo.updatePeriode(projectId, periodId, { dateFin: new Date('2026-10-31') });
    await repo.integrateTerrainAttachements(projectId, [attachmentId], periodId, 'bureau');
    await expect(repo.updateFiche(projectId, { executionStartDate: new Date('2026-10-28') })).rejects.toThrow(/terrain/i);
    await expect(repo.updateFiche(projectId, { executionStartDate: null })).rejects.toThrow(/terrain/i);

    const registres = new DrizzleBtpRegistresRepository(drizzle(pool) as Db);
    const ods = await registres.createOds(projectId, { type: 'commencement', objet: 'Début des travaux', dateEffet: new Date('2026-10-28') });
    await registres.actionOds(projectId, ods.id, 'emit');
    await expect(registres.actionOds(projectId, ods.id, 'notify')).rejects.toThrow(/terrain/i);
    expect((await registres.listOds(projectId))[0]?.statut).toBe('emis');
    expect((await repo.getProject(projectId))?.executionStartDate?.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it.each(['2026-10-31', null])('blocks a dated batch downstream of an inverted or missing cutoff (%s)', async (firstEnd) => {
    await repo.updateFiche(projectId, { executionStartDate: new Date('2026-10-01') });
    await repo.updatePeriode(projectId, periodId, { dateFin: firstEnd ? new Date(firstEnd) : null });
    const second = (await repo.createPeriode(projectId, { dateFin: new Date('2026-10-25') })).periode.id;
    const third = (await repo.createPeriode(projectId, { dateFin: new Date('2026-10-30') })).periode.id;

    await expect(repo.integrateTerrainAttachements(projectId, [attachmentId], third, 'bureau')).rejects.toThrow(/dates/i);
    expect((await repo.listTerrainIntegrationWindows(projectId)).map(({ id }) => id)).toEqual(firstEnd ? [periodId] : []);
    expect((await repo.getMetreContext(projectId, third))?.metres).toHaveLength(0);

    await repo.updatePeriode(projectId, periodId, { dateFin: new Date('2026-10-24') });
    expect((await repo.listTerrainIntegrationWindows(projectId)).map(({ id }) => id)).toEqual([periodId, second, third]);
    await expect(repo.integrateTerrainAttachements(projectId, [attachmentId], third, 'bureau')).resolves.toMatchObject({ periodeId: third });
  });

  it('guards a tighter global start even when the legacy linked tranche was already invalid', async () => {
    const { next } = await createDatedBatch();
    await repo.integrateTerrainAttachements(projectId, [attachmentId], next, 'bureau');
    await pool.query("UPDATE project.periode SET date_fin='2026-11-05' WHERE id=$1", [periodId]);
    await expect(repo.updateFiche(projectId, { executionStartDate: new Date('2026-10-28') })).rejects.toThrow(/terrain/i);
    await expect(repo.updatePeriode(projectId, periodId, { dateFin: new Date('2026-10-25') })).resolves.toBeTruthy();
    expect((await repo.getMetreContext(projectId, next))?.metres[0]?.totalPartiel).toBe(12.5);
  });
});
