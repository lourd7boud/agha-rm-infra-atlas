import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { terrainJourneePayloadSchema } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { DrizzleBtpJourneeRepository } from './btp-journee.repository';

const url = process.env.TERRAIN_INTEGRATION_DATABASE_URL;
describe.skipIf(!url)('daily reference settlement (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const repo = new DrizzleBtpJourneeRepository(drizzle(pool) as Db);
  let project: string, assignment: string;
  beforeEach(async () => {
    if (new URL(url!).pathname !== '/atlas_terrain_integration_test') throw new Error('Disposable DB required');
    project = randomUUID(); assignment = randomUUID();
    const employee = randomUUID();
    await pool.query("INSERT INTO project.project(id,reference,name,buyer_name,montant_marche_mad) VALUES($1,'TEST','Settlement','Test',12000)", [project]);
    await pool.query("INSERT INTO people.employee(id,full_name,metier) VALUES($1,'Temp','Maçon')", [employee]);
    await pool.query("INSERT INTO people.assignment(id,employee_id,project_id,start_date,rate_type,rate_amount_mad) VALUES($1,$2,$3,'2026-01-01','jour',150)", [assignment, employee, project]);
    await pool.query("INSERT INTO project.bordereau(project_id,lignes) VALUES($1,$2)", [project, JSON.stringify([{ id: 'bpu', numero: 1, designation: 'Canal', unite: 'ML', quantite: 100, prixUnitaire: 100 }])]);
  });
  afterAll(async () => { await pool.end(); });
  it('refuses independent UUIDs for one project/day', async () => {
    const p = terrainJourneePayloadSchema.parse({ date: '2026-10-27', zone: 'A', summary: 'Travaux' });
    await repo.save(project, randomUUID(), 0, p, 'chef');
    await expect(repo.save(project, randomUUID(), 0, p, 'chef')).rejects.toThrow(/journée.*existe/i);
  });
  it('settles unknown references without duplicating existing reports/resources and retains original values', async () => {
    const id = randomUUID(), attendanceId = randomUUID(), productionId = randomUUID();
    const p = terrainJourneePayloadSchema.parse({ date: '2026-10-27', zone: 'A', summary: 'Travaux',
      attendance: [{ id: attendanceId, assignmentId: null, temporaryName: 'Temp', daysWorked: 1, note: null }],
      production: [{ id: productionId, bpuLigneId: null, designation: 'Canal terrain', unite: 'ML', quantite: 2, note: null }],
    });
    await repo.save(project, id, 0, p, 'chef');
    await repo.transition(project, id, 1, 'submit', 'chef');
    await repo.transition(project, id, 2, 'review', 'bureau');
    const result = await repo.settle(project, id, 3, 'bureau', { reason: 'Références confirmées', attendanceMapping: [{ lineId: attendanceId, assignmentId: assignment }], productionMapping: [{ lineId: productionId, bpuLigneId: 'bpu' }] });
    expect(result.version).toBe(4);
    expect(result.payload.attendance[0]?.temporaryName).toBeNull();
    expect(result.payload.production[0]?.bpuLigneId).toBe('bpu');
    expect((await pool.query('SELECT count(*) FROM project.daily_log WHERE project_id=$1', [project])).rows[0].count).toBe('1');
    expect((await pool.query('SELECT cost_snapshot_mad FROM people.work_day WHERE assignment_id=$1', [assignment])).rows[0].cost_snapshot_mad).toBe('150.000000');
    expect(result.history.at(-1)).toHaveProperty('priorPayload');
    await expect(repo.settle(project, id, 3, 'bureau', { reason: 'Retry', attendanceMapping: [], productionMapping: [] })).rejects.toThrow(/version/i);
  });
});
