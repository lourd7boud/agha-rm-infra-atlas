import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '../../db/client';
import { DrizzleBtpTerrainRepository } from './btp-terrain.repository';
import { BtpTransitionError } from './btp-registres.domain';
import {
  DrizzleBtpTerrainReconciliationRepository,
  TerrainReconciliationError,
} from './btp-terrain-reconciliation.repository';

// A dedicated disposable database is mandatory; never run fixtures in the app DB.
const url = process.env.TERRAIN_TEST_DATABASE_URL;
const PROJECT = '10000000-0000-4000-8000-000000000001';
const ASSIGNMENT = '20000000-0000-4000-8000-000000000001';

describe.skipIf(!url)('terrain finance PostgreSQL regression', () => {
  let pool: Pool;
  let repo: DrizzleBtpTerrainRepository;
  let reconciliation: DrizzleBtpTerrainReconciliationRepository;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.pathname !== '/atlas_terrain_finance_test')
      throw new Error('Dedicated test database required');
    pool = new Pool({ connectionString: url });
    repo = new DrizzleBtpTerrainRepository(drizzle(pool) as Db);
    reconciliation = new DrizzleBtpTerrainReconciliationRepository(drizzle(pool) as Db);
    await pool.query(`
      drop schema if exists people cascade; drop schema if exists project cascade; drop schema if exists finance cascade;
      create schema people; create schema project; create schema finance;
      create table project.project (id uuid primary key, montant_marche_mad numeric);
      create table people.employee (id uuid primary key, full_name text, metier text);
      create table people.assignment (id uuid primary key, employee_id uuid, project_id uuid, rate_type text, rate_amount_mad numeric);
      create table people.work_day (id uuid default gen_random_uuid(), assignment_id uuid, work_date date, days_worked numeric, cost_snapshot_mad numeric(14,6), notes text, unique(assignment_id,work_date));
      create table project.chantier_materiel (project_id uuid, cout_carburant_mad numeric, cout_location_mad numeric);
      create table project.chantier_consommation (project_id uuid, cout_mad numeric, prix_unitaire_mad numeric);
      alter table project.chantier_materiel add column id uuid default gen_random_uuid(), add column date date,
        add column engin text, add column equipment_id uuid, add column regime text, add column heures_utilisation numeric,
        add column carburant_l numeric, add column note text, add column saisi_par uuid, add column created_at timestamptz;
      alter table project.chantier_consommation add column id uuid default gen_random_uuid(), add column date date,
        add column article text, add column unite text, add column quantite numeric, add column fournisseur text,
        add column bon_livraison text, add column note text, add column saisi_par uuid, add column created_at timestamptz;
      create table finance.expense (project_id uuid, amount_mad numeric, id uuid primary key default gen_random_uuid());
      create table project.decompte (id uuid default gen_random_uuid(), project_id uuid, numero int, date_decompte date, statut text, total_ttc_mad numeric, deleted_at timestamptz);
      create table project.chantier_attachement (id uuid primary key, project_id uuid, metre_id uuid, statut text);
      create table project.terrain_journee (project_id uuid,status text,payload jsonb);
    `);
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    await pool.query(
      await readFile(resolve(process.cwd(), 'drizzle/0053_terrain_cost_integrity.sql'), 'utf8'),
    );
    await pool.query(
      await readFile(resolve(process.cwd(), 'drizzle/0056_terrain_reconciliation.sql'), 'utf8'),
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query(`truncate project.project, people.employee, people.assignment, people.work_day,
      project.chantier_materiel, project.chantier_consommation, finance.expense, project.decompte, project.chantier_attachement,
      project.terrain_expense_reconciliation,project.terrain_journee;
      insert into project.project values ('${PROJECT}',5000);
      insert into people.employee values ('${ASSIGNMENT}','Ali','maçon');
      insert into people.assignment values ('${ASSIGNMENT}','${ASSIGNMENT}','${PROJECT}','jour',150);`);
  });

  it('provides full attendance history for reconciliation while retaining recent-list default', async () => {
    await pool.query(`insert into people.work_day (assignment_id,work_date,days_worked,cost_snapshot_mad)
      select $1,date '2026-01-01' + day,1,150 from generate_series(0,120) day`, [ASSIGNMENT]);
    expect(await repo.listPointages(PROJECT)).toHaveLength(120);
    expect(await repo.listPointages(PROJECT, null)).toHaveLength(121);
  });
  it('uses newest live decompte even when older and deleted amounts are higher', async () => {
    await pool.query(`insert into project.decompte (project_id,numero,date_decompte,statut,total_ttc_mad,deleted_at) values
      ('${PROJECT}',1,'2026-01-01','paid',1000,null),
      ('${PROJECT}',2,'2026-02-01','draft',800,null),
      ('${PROJECT}',3,'2026-03-01','draft',3000,now());`);
    const result = await repo.getCouts(PROJECT);
    expect(result.decompteCumuleTtcMad).toBe(800);
    expect(result.latestDecompte).toMatchObject({ numero: 2, statut: 'draft' });
    expect(result.latestDecompte?.id).toBeTruthy();
  });

  it('counts reviewed unresolved temporary attendance without counting drafts or settled people', async () => {
    const payload = {
      attendance: [
        { assignmentId: null, daysWorked: 1 },
        { assignmentId: null, daysWorked: 0 },
        { assignmentId: ASSIGNMENT, daysWorked: 1 },
      ],
    };
    await pool.query('insert into project.terrain_journee values ($1,$2,$3),($1,$4,$3)', [
      PROJECT,
      'reviewed',
      payload,
      'draft',
    ]);
    expect((await repo.getCouts(PROJECT)).missingValuations.mainOeuvre).toBe(1);
  });

  it('separates unresolved, standalone, linked and non-cost expenses without double counting', async () => {
    const ids = (
      await pool.query(`insert into finance.expense(project_id,amount_mad) values
      ('${PROJECT}',100),('${PROJECT}',200),('${PROJECT}',300),('${PROJECT}',400) returning id`)
    ).rows.map((r) => r.id);
    const resource = (
      await pool.query(
        `insert into project.chantier_consommation(project_id,cout_mad) values ('${PROJECT}',200) returning id`,
      )
    ).rows[0].id;
    await reconciliation.reconcile(
      PROJECT,
      ids[0],
      { expectedVersion: 0, treatment: 'standalone', note: 'Transport indépendant' },
      'office',
    );
    await reconciliation.reconcile(
      PROJECT,
      ids[1],
      {
        expectedVersion: 0,
        treatment: 'linked_resource',
        resourceKind: 'consommation',
        resourceId: resource,
        note: 'Même livraison',
      },
      'office',
    );
    await reconciliation.reconcile(
      PROJECT,
      ids[2],
      { expectedVersion: 0, treatment: 'non_cost', note: 'Avance remboursable' },
      'office',
    );
    expect(await repo.getCouts(PROJECT)).toMatchObject({
      depensesMad: 1000,
      reconciledExpensesMad: 100,
      expensesAwaitingReconciliationMad: 400,
      unresolvedExpenseCount: 1,
      reconciledExpenseCount: 3,
      operationalResourceCostsMad: 200,
      knownCostsMad: 300,
      margeBruteMad: null,
      totalMad: null,
    });
  });

  it('audits prior classification and rejects unknown or cross-project resource links', async () => {
    const id = (
      await pool.query(
        `insert into finance.expense(project_id,amount_mad) values ('${PROJECT}',100) returning id`,
      )
    ).rows[0].id;
    await reconciliation.reconcile(
      PROJECT,
      id,
      { expectedVersion: 0, treatment: 'standalone', note: 'Transport indépendant' },
      'first',
    );
    const result = await reconciliation.reconcile(
      PROJECT,
      id,
      { expectedVersion: 1, treatment: 'non_cost', note: 'Correction avance' },
      'second',
    );
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ treatment: 'standalone', actor: 'first' });
    const unknown = (
      await pool.query(
        `insert into project.chantier_consommation(project_id,cout_mad) values ('${PROJECT}',null) returning id`,
      )
    ).rows[0].id;
    await expect(
      reconciliation.reconcile(
        PROJECT,
        id,
        {
          expectedVersion: 2,
          treatment: 'linked_resource',
          resourceKind: 'consommation',
          resourceId: unknown,
          note: 'Même livraison',
        },
        'office',
      ),
    ).rejects.toThrow(TerrainReconciliationError);
    await expect(
      reconciliation.reconcile(
        ASSIGNMENT,
        id,
        { expectedVersion: 0, treatment: 'standalone', note: 'Projet différent' },
        'office',
      ),
    ).rejects.toThrow(TerrainReconciliationError);
  });

  it('refuses deletion of a reconciled expense and preserves its audit', async () => {
    const expenseId = (
      await pool.query(
        `insert into finance.expense(project_id,amount_mad) values ('${PROJECT}',100) returning id`,
      )
    ).rows[0].id;
    await reconciliation.reconcile(
      PROJECT,
      expenseId,
      { expectedVersion: 0, treatment: 'standalone', note: 'Transport indépendant' },
      'office',
    );
    await expect(repo.deleteDepense(PROJECT, expenseId)).rejects.toThrow(BtpTransitionError);
    expect(await reconciliation.list(PROJECT)).toHaveLength(1);
  });

  it('rejects stale office classifications without losing the current decision', async () => {
    const expenseId = (
      await pool.query(
        `insert into finance.expense(project_id,amount_mad) values ('${PROJECT}',100) returning id`,
      )
    ).rows[0].id;
    await reconciliation.reconcile(
      PROJECT,
      expenseId,
      { expectedVersion: 0, treatment: 'standalone', note: 'Transport indépendant' },
      'first',
    );
    await expect(
      reconciliation.reconcile(
        PROJECT,
        expenseId,
        { expectedVersion: 0, treatment: 'non_cost', note: 'Écran ancien' },
        'second',
      ),
    ).rejects.toThrow('modifié');
    expect((await reconciliation.list(PROJECT))[0]).toMatchObject({
      version: 1,
      treatment: 'standalone',
      actor: 'first',
    });
  });

  it('requires explanation for amount discrepancies and invalidates links when valuation changes', async () => {
    const id = (
      await pool.query(
        `insert into finance.expense(project_id,amount_mad) values ('${PROJECT}',100) returning id`,
      )
    ).rows[0].id;
    const resourceId = (
      await pool.query(
        `insert into project.chantier_consommation(project_id,cout_mad) values ('${PROJECT}',80) returning id`,
      )
    ).rows[0].id;
    await expect(
      reconciliation.reconcile(
        PROJECT,
        id,
        {
          expectedVersion: 0,
          treatment: 'linked_resource',
          resourceKind: 'consommation',
          resourceId,
          note: 'Facture',
        },
        'office',
      ),
    ).rejects.toThrow(TerrainReconciliationError);
    await reconciliation.reconcile(
      PROJECT,
      id,
      {
        expectedVersion: 0,
        treatment: 'linked_resource',
        resourceKind: 'consommation',
        resourceId,
        note: 'Écart de TVA documenté sur la facture',
      },
      'office',
    );
    expect((await repo.getCouts(PROJECT)).unresolvedExpenseCount).toBe(0);
    await pool.query('update project.chantier_consommation set cout_mad=90 where id=$1', [
      resourceId,
    ]);
    expect((await repo.getCouts(PROJECT)).unresolvedExpenseCount).toBe(1);
    expect((await repo.getCouts(PROJECT)).expensesAwaitingReconciliationMad).toBe(100);
  });

  it('freezes the rate on creation and scales edited attendance without revaluation', async () => {
    const input = {
      assignmentId: ASSIGNMENT,
      workDate: new Date('2026-10-01'),
      daysWorked: 1,
    };
    await repo.upsertPointage(input);
    await pool.query(`update people.assignment set rate_amount_mad=300`);
    await repo.upsertPointage({ ...input, daysWorked: 0.5 });
    expect((await repo.listPointages(PROJECT))[0]?.coutMad).toBe(75);
    expect((await repo.getCouts(PROJECT)).mainOeuvreMad).toBe(75);
  });

  it('preserves unknown historical valuations through edits and exposes the gap', async () => {
    await pool.query(
      `insert into people.work_day (assignment_id,work_date,days_worked) values ('${ASSIGNMENT}','2026-09-01',1)`,
    );
    await repo.upsertPointage({
      assignmentId: ASSIGNMENT,
      workDate: new Date('2026-09-01'),
      daysWorked: 0.5,
    });
    expect((await repo.listPointages(PROJECT))[0]?.coutMad).toBeNull();
    expect((await repo.getCouts(PROJECT)).missingValuations.mainOeuvre).toBe(1);
  });

  it('leaves a missing creation rate unknown after a rate is entered later', async () => {
    await pool.query(`update people.assignment set rate_amount_mad=null`);
    const input = {
      assignmentId: ASSIGNMENT,
      workDate: new Date('2026-10-01'),
      daysWorked: 1,
    };
    await repo.upsertPointage(input);
    await pool.query(`update people.assignment set rate_amount_mad=200`);
    await repo.upsertPointage(input);
    expect((await repo.listPointages(PROJECT))[0]?.coutMad).toBeNull();
  });

  it('converts monthly rates at capture and exposes missing resource valuations', async () => {
    await pool.query(`update people.assignment set rate_type='mois', rate_amount_mad=5200;
      insert into project.chantier_materiel (project_id,cout_carburant_mad,cout_location_mad) values ('${PROJECT}',null,null);
      insert into project.chantier_consommation (project_id,cout_mad,prix_unitaire_mad) values ('${PROJECT}',null,null);`);
    await repo.upsertPointage({
      assignmentId: ASSIGNMENT,
      workDate: new Date('2026-10-01'),
      daysWorked: 0.5,
    });
    expect((await repo.listPointages(PROJECT))[0]?.coutMad).toBe(100);
    expect((await repo.getCouts(PROJECT)).missingValuations).toEqual({
      mainOeuvre: 0,
      materiel: 1,
      consommations: 1,
    });
  });

  it('refuses deletion of a quantity already integrated into a measurement', async () => {
    await pool.query(
      `insert into project.chantier_attachement values ('${ASSIGNMENT}','${PROJECT}','${ASSIGNMENT}','integre')`,
    );
    await expect(repo.deleteAttachement(PROJECT, ASSIGNMENT)).rejects.toThrow(BtpTransitionError);
    expect(
      (await pool.query('select count(*)::int as n from project.chantier_attachement')).rows[0].n,
    ).toBe(1);
  });

  it('refuses status-only integration without a real measurement link', async () => {
    await expect(repo.setAttachementStatut(PROJECT, ASSIGNMENT, 'integre')).rejects.toThrow(
      BtpTransitionError,
    );
  });

  it('retains unknown material and equipment costs in legacy resource APIs', async () => {
    const date = new Date('2026-10-01');
    const materiel = await repo.createMateriel({
      projectId: PROJECT,
      date,
      engin: 'Pelle',
      equipmentId: null,
      regime: 'propre',
      heuresUtilisation: null,
      carburantL: null,
      coutCarburantMad: null,
      coutLocationMad: null,
      note: null,
      saisiPar: ASSIGNMENT,
    });
    expect(materiel.coutLocationMad).toBeNull();
    const consommation = await repo.createConsommation({
      projectId: PROJECT,
      date,
      article: 'Sable',
      unite: 'm3',
      quantite: 2,
      prixUnitaireMad: null,
      coutMad: null,
      fournisseur: null,
      bonLivraison: null,
      note: null,
      saisiPar: ASSIGNMENT,
    });
    expect(consommation.coutMad).toBeNull();
    expect((await repo.getCouts(PROJECT)).missingValuations).toEqual({
      mainOeuvre: 0,
      materiel: 1,
      consommations: 1,
    });
  });
});
