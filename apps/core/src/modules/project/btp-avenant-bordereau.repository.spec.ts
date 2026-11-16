import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '../../db/client';
import { DrizzleBtpExecutionRepository } from './btp.repository';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';
import type { AvenantBordereauImpact } from './btp-avenant-bordereau.domain';

const url = process.env.BTP_AVENANT_INTEGRATION_DATABASE_URL;
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const initial = { lignes: [{ id: 'line-1', numero: 1, designation: 'Canal', unite: 'ML', quantite: 100, prixUnitaire: 100 }] };

describe.skipIf(!url)('signed BPU amendment approval (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool) as Db;
  const execution = new DrizzleBtpExecutionRepository(db);
  const registers = new DrizzleBtpRegistresRepository(db);
  let projectId: string;
  beforeEach(async () => {
    if (new URL(url!).pathname !== '/atlas_btp_avenant_test') throw new Error('Dedicated disposable amendment database required');
    projectId = randomUUID();
    await pool.query("INSERT INTO project.project(id,reference,name,buyer_name,montant_marche_mad) VALUES($1,'TEST-BPU','BPU initial','Test',0)", [projectId]);
    await execution.saveBordereau(projectId, initial);
  });
  afterAll(async () => { await pool.end(); });

  it('books only once after review and freezes the signed catalogue without rewriting the BPU', async () => {
    const formulaId = randomUUID();
    await pool.query("INSERT INTO project.revision_formula(id,name,fixed_part,weights) VALUES($1,'Formule signée',0.15,'{\"BT\":0.85}')", [formulaId]);
    const impact: AvenantBordereauImpact = {
      version: 1, tauxTva: 20, dateEffet: '2026-10-10', dateSignatureTitulaire: '2026-10-15',
      quantities: [{ ligneId: 'line-1', ancienneQuantite: 100, nouvelleQuantite: 90 }],
      additions: [{ numero: 2, designation: 'Béton', unite: 'M³', quantite: 20, prixUnitaire: 120, origine: 'negocie', formuleId: formulaId.toUpperCase() }],
    };
    await expect(registers.createAvenant(projectId, { objet: 'Travaux supplémentaires', bordereauImpact: impact, montantDeltaMad: 10 })).rejects.toThrow(/TTC/);
    const draft = await registers.createAvenant(projectId, { objet: 'Travaux supplémentaires', bordereauImpact: impact });
    expect(draft.montantDeltaMad).toBe(1680);
    await expect(registers.transitionAvenant(projectId, draft.id, 'en_attente')).rejects.toThrow(/référence/);
    await registers.updateAvenant(projectId, draft.id, { reference: 'AV-SIG-01' });
    await registers.transitionAvenant(projectId, draft.id, 'en_attente');
    await expect(registers.updateAvenant(projectId, draft.id, { montantDeltaMad: 1 })).rejects.toThrow(/brouillon/);
    await expect(registers.deleteAvenant(projectId, draft.id)).rejects.toThrow(/historique/);
    await expect(execution.saveBordereau(projectId, initial)).rejects.toThrow(/verrouillée/);
    await expect(registers.transitionAvenant(projectId, draft.id, 'approuve')).rejects.toThrow(/date/);
    await expect(registers.transitionAvenant(projectId, draft.id, 'approuve', date('2026-10-14'))).rejects.toThrow(/signature/);
    const booked = await Promise.all([
      registers.transitionAvenant(projectId, draft.id, 'approuve', date('2026-10-16')),
      registers.transitionAvenant(projectId, draft.id, 'approuve', date('2026-10-16')),
    ]);
    expect(booked[0]?.montantNouveauMad).toBe(13680);
    expect(booked[1]).toEqual(booked[0]);
    expect((await execution.getBordereau(projectId, date('2026-10-09')))?.lignes).toMatchObject(initial.lignes);
    await pool.query("UPDATE project.revision_formula SET name='Modifiée', fixed_part=0.2, weights='{\"BT\":0.8}' WHERE id=$1", [formulaId]);
    expect((await execution.getBordereau(projectId, date('2026-10-10')))?.lignes).toMatchObject([
      { id: 'line-1', quantite: 90, prixUnitaire: 100 },
      { id: `avenant:${draft.id}:2`, quantite: 20, prixUnitaire: 120, avenant: { reference: 'AV-SIG-01',
        baseDate: '2026-10-15', formuleSnapshot: { id: formulaId, name: 'Formule signée', fixedPart: 0.15, weights: { BT: 0.85 } } } },
    ]);
    expect((await execution.getBordereau(projectId, null))?.lignes).toMatchObject(initial.lignes);
    expect((await execution.getProject(projectId))?.montantMarcheMad).toBe(13680);
  });

  it('preserves documentary historical prices without activating them as signed lines', async () => {
    const old = await registers.createAvenant(projectId, {
      typeAvenant: 'prix_nouveaux', objet: 'Ancienne saisie',
      montantDeltaMad: 120, prixNouveaux: [{ numero: 2, designation: 'Ancien prix' }],
    });
    await expect(registers.transitionAvenant(projectId, old.id, 'en_attente')).rejects.toThrow(/documentaire/);
    await pool.query("UPDATE project.avenant SET statut='approuve', approved_at='2026-10-03' WHERE id=$1", [old.id]);
    expect((await registers.listAvenants(projectId))[0]).toMatchObject({ bordereauImpact: null, statut: 'approuve' });
    expect((await execution.getBordereau(projectId))?.lignes).toMatchObject(initial.lignes);
  });

  it('keeps a closed final statement intact when an amendment is submitted for booking', async () => {
    const { decompte } = await execution.createPeriode(projectId, { isDecompteDernier: true });
    await pool.query("UPDATE project.decompte SET statut='validated' WHERE id=$1", [decompte.id]);
    const draft = await registers.createAvenant(projectId, {
      objet: 'Avenant après clôture', reference: 'AV-SIG-02', bordereauImpact: {
        version: 1, tauxTva: 20, dateEffet: '2026-10-10',
        quantities: [{ ligneId: 'line-1', ancienneQuantite: 100, nouvelleQuantite: 90 }], additions: [],
      },
    });
    await registers.transitionAvenant(projectId, draft.id, 'en_attente');
    await expect(registers.transitionAvenant(projectId, draft.id, 'approuve', date('2026-10-16'))).rejects.toThrow(/rectificatif/);
    expect((await execution.getBordereau(projectId))?.lignes).toMatchObject(initial.lignes);
    expect((await registers.listAvenants(projectId))[0]?.statut).toBe('en_attente');
    await pool.query("UPDATE project.decompte SET statut='draft' WHERE id=$1", [decompte.id]);
    await expect(registers.transitionAvenant(projectId, draft.id, 'approuve', date('2026-10-16'))).resolves.toMatchObject({ statut: 'approuve' });
  });
});
