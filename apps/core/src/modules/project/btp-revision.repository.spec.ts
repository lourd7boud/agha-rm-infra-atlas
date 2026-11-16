import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import type { Db } from '../../db/client';
import { BtpExportService } from './btp-export.service';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';
import { DrizzleBtpExecutionRepository } from './btp.repository';
import type { BtpTerrainRepository } from './btp-terrain.repository';
import { DrizzleProjectRepository } from './project.repository';

const url = process.env.BTP_REVISION_INTEGRATION_DATABASE_URL;
const date = (value: string) => new Date(`${value}T00:00:00Z`);
const actor = { sub: 'revision-test', name: 'Revision test' };

describe.skipIf(!url)('price revision workflow (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool) as Db;
  const execution = new DrizzleBtpExecutionRepository(db);
  const registers = new DrizzleBtpRegistresRepository(db);
  let projectId: string;

  beforeEach(async () => {
    if (new URL(url!).pathname !== '/atlas_btp_revision_test') throw new Error('Dedicated disposable database required');
    await pool.query('TRUNCATE project.project, project.revision_index, project.revision_formula CASCADE');
    projectId = randomUUID();
    await pool.query("INSERT INTO project.project(id,reference,name,buyer_name,montant_marche_mad,ordre_service_date) VALUES($1,'TEST-RP','Marché révisable','Test',12000,'2025-12-31')", [projectId]);
    await execution.saveBordereau(projectId, {
      lignes: [{ id: 'line-1', numero: 1, designation: 'Ouvrage', unite: 'U', quantite: 100, prixUnitaire: 100 }],
    });
  });

  afterAll(async () => { await pool.end(); });

  it('affiche et exporte une reconstitution historique sans modifier les décomptes payés ni leurs dates', async () => {
    await execution.updateFiche(projectId, { dateLimiteRemiseOffres: date('2025-12-20') });
    const first = await execution.createPeriode(projectId, { dateFin: date('2026-01-31'), tauxRetenue: 0 });
    await execution.saveMetres(projectId, first.periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 10 }] },
    ]);
    await execution.patchDecompte(projectId, first.decompte.id, { dateDecompte: date('2026-02-02'), statut: 'validated' });
    await execution.patchDecompte(projectId, first.decompte.id, { statut: 'paid' });
    const formula = await registers.saveFormula({ name: 'CPS historique', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await pool.query(`INSERT INTO project.revision_index(month_date,index_values,source,status)
      VALUES ('2025-12-01','{"TEST":100}','Base.pdf','definitif'),('2026-01-01','{"TEST":125}','Janvier.pdf','definitif')`);
    await registers.saveRevisionConfig(projectId, { formulaId: formula.id, isEnabled: true });
    const before = (await pool.query('SELECT row_to_json(d) AS value FROM project.decompte d WHERE id=$1', [first.decompte.id])).rows[0].value;
    const report = await execution.getRevisionReport(projectId);
    expect(report).toMatchObject({ summary: { calculatedTotal: 200, postedTotal: 0, balance: 200, pendingCount: 0 } });
    expect(report?.rows[0]).toMatchObject({ origin: 'reconstituted', amount: 200, dateDecompte: '2026-02-02' });
    expect(report?.rows[0]?.warnings.join(' ')).toContain('Dates de publication à vérifier');
    expect(report?.coefficientGroups[0]?.baseValues).toEqual({ TEST: 100 });
    expect(report?.coefficientGroups[0]?.months[0]?.ratios).toEqual({ TEST: 1.25 });
    const exports = new BtpExportService(execution, {} as BtpTerrainRepository);
    for (const format of ['xlsx', 'pdf'] as const) {
      const file = await exports.revision(projectId, format);
      const chunks: Uint8Array[] = [];
      for await (const chunk of file.getStream()) chunks.push(chunk);
      expect(Buffer.concat(chunks).subarray(0, format === 'pdf' ? 4 : 2).toString()).toBe(format === 'pdf' ? '%PDF' : 'PK');
    }
    const after = (await pool.query('SELECT row_to_json(d) AS value FROM project.decompte d WHERE id=$1', [first.decompte.id])).rows[0].value;
    expect(after).toEqual(before);
    expect((await pool.query('SELECT count(*) FROM project.decompte_revision WHERE decompte_id=$1', [first.decompte.id])).rows[0].count).toBe('0');
  });

  it('conserve le contrôle chronologique des pièces dans le rapport recalculé', async () => {
    await execution.updateFiche(projectId, { dateLimiteRemiseOffres: date('2025-12-20') });
    const formula = await registers.saveFormula({ name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await registers.saveRevisionConfig(projectId, { formulaId: formula.id, baseIndexes: { TEST: 100 } });
    const first = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    const second = await execution.createPeriode(projectId, { dateFin: date('2026-02-28') });
    for (const row of [first, second]) await execution.saveMetres(projectId, row.periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 10 }] },
    ]);
    await pool.query("UPDATE project.decompte SET date_decompte = CASE WHEN numero=1 THEN '2026-03-10'::date ELSE '2026-03-09'::date END WHERE project_id=$1", [projectId]);
    const report = await execution.getRevisionReport(projectId);
    expect(report?.rows[1]?.issues.join(' ')).toContain('précède celle d’un décompte antérieur');
    expect(report?.summary.calculatedTotal).toBeNull();
  });

  it('signale une publication de borne de retard non datée dans une reconstitution', async () => {
    await execution.updateFiche(projectId, { dateLimiteRemiseOffres: date('2025-12-20') });
    const formula = await registers.saveFormula({ name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await registers.saveRevisionConfig(projectId, { formulaId: formula.id, delayAttributable: true,
      contractDeadline: date('2026-01-31') });
    await pool.query(`INSERT INTO project.revision_index(month_date,index_values,source,status,published_on)
      VALUES ('2025-12-01','{"TEST":100}','Base','definitif','2026-01-01'),
      ('2026-01-01','{"TEST":87.5}','Borne','definitif',NULL),
      ('2026-02-01','{"TEST":125}','Travaux','definitif','2026-03-01')`);
    const first = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    const second = await execution.createPeriode(projectId, { dateFin: date('2026-02-28') });
    await execution.saveMetres(projectId, second.periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 10 }] },
    ]);
    expect(first.periode.numero).toBe(1);
    const report = await execution.getRevisionReport(projectId);
    expect(report?.rows[1]?.amount).toBe(-100);
    expect(report?.rows[1]?.warnings.join(' ')).toContain('Dates de publication à vérifier');
    expect((await execution.listDecomptes(projectId))[1]?.revisionTrace?.status).toBe('pending');
  });

  it('conserve le mode par décompte existant et mémorise le report au dernier', async () => {
    const initial = await registers.saveRevisionConfig(projectId, {});
    expect(initial.postingMode).toBe('each_decompte');
    await registers.saveRevisionConfig(projectId, { postingMode: 'final_only' });
    expect((await registers.getRevisionConfig(projectId))?.postingMode).toBe('final_only');
    expect((await registers.saveRevisionConfig(projectId, { notes: 'CPS relu' })).postingMode).toBe('final_only');
  });

  it('calcule les révisions ordinaires et reporte leur cumul une seule fois sur le dernier', async () => {
    await registers.saveRevisionConfig(projectId, {
      formula: { fixedPart: 0.2, weights: { TEST: 0.8 } }, postingMode: 'final_only',
      baseDate: date('2025-12-01'), baseIndexes: { TEST: 100 },
    });
    for (const month of ['2026-01-01', '2026-02-01']) {
      await registers.upsertIndexMonth({ monthDate: date(month), indexValues: { TEST: 125 },
        publishedOn: '2026-03-01', source: `DATRP/${month}`, status: 'definitif' }, actor);
    }
    const first = await execution.createPeriode(projectId, { dateFin: date('2026-01-31'), tauxRetenue: 0 });
    await execution.saveMetres(projectId, first.periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'first', nombre: 20 }] },
    ]);
    expect((await execution.getDecompte(first.decompte.id))?.revision?.details).toMatchObject({
      calculatedCumulative: 400, cumulative: 0, movement: 0, deferred: true,
    });
    await execution.patchDecompte(projectId, first.decompte.id, { dateDecompte: date('2026-03-02'), statut: 'validated' });
    await execution.patchDecompte(projectId, first.decompte.id, { statut: 'paid' });
    await expect(registers.saveRevisionConfig(projectId, { postingMode: 'each_decompte' })).rejects.toThrow(/verrouill/);
    expect((await registers.getRevisionConfig(projectId))?.postingMode).toBe('final_only');

    await registers.upsertIndexMonth({ monthDate: date('2026-01-01'), indexValues: { TEST: 150 },
      publishedOn: '2026-03-03', source: 'DATRP/RECTIFICATIF-01', status: 'definitif' }, actor);
    const last = await execution.createPeriode(projectId, { dateFin: date('2026-02-28'), isDecompteDernier: true, tauxRetenue: 0 });
    await execution.saveMetres(projectId, last.periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'last', nombre: 80 }] },
    ]);
    await execution.patchDecompte(projectId, last.decompte.id, { dateDecompte: date('2026-03-04') });
    expect((await execution.getDecompte(first.decompte.id))?.revisionMontantMad).toBe(0);
    expect((await execution.getDecompte(last.decompte.id))).toMatchObject({
      revisionMontantMad: 2400, totalHtMad: 10000, totalTtcMad: 14880, montantAcompteMad: 12480,
      revision: { details: { cumulative: 2400, movement: 2400, deferred: false, calculatedCumulative: 2400 } },
    });
    await execution.patchDecompte(projectId, last.decompte.id, { statut: 'validated' });
    expect((await execution.getDecompte(last.decompte.id))?.revisionMontantMad).toBe(2400);
  });

  it('enregistre la formule du CPS une fois et établit les décomptes issus des métrés sans ressaisir de date', async () => {
    await execution.updateFiche(projectId, { dateLimiteRemiseOffres: date('2025-12-20') });
    const input = { formula: { fixedPart: 0.2, weights: { TEST: 0.8 } } };
    const config = await registers.saveRevisionConfig(projectId, input);
    expect(config).toMatchObject({ isEnabled: true, baseDate: null, baseIndexes: {} });
    expect(config.formulaId).toBeTruthy();
    expect(await registers.listFormulas()).toEqual([]);
    expect(await registers.listFormulas(config.formulaId)).toEqual([
      expect.objectContaining({ id: config.formulaId, fixedPart: 0.2, weights: { TEST: 0.8 } }),
    ]);
    expect((await registers.saveRevisionConfig(projectId, input)).formulaId).toBe(config.formulaId);
    for (const [month, value] of [['2025-12-01', 100], ['2026-01-01', 125]] as const) {
      await registers.upsertIndexMonth({ monthDate: date(month), indexValues: { TEST: value },
        publishedOn: '2026-02-01', source: `DATRP/${month}`, status: 'definitif' }, actor);
    }
    const { periode, decompte } = await execution.createPeriode(projectId, {
      dateFin: date('2026-01-31'), isDecompteDernier: true, tauxRetenue: 0,
    });
    await execution.saveMetres(projectId, periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 10 }] },
    ]);
    const preview = await execution.getDecompte(decompte.id);
    expect(preview).toMatchObject({ periode: { dateFin: date('2026-01-31') }, totalHtMad: 1000, revisionMontantMad: 200 });
    expect(preview?.dateDecompte).toBeNull();
    expect((await execution.getMetreContext(projectId, periode.id))?.decompteId).toBe(decompte.id);
    const established = await execution.patchDecompte(projectId, decompte.id, { statut: 'submitted' });
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Casablanca' }).format(new Date());
    expect(established?.dateDecompte).toEqual(date(today));
    await expect(execution.patchDecompte(projectId, decompte.id, { statut: 'validated' })).resolves.toMatchObject({
      dateDecompte: date(today), revisionMontantMad: 200, statut: 'validated',
    });
    await expect(registers.saveRevisionConfig(projectId, input)).resolves.toMatchObject({ formulaId: config.formulaId });
    await expect(registers.saveRevisionConfig(projectId, {
      formula: { fixedPart: 0.3, weights: { TEST: 0.7 } },
    })).rejects.toThrow(/verrouill/);
    expect(await registers.listFormulas(config.formulaId)).toHaveLength(1);
  });

  it('refuse une formule incomplète et conserve la date officielle déjà saisie à la soumission', async () => {
    await expect(registers.saveRevisionConfig(projectId, {
      formula: { fixedPart: 0.2, weights: { TEST: 0.7 } },
    })).rejects.toThrow(/100 %/);
    expect(await registers.getRevisionConfig(projectId)).toBeNull();
    const { decompte } = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    await execution.patchDecompte(projectId, decompte.id, { dateDecompte: date('2026-02-03') });
    await expect(execution.patchDecompte(projectId, decompte.id, { statut: 'submitted' })).resolves.toMatchObject({
      dateDecompte: date('2026-02-03'), statut: 'submitted',
    });
    await expect(execution.patchDecompte(projectId, decompte.id, { statut: 'submitted' })).resolves.toMatchObject({
      dateDecompte: date('2026-02-03'), statut: 'submitted',
    });
  });

  it('régularise un provisoire payé et reprend la révision signée exactement une fois dans le dernier et son XLSX', async () => {
    const formula = await registers.saveFormula({ name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await registers.saveRevisionConfig(projectId, {
      formulaId: formula.id, isEnabled: true, baseDate: date('2025-12-20'), baseIndexes: { TEST: 100 },
    });
    const first = await execution.createPeriode(projectId, { dateDebut: date('2026-01-01'), dateFin: date('2026-01-31'), tauxRetenue: 0 });
    const last = await execution.createPeriode(projectId, { dateDebut: date('2026-02-01'), dateFin: date('2026-02-28'), isDecompteDernier: true, tauxRetenue: 0 });
    for (const [id, qty] of [[first.periode.id, 20], [last.periode.id, 80]] as const) {
      await execution.saveMetres(projectId, id, [
        { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm1', nombre: qty }] },
      ]);
    }
    await execution.patchDecompte(projectId, first.decompte.id, { dateDecompte: date('2026-02-02'), statut: 'validated' });
    await execution.patchDecompte(projectId, first.decompte.id, { statut: 'paid' });
    await expect(registers.saveRevisionConfig(projectId, { isEnabled: false })).rejects.toThrow(/verrouill/);
    await execution.patchDecompte(projectId, last.decompte.id, { dateDecompte: date('2026-03-10') });
    await expect(execution.patchDecompte(projectId, last.decompte.id, { statut: 'validated' })).rejects.toThrow(/Compléter la révision/);
    await registers.upsertIndexMonth({ monthDate: date('2026-01-01'), indexValues: { TEST: 125 },
      publishedOn: '2026-02-12', source: 'DATRP/TEST-01', status: 'definitif' }, actor);
    await registers.upsertIndexMonth({ monthDate: date('2026-02-01'), indexValues: { TEST: 87.5 },
      publishedOn: '2026-03-02', source: 'DATRP/TEST-02', status: 'provisoire' }, actor);
    await registers.upsertIndexMonth({ monthDate: date('2026-02-01'), indexValues: { TEST: 110 },
      publishedOn: '2026-04-02', source: 'DATRP/TEST-03', status: 'definitif' }, actor);

    async function assertBalances() {
      const [previous, final] = await execution.listDecomptes(projectId);
      expect(previous).toMatchObject({ revisionMontantMad: 0, totalTtcMad: 2400, statut: 'paid' });
      expect(final).toMatchObject({
        totalHtMad: 10_000, revisionMontantMad: -400, montantTvaMad: 1920, totalTtcMad: 11520,
        montantAcompteMad: 9120, revisionTrace: { movement: -400, status: 'calculated' },
      });
    }
    const periods = await execution.listPeriodes(projectId);
    expect(periods.map((period) => period.dateDebut?.toISOString().slice(0, 10))).toEqual(['2026-01-01', '2026-01-01']);
    expect((await execution.getMetreContext(projectId, last.periode.id))?.periode.dateDebut).toEqual(date('2026-01-01'));
    expect((await execution.getDecompte(last.decompte.id))?.periode?.dateDebut).toEqual(date('2026-01-01'));
    await assertBalances();
    await execution.patchDecompte(projectId, last.decompte.id, { statut: 'validated' });
    await expect(registers.deleteIndexMonth(date('2026-01-01'), actor)).rejects.toThrow(/publications officielles/);
    await registers.upsertIndexMonth({ monthDate: date('2026-01-01'), indexValues: { TEST: 115 },
      publishedOn: '2026-04-15', source: 'DATRP/TEST-04', status: 'definitif' }, actor);
    await assertBalances();

    const exports = new BtpExportService(execution, {} as BtpTerrainRepository);
    const file = await exports.decompte(projectId, last.decompte.id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of file.getStream()) chunks.push(chunk);
    const workbook = new ExcelJS.Workbook();
    const xlsx = Buffer.concat(chunks);
    await workbook.xlsx.load(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
    const note = workbook.getWorksheet('État de la révision')!;
    expect(note.getCell('B4').value).toBe(-400);
    expect(note.getCell('E9').value).toBe(400);
    expect(note.getCell('E10').value).toBe(-800);
  });

  it('déduit toutes les tranches du début commun et des arrêtés des métrés, avec bornes inclusives', async () => {
    const first = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    const second = await execution.createPeriode(projectId, { dateFin: date('2026-02-28') });
    const formula = await registers.saveFormula({ name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } });
    for (const period of [first, second]) {
      await execution.saveMetres(projectId, period.periode.id, [
        { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 1 }] },
      ]);
    }
    await registers.saveRevisionConfig(projectId, { formulaId: formula.id, isEnabled: true,
      baseDate: date('2025-12-01'), baseIndexes: { TEST: 100 } });
    for (const month of ['2026-01', '2026-02']) {
      await registers.upsertIndexMonth({ monthDate: date(month + '-01'), indexValues: { TEST: 125 },
        publishedOn: '2026-03-01', source: 'Test des bornes', status: 'definitif' }, actor);
    }
    const rows = await execution.listDecomptes(projectId);
    expect(rows.map((row) => row.revisionTrace?.period.start)).toEqual(['2026-01-01', '2026-02-01']);
    expect(rows.map((row) => row.revisionTrace?.period.months[0]?.days)).toEqual([31, 28]);
    expect(rows[1]?.revisionMontantMad).toBe(40);
    await execution.updatePeriode(projectId, first.periode.id, { dateFin: date('2026-01-30') });
    expect((await execution.listDecomptes(projectId))[1]?.revisionTrace?.period.start).toBe('2026-01-31');
    await execution.updateFiche(projectId, { executionStartDate: date('2026-01-02') });
    expect((await execution.listPeriodes(projectId)).map((period) => period.dateDebut)).toEqual([
      date('2026-01-02'), date('2026-01-02'),
    ]);
  });

  it('crée le marché et le bordereau relu en une seule opération puis hérite des taux déjà saisis', async () => {
    const input = {
      creationId: randomUUID(),
      reference: 'SOURCE', name: 'Dossier repris', buyerName: 'Maître d’ouvrage',
      acquisition: { modePassation: 'ao_ouvert' },
      bordereau: { lignes: [{ numero: 1, designation: 'Ouvrage relu', unite: 'ML', quantite: 10, prixUnitaire: 100 }] },
    };
    const created = await execution.createProject(input);
    expect((await execution.createProject(input)).id).toBe(created.id);
    expect(created.montantMarcheMad).toBe(1200);
    expect(created.modePassation).toBe('ao_ouvert');
    expect((await execution.getBordereau(created.id))?.lignes).toHaveLength(1);
    const first = await execution.createPeriode(created.id, { tauxTva: 7, tauxRetenue: 0 });
    await execution.patchDecompte(created.id, first.decompte.id, { statut: 'validated' });
    await expect(execution.updatePeriode(created.id, first.periode.id, {
      libelle: 'Libellé corrigé', tauxTva: 7, tauxRetenue: 0, isDecompteDernier: false,
    })).resolves.toMatchObject({ libelle: 'Libellé corrigé' });
    const next = await execution.createPeriode(created.id, {});
    expect(next.periode).toMatchObject({ tauxTva: 7, tauxRetenue: 0 });
    await expect(execution.updatePeriode(created.id, first.periode.id, { tauxTva: 20 })).rejects.toThrow(/verrouill/);
  });

  it('répercute une fois un avenant approuvé sur le montant et le délai des prochains décomptes', async () => {
    await execution.updateFiche(projectId, { delaiMois: 1, dateLimiteRemiseOffres: date('2025-12-01') });
    const initial = (await execution.getProject(projectId))!.montantMarcheMad;
    const formula = await registers.saveFormula({ name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await registers.saveRevisionConfig(projectId, { formulaId: formula.id, isEnabled: true, baseIndexes: { TEST: 100 } });
    const { periode } = await execution.createPeriode(projectId, { dateFin: date('2026-02-15') });
    await execution.saveMetres(projectId, periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 1 }] },
    ]);
    const [before] = await execution.listDecomptes(projectId);
    expect(before?.revisionTrace?.period.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Qualifier le retard/)]));
    const amendment = await registers.createAvenant(projectId, { objet: 'Prolongation signée', montantDeltaMad: 1200, delaiDeltaMois: 1 });
    await registers.transitionAvenant(projectId, amendment.id, 'en_attente');
    await Promise.all([
      registers.transitionAvenant(projectId, amendment.id, 'approuve', date('2026-01-20')),
      registers.transitionAvenant(projectId, amendment.id, 'approuve', date('2026-01-20')),
    ]);
    expect(await registers.avenantSummary(projectId)).toMatchObject({
      montantInitial: initial, montantActuel: initial + 1200, totalAvenants: 1200, delaiSupplementaireMois: 1,
    });
    const [after] = await execution.listDecomptes(projectId);
    expect(after?.revisionTrace?.period.issues).toEqual([]);
    expect(after?.revisionTrace?.status).toBe('pending'); // Dates complete, official indices still missing.
  });

  it('partage un montant contractuel unique entre anciens avenants et les deux routes de création', async () => {
    const legacy = new DrizzleProjectRepository(db);
    const initial = (await execution.getProject(projectId))!.montantMarcheMad;
    await pool.query(`INSERT INTO project.avenant(project_id, numero, objet, montant_delta_mad, delai_delta_mois, approved_at)
      VALUES($1,1,'Avenant historique',600,0,'2026-01-04')`, [projectId]);
    expect(await legacy.getContractAmount(projectId)).toBe(initial + 600);
    const portfolio = await execution.listPortfolio({ page: 1, limit: 10 });
    expect(portfolio.items[0]?.montantMarcheMad).toBe(initial + 600);
    expect(portfolio.stats.montantTotalMad).toBe(initial + 600);

    const amendment = await registers.createAvenant(projectId, { objet: 'Avenant depuis BTP', montantDeltaMad: 1200 });
    await registers.transitionAvenant(projectId, amendment.id, 'en_attente');
    await registers.transitionAvenant(projectId, amendment.id, 'approuve', date('2026-01-08'));
    expect(await legacy.getContractAmount(projectId)).toBe(initial + 1800);
    await expect(registers.updateAvenant(projectId, amendment.id, { montantDeltaMad: 0 })).rejects.toThrow(/approuvé/);
    await expect(registers.deleteAvenant(projectId, amendment.id)).rejects.toThrow(/approuvé/);

    const latest = await legacy.createAvenant({ projectId, numero: 2, objet: 'Avenant depuis la route historique',
      montantDeltaMad: 900, delaiDeltaMois: 0, approvedAt: date('2026-01-15') });
    expect(latest.numero).toBe(3);
    expect(await legacy.getContractAmount(projectId)).toBe(initial + 2700);
    expect(await registers.avenantSummary(projectId)).toMatchObject({ montantInitial: initial, montantActuel: initial + 2700, totalAvenants: 2700 });

    const { periode } = await execution.createPeriode(projectId, { dateFin: date('2026-02-01'), tauxRetenue: 10 });
    await execution.saveMetres(projectId, periode.id, [
      { bordereauLigneId: 'line-1', sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 100 }] },
    ]);
    const [statement] = await execution.listDecomptes(projectId);
    expect(statement?.retenueGarantieMad).toBe((initial + 2700) * 0.07);
    expect((await execution.getProject(projectId))?.progressPct).toBe(81.63);
  });

  it('allows a first BPU after a duration-only amendment and rounds cents once on the legacy route', async () => {
    const project = await execution.createProject({ reference: 'SANS-BPU', name: 'Marché sans BPU', buyerName: 'Test' });
    const legacy = new DrizzleProjectRepository(db);
    await legacy.createAvenant({ projectId: project.id, numero: 1, objet: 'Prolongation',
      montantDeltaMad: 0, delaiDeltaMois: 1, approvedAt: date('2026-01-04') });
    await execution.saveBordereau(project.id, {
      lignes: [{ id: 'initial', numero: 1, designation: 'Ouvrage', unite: 'U', quantite: 1, prixUnitaire: 100 }],
    });
    expect(await legacy.getContractAmount(project.id)).toBe(120);
    await legacy.createAvenant({ projectId: project.id, numero: 2, objet: 'Ajustement arrondi',
      montantDeltaMad: -0.005, delaiDeltaMois: 0, approvedAt: date('2026-01-05') });
    expect(await legacy.getContractAmount(project.id)).toBe(119.99);
    expect(await registers.avenantSummary(project.id)).toMatchObject({ montantActuel: 119.99, totalAvenants: -0.01 });
  });

  it('uses attested execution dates for the monthly revision and preserves an explicit allocation', async () => {
    const formula = await registers.saveFormula({ name: 'CPS terrain', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await registers.saveRevisionConfig(projectId, {
      formulaId: formula.id, isEnabled: true, baseDate: date('2025-12-01'), baseIndexes: { TEST: 100 },
    });
    for (const [month, value] of [['2026-01-01', 125], ['2026-02-01', 87.5]] as const) {
      await registers.upsertIndexMonth({ monthDate: date(month), indexValues: { TEST: value }, publishedOn: '2026-03-02',
        source: 'DATRP/TEST-TERRAIN', status: 'definitif' }, actor);
    }
    const { periode, decompte } = await execution.createPeriode(projectId, { dateFin: date('2026-02-28'), isDecompteDernier: true });
    await execution.patchDecompte(projectId, decompte.id, { dateDecompte: date('2026-03-10') });
    const a = randomUUID();
    const b = randomUUID();
    await pool.query(`INSERT INTO project.chantier_attachement(id,project_id,date,is_execution_date,ligne_id,designation,unite,quantite,saisi_par)
      VALUES ($1,$3,'2026-01-27',true,'line-1','Janvier','U',90,'chef'),($2,$3,'2026-02-08',true,'line-1','Février','U',10,'chef')`, [a, b, projectId]);
    await execution.integrateTerrainAttachements(projectId, [a, b], periode.id, actor.name);
    const [auto] = await execution.listDecomptes(projectId);
    expect(auto?.revisionMontantMad).toBe(1700);
    expect(auto?.revisionTrace?.period).toMatchObject({ method: 'monthly', allocationSource: 'attachements',
      months: [{ month: '2026-01', ht: 9000 }, { month: '2026-02', ht: 1000 }] });
    const file = await new BtpExportService(execution, {} as BtpTerrainRepository).decompte(projectId, decompte.id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of file.getStream()) chunks.push(chunk);
    const workbook = new ExcelJS.Workbook();
    const xlsx = Buffer.concat(chunks);
    await workbook.xlsx.load(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
    expect(workbook.getWorksheet('État de la révision')?.getCell('J9').value).toBe('Attachements datés');

    await pool.query('UPDATE project.chantier_attachement SET is_execution_date = false WHERE id = $1', [b]);
    await execution.rebuildProjectChain(projectId);
    const [legacy] = await execution.listDecomptes(projectId);
    expect(legacy?.revisionTrace?.period.method).toBe('calendar');
    expect(legacy?.revisionTrace?.period.allocationSource).toBeUndefined();

    await pool.query('UPDATE project.chantier_attachement SET is_execution_date = true WHERE id = $1', [b]);
    await execution.updatePeriode(projectId, periode.id, { revisionMonthlyHt: { '2026-01': 5000, '2026-02': 5000 } });
    const [explicit] = await execution.listDecomptes(projectId);
    expect(explicit?.revisionMontantMad).toBe(500);
    expect(explicit?.revisionTrace?.period.allocationSource).toBeUndefined();
  });

  it('books a signed BPU amendment once, preserves the paid statement, and revises new prices on their own base', async () => {
    const formula = await registers.saveFormula({ name: 'CPS BPU', fixedPart: 0.2, weights: { TEST: 0.8 } });
    const supplementalFormula = await registers.saveFormula({ name: 'CPS ouvrages supplémentaires', fixedPart: 0.25, weights: { TEST: 0.75 } });
    await registers.saveRevisionConfig(projectId, { formulaId: formula.id, isEnabled: true,
      baseDate: date('2025-12-01'), baseIndexes: { TEST: 100 } });
    await registers.upsertIndexMonth({ monthDate: date('2026-01-01'), indexValues: { TEST: 125 }, publishedOn: '2026-02-05',
      source: 'DATRP/1', status: 'definitif' }, actor);
    await registers.upsertIndexMonth({ monthDate: date('2026-02-01'), indexValues: { TEST: 150 }, publishedOn: '2026-03-04',
      source: 'DATRP/2', status: 'definitif' }, actor);
    const first = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    const entry = (bordereauLigneId: string, nombre: number) => ({ bordereauLigneId, sections: [], sousSections: [], lignes: [{ id: 'm', nombre }] });
    await execution.saveMetres(projectId, first.periode.id, [entry('line-1', 10)]);
    await execution.patchDecompte(projectId, first.decompte.id, { dateDecompte: date('2026-02-06'), statut: 'validated' });
    await execution.patchDecompte(projectId, first.decompte.id, { statut: 'paid' });
    const issued = await execution.getDecompte(first.decompte.id);

    const amendment = await registers.createAvenant(projectId, { objet: 'Canalisation supplémentaire', reference: 'AV-SIGNE-01',
      bordereauImpact: { version: 1, tauxTva: 20, dateEffet: '2026-01-15', dateSignatureTitulaire: '2026-01-18',
        quantities: [{ ligneId: 'line-1', ancienneQuantite: 100, nouvelleQuantite: 102 }],
        additions: [{ numero: 2, designation: 'Canal', unite: 'U', quantite: 10, prixUnitaire: 60, origine: 'negocie', formuleId: supplementalFormula.id }] },
    });
    expect((await execution.getBordereau(projectId))?.lignes).toHaveLength(1);
    await registers.transitionAvenant(projectId, amendment.id, 'en_attente');
    await Promise.all([1, 2].map(() => registers.transitionAvenant(projectId, amendment.id, 'approuve', date('2026-02-05'))));
    expect(await registers.avenantSummary(projectId)).toMatchObject({ montantInitial: 12000, totalAvenants: 960, montantActuel: 12960 });
    expect(await execution.getDecompte(first.decompte.id)).toEqual(issued);
    expect((await execution.getAttachement(projectId, first.periode.id))?.lignes).toMatchObject([{ prixNo: 1, quantiteBordereau: 100 }]);
    expect((await execution.getMetreContext(projectId, first.periode.id))?.bordereau?.lignes).toMatchObject([{ numero: 1, quantite: 100 }]);

    const current = await execution.getBordereau(projectId);
    const newLine = current?.lignes.find((line) => line.numero === 2);
    expect(newLine?.avenant).toMatchObject({ baseDate: '2026-01-18', dateEffet: '2026-01-15' });
    await registers.saveFormula({ id: supplementalFormula.id, name: 'Bibliothèque corrigée', fixedPart: 0.5, weights: { TEST: 0.5 } });
    const second = await execution.createPeriode(projectId, { dateFin: date('2026-02-28'), isDecompteDernier: true });
    const sourceIds = [randomUUID(), randomUUID()];
    await pool.query(`INSERT INTO project.chantier_attachement(id,project_id,date,is_execution_date,ligne_id,designation,unite,quantite,saisi_par)
      VALUES($1,$3,'2026-02-12',true,'line-1','Base','U',2,'chef'),($2,$3,'2026-02-12',true,$4,'Nouveau','U',3,'chef')`,
      [sourceIds[0], sourceIds[1], projectId, newLine!.id]);
    await execution.integrateTerrainAttachements(projectId, sourceIds, second.periode.id, actor.name);
    await execution.patchDecompte(projectId, second.decompte.id, { dateDecompte: date('2026-03-06') });
    const [paid, last] = await execution.listDecomptes(projectId);
    expect(paid).toMatchObject({ totalHtMad: 1000, revisionMontantMad: 200, statut: 'paid' });
    expect(last).toMatchObject({ totalHtMad: 1380, revisionMontantMad: 307,
      revisionTrace: { status: 'calculated', movement: 107, period: { amount: 107,
        months: [{ ht: 200, amount: 80, priceBasis: { date: '2025-12-01' } },
          { ht: 180, amount: 27, priceBasis: { date: '2026-01-18', formula: 'CPS ouvrages supplémentaires' } }] } } });
    const xlsxFile = await new BtpExportService(execution, {} as BtpTerrainRepository).decompte(projectId, second.decompte.id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of xlsxFile.getStream()) chunks.push(chunk);
    const workbook = new ExcelJS.Workbook();
    const xlsx = Buffer.concat(chunks);
    await workbook.xlsx.load(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
    expect(workbook.getWorksheet('État de la révision')?.getCell('K11').value).toContain('AV-SIGNE-01');
    expect(workbook.getWorksheet('État de la révision')?.getCell('J10').value).toBe('Attachements datés');
    expect(workbook.getWorksheet('État de la révision')?.getCell('J11').value).toBe('Attachements datés');
  });

  it('requires a dated attachment when a price becomes effective within an open métré', async () => {
    const amendment = await registers.createAvenant(projectId, { objet: 'Poste supplémentaire', reference: 'AV-EFFET',
      bordereauImpact: { version: 1, tauxTva: 20, dateEffet: '2026-02-10', quantities: [],
        additions: [{ numero: 2, designation: 'Poste source', unite: 'U', quantite: 4, prixUnitaire: 75, origine: 'marche' }] },
    });
    await registers.transitionAvenant(projectId, amendment.id, 'en_attente');
    await registers.transitionAvenant(projectId, amendment.id, 'approuve', date('2026-02-20'));
    const added = (await execution.getBordereau(projectId))!.lignes.find((line) => line.numero === 2)!;
    const { periode, decompte } = await execution.createPeriode(projectId, { dateFin: date('2026-02-28') });
    await expect(execution.saveMetres(projectId, periode.id, [{ bordereauLigneId: added.id, sections: [], sousSections: [],
      lignes: [{ id: 'undated', nombre: 1 }],
    }])).rejects.toThrow(/attachement daté/);

    const older = randomUUID();
    const correct = randomUUID();
    await pool.query(`INSERT INTO project.chantier_attachement(id,project_id,date,is_execution_date,ligne_id,designation,unite,quantite,saisi_par)
      VALUES ($1,$3,'2026-02-09',true,$4,'Poste','U',1,'chef'),($2,$3,'2026-02-10',true,$4,'Poste','U',2,'chef')`,
      [older, correct, projectId, added.id]);
    await expect(execution.integrateTerrainAttachements(projectId, [older, correct], periode.id, actor.name)).rejects.toThrow(/précède/);
    expect((await execution.listDecomptes(projectId))[0]?.totalHtMad).toBe(0);
    await execution.integrateTerrainAttachements(projectId, [correct], periode.id, actor.name);
    expect((await execution.listDecomptes(projectId))[0]?.totalHtMad).toBe(150);
    await expect(execution.updatePeriode(projectId, periode.id, { dateFin: date('2026-02-09') })).rejects.toThrow(/applicable|excluent/);
    await expect(execution.patchDecompte(projectId, decompte.id, { dateDecompte: date('2026-02-19'), statut: 'validated' }))
      .rejects.toThrow(/précède l’approbation/);
    await expect(execution.patchDecompte(projectId, decompte.id, { dateDecompte: date('2026-03-01'), statut: 'validated' }))
      .resolves.toMatchObject({ statut: 'validated', totalHtMad: 150 });
  });

  it('preserves distinct historical line identities when legacy price numbers repeat', async () => {
    await execution.saveBordereau(projectId, { lignes: [
      { id: 'legacy-A', numero: 1, designation: 'A', unite: 'U', quantite: 10, prixUnitaire: 100 },
      { id: 'legacy-B', numero: 1, designation: 'B', unite: 'U', quantite: 20, prixUnitaire: 150 },
    ] });
    const { periode, decompte } = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    await execution.saveMetres(projectId, periode.id, [
      { bordereauLigneId: 'legacy-A', sections: [], sousSections: [], lignes: [{ id: 'a', nombre: 2 }] },
      { bordereauLigneId: 'legacy-B', sections: [], sousSections: [], lignes: [{ id: 'b', nombre: 3 }] },
    ]);
    await execution.patchDecompte(projectId, decompte.id, { statut: 'validated' });
    expect((await execution.getMetreContext(projectId, periode.id))?.bordereau?.lignes.map((line) => line.id))
      .toEqual(['legacy-A', 'legacy-B']);
    expect((await execution.getAttachement(projectId, periode.id))?.lignes.map((line) => line.quantitePeriode))
      .toEqual([2, 3]);
  });

  it('calculates an explicit signed formula snapshot after its unused library template is deleted', async () => {
    const formula = await registers.saveFormula({ name: 'Prix nouveau', fixedPart: 0.2, weights: { TEST: 0.8 } });
    await registers.saveRevisionConfig(projectId, { isEnabled: true, baseDate: date('2025-12-01') });
    await registers.upsertIndexMonth({ monthDate: date('2026-01-01'), indexValues: { TEST: 125 }, publishedOn: '2026-02-05', source: 'DATRP/1', status: 'definitif' }, actor);
    await registers.upsertIndexMonth({ monthDate: date('2026-02-01'), indexValues: { TEST: 150 }, publishedOn: '2026-03-04', source: 'DATRP/2', status: 'definitif' }, actor);
    const amendment = await registers.createAvenant(projectId, { objet: 'Prix explicite', reference: 'AV-SNAPSHOT',
      bordereauImpact: { version: 1, tauxTva: 20, dateEffet: '2026-02-01', dateSignatureTitulaire: '2026-01-18', quantities: [],
        additions: [{ numero: 2, designation: 'Prix neuf', unite: 'U', quantite: 10, prixUnitaire: 100, origine: 'negocie', formuleId: formula.id }] },
    });
    await registers.transitionAvenant(projectId, amendment.id, 'en_attente');
    await registers.transitionAvenant(projectId, amendment.id, 'approuve', date('2026-02-02'));
    await registers.deleteFormula(formula.id);
    const added = (await execution.getBordereau(projectId))!.lignes.find((line) => line.numero === 2)!;
    const period = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    await execution.patchDecompte(projectId, period.decompte.id, { dateDecompte: date('2026-02-01'), statut: 'validated' });
    const next = await execution.createPeriode(projectId, { dateFin: date('2026-02-28'), isDecompteDernier: true });
    await execution.saveMetres(projectId, next.periode.id, [{ bordereauLigneId: added.id, sections: [], sousSections: [], lignes: [{ id: 'm', nombre: 5 }] }]);
    await execution.patchDecompte(projectId, next.decompte.id, { dateDecompte: date('2026-03-05') });
    expect((await execution.listDecomptes(projectId))[1]).toMatchObject({ totalHtMad: 500, revisionMontantMad: 80,
      revisionTrace: { status: 'calculated', period: { amount: 80 } } });
  });
});
