import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Db } from '../../db/client';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';
import { DrizzleBtpExecutionRepository } from './btp.repository';

const url = process.env.BTP_ODS_INTEGRATION_DATABASE_URL;
const date = (value: string) => new Date(`${value}T00:00:00Z`);

describe.skipIf(!url)('ODS calendar effects (dedicated PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool) as Db;
  const registers = new DrizzleBtpRegistresRepository(db);
  const execution = new DrizzleBtpExecutionRepository(db);
  let projectId: string;

  beforeEach(async () => {
    if (new URL(url!).pathname !== '/atlas_btp_ods_test') throw new Error('Dedicated disposable ODS database required');
    await pool.query('TRUNCATE project.project CASCADE');
    projectId = randomUUID();
    await pool.query("INSERT INTO project.project(id,reference,name,buyer_name,montant_marche_mad,ordre_service_date,delai_mois) VALUES($1,'TEST-ODS','Calendrier OS','Test',12000,'2026-01-01',6)", [projectId]);
  });
  afterAll(async () => { await pool.end(); });

  async function emitted(type: string, input: Record<string, unknown> = {}) {
    const row = await registers.createOds(projectId, { type, objet: `Ordre ${type}`, ...input });
    await registers.actionOds(projectId, row.id, 'emit');
    return row;
  }

  const notification = { dateNotification: date('2026-01-10') };

  it('propagates the explicit commencement once, preserving OS notification evidence', async () => {
    const period = await execution.createPeriode(projectId, { dateFin: date('2026-02-28') });
    const os = await emitted('commencement', { dateEffet: date('2026-01-20') });
    const [first, retry] = await Promise.all([
      registers.actionOds(projectId, os.id, 'notify', notification),
      registers.actionOds(projectId, os.id, 'notify', notification),
    ]);
    expect(first?.calendarEffectAppliedAt).toBeTruthy();
    expect(retry?.calendarEffectAppliedAt).toEqual(first?.calendarEffectAppliedAt);
    expect(first?.dateNotification).toEqual(notification.dateNotification);
    expect((await execution.getProject(projectId))?.executionStartDate).toEqual(date('2026-01-20'));
    expect((await execution.listPeriodes(projectId)).find((row) => row.id === period.periode.id)?.dateDebut).toEqual(date('2026-01-20'));
    await registers.actionOds(projectId, os.id, 'acknowledge');
    await registers.actionOds(projectId, os.id, 'execute');
    expect((await execution.getProject(projectId))?.executionStartDate).toEqual(date('2026-01-20'));
  });

  it('requires an explicit effect date instead of inferring it from notification', async () => {
    const os = await emitted('commencement');
    await expect(registers.actionOds(projectId, os.id, 'notify', notification)).rejects.toThrow(/effet/i);
    expect((await registers.listOds(projectId))[0]?.statut).toBe('emis');
  });

  it('requires an explicit stop scope on new orders', async () => {
    await expect(registers.createOds(projectId, { type: 'arret', objet: 'Arrêt motivé' })).rejects.toThrow(/total|partiel/i);
  });

  it('adds a source-linked total stop once and resumes it at its effective date', async () => {
    const os = await emitted('arret', { dateEffet: date('2026-02-01'), arretScope: 'total' });
    await registers.actionOds(projectId, os.id, 'notify', notification);
    await registers.actionOds(projectId, os.id, 'notify', notification);
    const before = (await execution.getProject(projectId))?.arrets;
    expect(before).toHaveLength(1);
    expect(before?.[0]).toMatchObject({ id: os.id, sourceOdsId: os.id, dateArret: '2026-02-01' });
    const resume = await emitted('reprise', { dateEffet: date('2026-02-11') });
    const result = await registers.actionOds(projectId, resume.id, 'notify', notification);
    expect(result?.repriseArretId).toBe(os.id);
    expect((await execution.getProject(projectId))?.arrets[0]).toMatchObject({ dateReprise: '2026-02-11', repriseOdsId: resume.id });
  });

  it('records partial stops without extending the total contract calendar', async () => {
    const os = await emitted('arret', { dateEffet: date('2026-02-01'), arretScope: 'partiel' });
    const result = await registers.actionOds(projectId, os.id, 'notify', notification);
    expect(result?.calendarEffectAppliedAt).toBeTruthy();
    expect((await execution.getProject(projectId))?.arrets).toEqual([]);
  });

  it('requires selection for ambiguous open stops and validates the resume date atomically', async () => {
    await execution.updateFiche(projectId, { arrets: [
      { id: 'old-a', dateArret: '2026-02-01' }, { id: 'old-b', dateArret: '2026-02-03' },
    ] });
    const resume = await emitted('reprise', { dateEffet: date('2026-02-02') });
    await expect(registers.actionOds(projectId, resume.id, 'notify', notification)).rejects.toThrow(/sélection|plusieurs/i);
    await expect(registers.actionOds(projectId, resume.id, 'notify', { ...notification, repriseArretId: 'old-b' })).rejects.toThrow(/antérieure|avant/i);
    expect((await registers.listOds(projectId))[0]?.statut).toBe('emis');
    await registers.actionOds(projectId, resume.id, 'notify', { ...notification, repriseArretId: 'old-a' });
    expect((await execution.getProject(projectId))?.arrets[0]?.dateReprise).toBe('2026-02-02');
  });

  it('rejects selecting a different stop at notification than on the emitted resumption', async () => {
    await execution.updateFiche(projectId, { arrets: [
      { id: 'old-a', dateArret: '2026-02-01' }, { id: 'old-b', dateArret: '2026-02-03' },
    ] });
    const resume = await emitted('reprise', { dateEffet: date('2026-02-07'), repriseArretId: 'old-a' });
    await expect(registers.actionOds(projectId, resume.id, 'notify', { ...notification, repriseArretId: 'old-b' })).rejects.toThrow(/émis/);
    const result = await registers.actionOds(projectId, resume.id, 'notify', notification);
    expect(result?.repriseArretId).toBe('old-a');
    expect((await execution.getProject(projectId))?.arrets[1]?.dateReprise).toBeUndefined();
  });

  it('preserves the legal calendar effect when a notified order is cancelled', async () => {
    const os = await emitted('arret', { dateEffet: date('2026-02-01'), arretScope: 'total' });
    await registers.actionOds(projectId, os.id, 'notify', notification);
    const cancelled = await registers.actionOds(projectId, os.id, 'cancel');
    expect(cancelled?.calendarEffectAppliedAt).toBeTruthy();
    expect((await execution.getProject(projectId))?.arrets[0]?.sourceOdsId).toBe(os.id);
    await expect(execution.updateFiche(projectId, { arrets: [] })).rejects.toThrow(/ordre de service/);
  });

  it('keeps the emitted effect and offers stable choices for legacy stops', async () => {
    await execution.updateFiche(projectId, { arrets: [{ dateArret: '2026-02-01' }] });
    const stop = await emitted('arret', { dateEffet: date('2026-02-03'), arretScope: 'total' });
    await expect(registers.actionOds(projectId, stop.id, 'notify', { ...notification, arretScope: 'partiel' })).rejects.toThrow(/émis/);
    await registers.actionOds(projectId, stop.id, 'notify', notification);
    const legacyId = (await execution.getProject(projectId))?.arrets[0]?.id;
    expect(legacyId).toBeTruthy();
    const resume = await emitted('reprise', { dateEffet: date('2026-02-04') });
    await registers.actionOds(projectId, resume.id, 'notify', { ...notification, repriseArretId: legacyId });
    expect((await execution.getProject(projectId))?.arrets[0]?.dateReprise).toBe('2026-02-04');
  });

  it('rejects commencement changes against an issued statement without changing the OS', async () => {
    const period = await execution.createPeriode(projectId, { dateFin: date('2026-01-31') });
    await execution.patchDecompte(projectId, period.decompte.id, { statut: 'validated' });
    const os = await emitted('commencement', { dateEffet: date('2026-01-20') });
    await expect(registers.actionOds(projectId, os.id, 'notify', notification)).rejects.toThrow(/verrouill/);
    expect((await registers.listOds(projectId))[0]?.statut).toBe('emis');
    expect((await execution.getProject(projectId))?.executionStartDate).toBeNull();
  });

  it('rolls back the notification and project change when the shared rebuild fails', async () => {
    const os = await emitted('commencement', { dateEffet: date('2026-01-20') });
    const rebuild = vi.spyOn(DrizzleBtpExecutionRepository.prototype, 'rebuildChainTx').mockRejectedValueOnce(new Error('rebuild failed'));
    try {
      await expect(registers.actionOds(projectId, os.id, 'notify', notification)).rejects.toThrow('rebuild failed');
    } finally { rebuild.mockRestore(); }
    expect((await registers.listOds(projectId))[0]?.statut).toBe('emis');
    expect((await execution.getProject(projectId))?.executionStartDate).toBeNull();
  });

  it('does not turn a prolongation amount into an unapproved extension', async () => {
    const os = await emitted('prolongation', { dateEffet: date('2026-02-01'), impactDelaiJours: 30 });
    await registers.actionOds(projectId, os.id, 'notify', notification);
    expect((await execution.getProject(projectId))?.delaiMois).toBe(6);
  });
});
