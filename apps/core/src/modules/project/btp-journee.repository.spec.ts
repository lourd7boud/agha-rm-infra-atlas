import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DrizzleBtpJourneeRepository } from './btp-journee.repository';
import { terrainJourneePayloadSchema } from '@atlas/contracts';
import type { Db } from '../../db/client';
const url = process.env.TERRAIN_JOURNEE_DATABASE_URL;
const enabled = Boolean(url);
describe.skipIf(!enabled)('journee PostgreSQL transactional workflow', () => {
  const pool = new Pool({
    connectionString: url,
  });
  const repo = new DrizzleBtpJourneeRepository(drizzle(pool) as Db);
  const project = randomUUID(),
    foreign = randomUUID(),
    assignment = randomUUID(),
    photo = randomUUID();
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/atlas_terrain_journee_test') {
      throw new Error('Dedicated disposable journee test database required');
    }
    expect(
      (await pool.query('SELECT current_database() name')).rows[0].name,
    ).toBe('atlas_terrain_journee_test');
    await pool.query(`DROP SCHEMA IF EXISTS project CASCADE; DROP SCHEMA IF EXISTS people CASCADE; DROP SCHEMA IF EXISTS finance CASCADE; CREATE SCHEMA project; CREATE SCHEMA people; CREATE SCHEMA finance;
  CREATE TABLE project.project(id uuid PRIMARY KEY,deleted_at timestamptz);
  CREATE TABLE project.bordereau(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,lignes jsonb,deleted_at timestamptz);
  CREATE TABLE project.project_asset(id uuid PRIMARY KEY,project_id uuid,type text,deleted_at timestamptz);
  CREATE TABLE people.assignment(id uuid PRIMARY KEY,project_id uuid,start_date date,end_date date,rate_type text,rate_amount_mad numeric);
  CREATE TABLE people.work_day(id uuid PRIMARY KEY,assignment_id uuid,work_date date,days_worked numeric,notes text,cost_snapshot_mad numeric,UNIQUE(assignment_id,work_date));
  CREATE TABLE project.daily_log(id uuid PRIMARY KEY,project_id uuid,report_date date,effectifs integer,travaux_realises text,blocages text,photo_ids jsonb,created_by text);
  CREATE TABLE project.chantier_materiel(id uuid PRIMARY KEY,project_id uuid,date date,engin text,regime text,heures_utilisation numeric,carburant_l numeric,cout_carburant_mad numeric NOT NULL,cout_location_mad numeric NOT NULL,note text,saisi_par text);
  CREATE TABLE project.chantier_consommation(id uuid PRIMARY KEY,project_id uuid,date date,article text,unite text,quantite numeric,prix_unitaire_mad numeric,cout_mad numeric NOT NULL,fournisseur text,bon_livraison text,note text,saisi_par text);
  CREATE TABLE project.chantier_attachement(id uuid PRIMARY KEY,project_id uuid,date date,ligne_id text,designation text,unite text,quantite numeric,note text,saisi_par text,statut text DEFAULT 'saisi');
  CREATE TABLE finance.expense(id uuid PRIMARY KEY,project_id uuid,category text,label text,amount_mad numeric,spent_at date,notes text,justificatif_asset_id uuid,saisi_par text);
  CREATE TABLE project.decompte(id uuid PRIMARY KEY,project_id uuid,statut text,deleted_at timestamptz);`);
    await pool.query(readFileSync('drizzle/0054_terrain_journees.sql', 'utf8'));
    await pool.query('INSERT INTO project.project(id) VALUES($1),($2)', [
      project,
      foreign,
    ]);
    await pool.query(
      "INSERT INTO people.assignment VALUES($1,$2,'2026-01-01',NULL,'mois',2600)",
      [assignment, project],
    );
    await pool.query(
      "INSERT INTO project.project_asset VALUES($1,$2,'photo',NULL)",
      [photo, foreign],
    );
    await pool.query(
      'INSERT INTO project.bordereau(project_id,lignes) VALUES($1,$2)',
      [
        project,
        JSON.stringify([
          { id: 'line-1', designation: 'Canonical', unite: 'm3' },
        ]),
      ],
    );
  }, 30000);
  afterAll(async () => {
    await pool.end();
  });
  const payload = () =>
    terrainJourneePayloadSchema.parse({
      date: '2026-10-27',
      zone: 'A',
      summary: 'Production',
      attendance: [
        {
          id: randomUUID(),
          assignmentId: assignment,
          temporaryName: null,
          daysWorked: 0.5,
          note: null,
        },
      ],
      production: [
        {
          id: randomUUID(),
          bpuLigneId: 'line-1',
          designation: 'Input',
          unite: 'm3',
          quantite: 2,
          note: null,
        },
      ],
      equipment: [
        {
          id: randomUUID(),
          engin: 'Pelle',
          regime: 'propre',
          heuresUtilisation: 2,
          carburantL: null,
          coutCarburantMad: null,
          coutLocationMad: null,
          note: null,
        },
      ],
      materials: [
        {
          id: randomUUID(),
          kind: 'receipt',
          article: 'Ciment',
          unite: 't',
          quantite: 2,
          prixUnitaireMad: null,
          fournisseur: null,
          bonLivraison: null,
          note: null,
        },
      ],
    });
  it('rejects cross-project photos and BPU unit tampering', async () => {
    const p = payload();
    p.photoIds = [photo];
    await expect(
      repo.save(project, randomUUID(), 0, p, 'chef'),
    ).rejects.toThrow(/Photo/);
    p.photoIds = [];
    p.production[0]!.unite = 't';
    await expect(
      repo.save(project, randomUUID(), 0, p, 'chef'),
    ).rejects.toThrow(/Unité/);
  });
  it('reviews once, freezes rate, preserves nulls, blocks source mutation and competing pointage', async () => {
    const id = randomUUID();
    const created = await repo.save(project, id, 0, payload(), 'chef');
    expect(created.version).toBe(1);
    await expect(repo.save(project, id, 0, payload(), 'chef')).rejects.toThrow(
      /Version/,
    );
    const submitted = await repo.transition(project, id, 1, 'submit', 'chef');
    expect(submitted.version).toBe(2);
    const reviewed = await repo.transition(project, id, 2, 'review', 'bureau');
    expect(reviewed.version).toBe(3);
    const replay = await repo.transition(project, id, 3, 'review', 'bureau');
    expect(replay.materializedRefs).toEqual(reviewed.materializedRefs);
    expect(
      (await pool.query('SELECT count(*) n FROM project.daily_log')).rows[0].n,
    ).toBe('1');
    expect(
      (
        await pool.query(
          'SELECT cost_snapshot_mad::text rate,days_worked::text days FROM people.work_day',
        )
      ).rows[0],
    ).toMatchObject({ rate: '100.0000000000000000', days: '0.5' });
    expect(
      (
        await pool.query(
          'SELECT cout_carburant_mad FROM project.chantier_materiel',
        )
      ).rows[0].cout_carburant_mad,
    ).toBeNull();
    expect(
      (await pool.query('SELECT count(*) n FROM project.chantier_consommation'))
        .rows[0].n,
    ).toBe('0');
    await expect(
      pool.query('DELETE FROM people.work_day'),
    ).rejects.toMatchObject({ code: '55000' });
    const other = randomUUID();
    await expect(repo.save(project, other, 0, payload(), 'chef')).rejects.toThrow(/journée.*existe/i);
    const competing = payload();
    competing.date = '2026-10-29';
    await pool.query("INSERT INTO people.work_day(id,assignment_id,work_date,days_worked) VALUES($1,$2,'2026-10-29',1)", [randomUUID(), assignment]);
    await repo.save(project, other, 0, competing, 'chef');
    await repo.transition(project, other, 1, 'submit', 'chef');
    await expect(
      repo.transition(project, other, 2, 'review', 'bureau'),
    ).rejects.toThrow(/pointage existe/);
    expect(
      (await pool.query('SELECT count(*) n FROM project.daily_log')).rows[0].n,
    ).toBe('1');
    const reopened = await repo.reopen(
      project,
      id,
      3,
      'bureau',
      'Corriger la quantité',
    );
    expect(reopened.status).toBe('returned');
    expect(reopened.history.at(-1)).toHaveProperty('priorPayload');
    expect(
      (await pool.query('SELECT count(*) n FROM project.daily_log')).rows[0].n,
    ).toBe('0');
  });
  it('serializes competing submissions and resolves reviewed blockers without resource replay', async () => {
    const id = randomUUID(),
      blockerId = randomUUID();
    const p = payload();
    p.date = '2026-10-28';
    p.attendance = [];
    p.blockers = [
      {
        id: blockerId,
        label: 'Accès fermé',
        severity: 'critical',
        owner: 'Chef',
        dueDate: null,
        status: 'open',
      },
    ];
    await repo.save(project, id, 0, p, 'chef');
    const attempts = await Promise.allSettled([
      repo.transition(project, id, 1, 'submit', 'chef'),
      repo.transition(project, id, 1, 'submit', 'chef'),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    await repo.transition(project, id, 2, 'review', 'bureau');
    const before = await pool.query('SELECT count(*) n FROM project.daily_log');
    const resolved = await repo.resolveBlocker(
      project,
      id,
      blockerId,
      3,
      'chef',
    );
    expect(resolved.version).toBe(4);
    expect(resolved.payload.blockers[0]!.status).toBe('resolved');
    expect(
      (await pool.query('SELECT count(*) n FROM project.daily_log')).rows,
    ).toEqual(before.rows);
    await expect(
      repo.resolveBlocker(project, id, blockerId, 3, 'chef'),
    ).rejects.toThrow(/version/);
    await pool.query(
      "INSERT INTO project.decompte(id,project_id,statut) VALUES($1,$2,'validated')",
      [randomUUID(), project],
    );
    await expect(
      repo.reopen(project, id, 4, 'bureau', 'Correction'),
    ).rejects.toThrow(/verrouillé/);
    await pool.query('DELETE FROM project.decompte');
    await pool.query(
      "UPDATE project.chantier_attachement SET statut='integre' WHERE id=$1",
      [
        resolved.materializedRefs.find(
          (r) => r.kind === 'project.chantier_attachement',
        )!.id,
      ],
    );
    await expect(
      repo.reopen(project, id, 4, 'bureau', 'Correction'),
    ).rejects.toThrow(/intégrée/);
  });
});
