import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '../../db/client';
import { DrizzleBtpExecutionRepository } from './btp.repository';

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
});
