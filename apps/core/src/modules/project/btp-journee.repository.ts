import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import type {
  TerrainJourneePayload,
  TerrainJourneeRecord,
  TerrainJourneeSettlement,
} from '@atlas/contracts';
import {
  assertJourneeAction,
  assertJourneeReferences,
  JourneeConflict,
  JourneeReferenceError,
  type JourneeAction,
} from './btp-journee.domain';
export const BTP_JOURNEE_REPOSITORY = Symbol('BTP_JOURNEE_REPOSITORY');
export interface BtpJourneeRepository {
  settle(projectId: string, id: string, expectedVersion: number, actor: string, mapping: TerrainJourneeSettlement): Promise<TerrainJourneeRecord>;
  list(projectId: string): Promise<TerrainJourneeRecord[]>;
  reopen(
    projectId: string,
    id: string,
    expectedVersion: number,
    actor: string,
    reason: string,
  ): Promise<TerrainJourneeRecord>;
  resolveBlocker(
    projectId: string,
    id: string,
    blockerId: string,
    expectedVersion: number,
    actor: string,
  ): Promise<TerrainJourneeRecord>;
  save(
    projectId: string,
    id: string,
    expectedVersion: number,
    payload: TerrainJourneePayload,
    actor: string,
  ): Promise<TerrainJourneeRecord>;
  transition(
    projectId: string,
    id: string,
    expectedVersion: number,
    action: Exclude<JourneeAction, 'save'>,
    actor: string,
    reason?: string,
  ): Promise<TerrainJourneeRecord>;
}
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const rows = async <T>(tx: Pick<Tx, 'execute'>, query: SQL) =>
  (await tx.execute(query)).rows as T[];
const recordSelect = sql`id, project_id as "projectId", status, version, payload, return_reason as "returnReason", materialized_refs as "materializedRefs", history, created_at as "createdAt", updated_at as "updatedAt"`;
const normalize = (r: TerrainJourneeRecord): TerrainJourneeRecord => ({
  ...r,
  createdAt: new Date(r.createdAt).toISOString(),
  updatedAt: new Date(r.updatedAt).toISOString(),
});
export class DrizzleBtpJourneeRepository implements BtpJourneeRepository {
  constructor(private readonly db: Db) {}
  async list(projectId: string) {
    return (
      await rows<TerrainJourneeRecord>(
        this.db,
        sql`SELECT ${recordSelect} FROM project.terrain_journee WHERE project_id=${projectId} ORDER BY payload->>'date' DESC, created_at DESC`,
      )
    ).map(normalize);
  }
  private async validate(tx: Tx, projectId: string, p: TerrainJourneePayload) {
    // One transaction connection executes these sequentially; concurrent queries
    // on pg.Client are deprecated and do not provide database parallelism.
    const projectRows = await rows(
      tx,
      sql`SELECT id FROM project.project WHERE id=${projectId} AND deleted_at IS NULL`,
    );
    const assignments = await rows<{
      id: string;
      startDate: string;
      endDate: string | null;
    }>(
      tx,
      sql`SELECT id,start_date::text as "startDate",end_date::text as "endDate" FROM people.assignment WHERE project_id=${projectId} FOR SHARE`,
    );
    const bpus = await rows<{ lignes: unknown }>(
      tx,
      sql`SELECT lignes FROM project.bordereau WHERE project_id=${projectId} AND deleted_at IS NULL FOR SHARE`,
    );
    const photos = await rows<{ id: string }>(
      tx,
      sql`SELECT id FROM project.project_asset WHERE project_id=${projectId} AND deleted_at IS NULL AND type='photo' FOR SHARE`,
    );
    const bpuIds = bpus.flatMap((b) =>
      Array.isArray(b.lignes)
        ? b.lignes.flatMap((v: unknown) =>
            typeof v === 'object' && v !== null && 'id' in v
              ? [String(v.id)]
              : [],
          )
        : [],
    );
    assertJourneeReferences(p, {
      projectExists: projectRows.length > 0,
      assignments,
      bpuIds,
      photoIds: photos.map((v) => v.id),
    });
    for (const v of p.production) {
      if (!v.bpuLigneId) continue;
      const canonical = bpus
        .flatMap((b) => (Array.isArray(b.lignes) ? b.lignes : []))
        .find(
          (line: unknown) =>
            typeof line === 'object' &&
            line !== null &&
            'id' in line &&
            String(line.id) === v.bpuLigneId,
        ) as { unite?: string; designation?: string } | undefined;
      if (!canonical || canonical.unite !== v.unite)
        throw new JourneeReferenceError('Unité BPU incohérente');
      if (canonical.designation) v.designation = canonical.designation;
    }
  }
  async save(
    projectId: string,
    id: string,
    expectedVersion: number,
    payload: TerrainJourneePayload,
    actor: string,
  ) {
    return this.change(projectId, id, expectedVersion, 'save', actor, payload);
  }
  async transition(
    projectId: string,
    id: string,
    expectedVersion: number,
    action: Exclude<JourneeAction, 'save'>,
    actor: string,
    reason?: string,
  ) {
    return this.change(
      projectId,
      id,
      expectedVersion,
      action,
      actor,
      undefined,
      reason,
    );
  }
  private async change(
    projectId: string,
    id: string,
    expectedVersion: number,
    action: JourneeAction,
    actor: string,
    payload?: TerrainJourneePayload,
    reason?: string,
  ) {
    return this.db.transaction(async (tx) => {
      // Project lock also serializes initial UUID creation and competing attendance reviews.
      if (
        !(
          await rows(
            tx,
            sql`SELECT id FROM project.project WHERE id=${projectId} AND deleted_at IS NULL FOR UPDATE`,
          )
        ).length
      )
        throw new JourneeReferenceError('Projet introuvable');
      const [existing] = await rows<TerrainJourneeRecord>(
        tx,
        sql`SELECT ${recordSelect} FROM project.terrain_journee WHERE id=${id} AND project_id=${projectId} FOR UPDATE`,
      );
      if (!existing) {
        if (action !== 'save' || expectedVersion !== 0 || !payload)
          throw new JourneeConflict('Journée introuvable ou version périmée');
        await this.validate(tx, projectId, payload);
        await this.assertDateAvailable(tx, projectId, id, payload.date);
        const history = [
          { action: 'create', actor, at: new Date().toISOString(), version: 1 },
        ];
        const [created] = await rows<TerrainJourneeRecord>(
          tx,
          sql`INSERT INTO project.terrain_journee(id,project_id,payload,history) VALUES(${id},${projectId},${JSON.stringify(payload)}::jsonb,${JSON.stringify(history)}::jsonb) ON CONFLICT DO NOTHING RETURNING ${recordSelect}`,
        );
        if (!created) throw new JourneeConflict('Identifiant déjà utilisé');
        return normalize(created);
      }
      const status = assertJourneeAction(
        existing.status,
        existing.version,
        expectedVersion,
        action,
      );
      if (status === 'replay') return normalize(existing);
      const p = payload ?? existing.payload;
      await this.assertDateAvailable(tx, projectId, id, p.date);
      await this.validate(tx, projectId, p);
      const refs =
        action === 'review'
          ? await this.materialize(tx, projectId, id, p, actor)
          : existing.materializedRefs;
      const version = existing.version + 1;
      const history = [
        ...existing.history,
        {
          action,
          actor,
          at: new Date().toISOString(),
          version,
          ...(reason ? { reason } : {}),
        },
      ];
      const [updated] = await rows<TerrainJourneeRecord>(
        tx,
        sql`UPDATE project.terrain_journee SET payload=${JSON.stringify(p)}::jsonb,status=${status},version=${version},return_reason=${action === 'return' ? (reason ?? null) : null},history=${JSON.stringify(history)}::jsonb,materialized_refs=${JSON.stringify(refs)}::jsonb,updated_at=now() WHERE id=${id} RETURNING ${recordSelect}`,
      );
      return normalize(updated!);
    });
  }
  private async assertDateAvailable(tx: Tx, projectId: string, id: string, date: string) {
    const matches = await rows(tx, sql`SELECT id FROM project.terrain_journee WHERE project_id=${projectId} AND payload->>'date'=${date} AND id<>${id} LIMIT 1`);
    if (matches.length) throw new JourneeConflict('Une journée existe déjà pour cette date; ouvrez la version existante');
  }

  async settle(projectId: string, id: string, expectedVersion: number, actor: string, mapping: TerrainJourneeSettlement) {
    return this.db.transaction(async (tx) => {
      const projects = await rows(tx, sql`SELECT id FROM project.project WHERE id=${projectId} AND deleted_at IS NULL FOR UPDATE`);
      if (!projects.length) throw new JourneeReferenceError('Projet introuvable');
      const [record] = await rows<TerrainJourneeRecord>(tx, sql`SELECT ${recordSelect} FROM project.terrain_journee WHERE id=${id} AND project_id=${projectId} FOR UPDATE`);
      if (!record || record.version !== expectedVersion) throw new JourneeConflict('Journée introuvable ou version périmée');
      if (record.status !== 'reviewed') throw new JourneeConflict('Complétez les références après vérification de la journée');
      const payload = structuredClone(record.payload);
      const selectedAttendance = new Set(mapping.attendanceMapping.map((v) => v.lineId));
      const selectedProduction = new Set(mapping.productionMapping.map((v) => v.lineId));
      if (selectedAttendance.size !== mapping.attendanceMapping.length || selectedProduction.size !== mapping.productionMapping.length) throw new JourneeReferenceError('Lignes dupliquées');
      for (const item of mapping.attendanceMapping) {
        const line = payload.attendance.find((v) => v.id === item.lineId);
        if (!line || line.assignmentId) throw new JourneeConflict('Présence déjà rapprochée ou introuvable');
        line.assignmentId = item.assignmentId;
        line.temporaryName = null;
      }
      for (const item of mapping.productionMapping) {
        const line = payload.production.find((v) => v.id === item.lineId);
        if (!line || line.bpuLigneId) throw new JourneeConflict('Production déjà rapprochée ou introuvable');
        line.bpuLigneId = item.bpuLigneId;
      }
      await this.validate(tx, projectId, payload);
      const addedRefs = await this.materialize(tx, projectId, id, {
        ...payload,
        attendance: payload.attendance.filter((v) => selectedAttendance.has(v.id)),
        production: payload.production.filter((v) => selectedProduction.has(v.id)),
        equipment: [], materials: [], expenses: [], blockers: [], photoIds: [],
      }, actor, false);
      const version = record.version + 1;
      const history = [...record.history, { action: 'settle_references', actor, at: new Date().toISOString(), version, reason: mapping.reason, priorPayload: record.payload, priorMaterializedRefs: record.materializedRefs }];
      const refs = [...record.materializedRefs, ...addedRefs];
      const [updated] = await rows<TerrainJourneeRecord>(tx, sql`UPDATE project.terrain_journee SET payload=${JSON.stringify(payload)}::jsonb,materialized_refs=${JSON.stringify(refs)}::jsonb,history=${JSON.stringify(history)}::jsonb,version=${version},updated_at=now() WHERE id=${id} RETURNING ${recordSelect}`);
      return normalize(updated!);
    });
  }
  async resolveBlocker(
    projectId: string,
    id: string,
    blockerId: string,
    expectedVersion: number,
    actor: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [record] = await rows<TerrainJourneeRecord>(
        tx,
        sql`SELECT ${recordSelect} FROM project.terrain_journee WHERE id=${id} AND project_id=${projectId} FOR UPDATE`,
      );
      if (!record || record.version !== expectedVersion)
        throw new JourneeConflict('Journée introuvable ou version périmée');
      const blocker = record.payload.blockers.find((b) => b.id === blockerId);
      if (!blocker) throw new JourneeReferenceError('Blocage introuvable');
      if (blocker.status === 'resolved') return normalize(record);
      blocker.status = 'resolved';
      const version = record.version + 1;
      const history = [
        ...record.history,
        {
          action: 'resolve_blocker',
          actor,
          at: new Date().toISOString(),
          version,
          blockerId,
        },
      ];
      const [updated] = await rows<TerrainJourneeRecord>(
        tx,
        sql`UPDATE project.terrain_journee SET payload=${JSON.stringify(record.payload)}::jsonb,history=${JSON.stringify(history)}::jsonb,version=${version},updated_at=now() WHERE id=${id} RETURNING ${recordSelect}`,
      );
      return normalize(updated!);
    });
  }
  async reopen(
    projectId: string,
    id: string,
    expectedVersion: number,
    actor: string,
    reason: string,
  ) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM project.project WHERE id=${projectId} AND deleted_at IS NULL FOR UPDATE`,
      );
      const [record] = await rows<TerrainJourneeRecord>(
        tx,
        sql`SELECT ${recordSelect} FROM project.terrain_journee WHERE id=${id} AND project_id=${projectId} FOR UPDATE`,
      );
      if (
        !record ||
        record.version !== expectedVersion ||
        record.status !== 'reviewed'
      )
        throw new JourneeConflict('Journée non validée ou version périmée');
      // Conservative reversal: accounted cash expenses and certified quantities require their own reversal process.
      if (record.materializedRefs.some((r) => r.kind === 'finance.expense'))
        throw new JourneeConflict(
          'Dépenses validées: extourne comptable requise avant correction',
        );
      const locked = await rows(
        tx,
        sql`SELECT id FROM project.decompte WHERE project_id=${projectId} AND deleted_at IS NULL AND statut IN ('submitted','validated','paid') FOR SHARE`,
      );
      if (locked.length)
        throw new JourneeConflict(
          'Décompte soumis ou verrouillé: correction officielle requise',
        );
      const attachmentIds = record.materializedRefs
        .filter((r) => r.kind === 'project.chantier_attachement')
        .map((r) => r.id);
      for (const attachmentId of attachmentIds) {
        const [attachment] = await rows<{ statut: string }>(
          tx,
          sql`SELECT statut FROM project.chantier_attachement WHERE id=${attachmentId} FOR UPDATE`,
        );
        if (attachment?.statut === 'integre')
          throw new JourneeConflict(
            'Quantité intégrée au métré: correction officielle requise',
          );
      }
      const allowed = new Set([
        'project.daily_log',
        'project.chantier_materiel',
        'project.chantier_consommation',
        'project.chantier_attachement',
        'people.work_day',
      ]);
      const priorResources: Array<{ kind: string; id: string; data: Record<string, unknown> }> = [];
      for (const ref of record.materializedRefs) {
        if (!allowed.has(ref.kind))
          throw new JourneeConflict('Ressource non réversible');
        const [resource] = await rows<Record<string, unknown>>(tx, sql`SELECT * FROM ${sql.raw(ref.kind)} WHERE id=${ref.id} FOR UPDATE`);
        if (!resource) throw new JourneeConflict('Ressource source introuvable');
        priorResources.push({ ...ref, data: resource });
        const linked = await rows(
          tx,
          sql`DELETE FROM project.terrain_source WHERE kind=${ref.kind} AND resource_id=${ref.id} AND journee_id=${id} RETURNING resource_id`,
        );
        if (linked.length !== 1)
          throw new JourneeConflict('Provenance de ressource incohérente');
        await tx.execute(
          sql`DELETE FROM ${sql.raw(ref.kind)} WHERE id=${ref.id}`,
        );
      }
      const version = record.version + 1;
      const history = [
        ...record.history,
        {
          action: 'reopen',
          actor,
          at: new Date().toISOString(),
          version,
          reason,
          priorPayload: record.payload,
          priorMaterializedRefs: record.materializedRefs,
          priorResources,
        },
      ];
      const [updated] = await rows<TerrainJourneeRecord>(
        tx,
        sql`UPDATE project.terrain_journee SET status='returned',return_reason=${reason},materialized_refs='[]'::jsonb,history=${JSON.stringify(history)}::jsonb,version=${version},updated_at=now() WHERE id=${id} RETURNING ${recordSelect}`,
      );
      return normalize(updated!);
    });
  }
  private async materialize(
    tx: Tx,
    projectId: string,
    journeeId: string,
    p: TerrainJourneePayload,
    actor: string,
    includeLog = true,
  ) {
    const refs: TerrainJourneeRecord['materializedRefs'] = [];
    const source = async (kind: string, id: string) => {
      await tx.execute(
        sql`INSERT INTO project.terrain_source(kind,resource_id,journee_id) VALUES(${kind},${id},${journeeId})`,
      );
      refs.push({ kind, id });
    };
    if (includeLog) {
    const logId = randomUUID();
    await tx.execute(
      sql`INSERT INTO project.daily_log(id,project_id,report_date,effectifs,travaux_realises,blocages,photo_ids,created_by) VALUES(${logId},${projectId},${p.date},${p.attendance.filter((v) => v.daysWorked > 0).length},${'[' + p.zone + '] ' + p.summary},${p.blockers
        .filter((v) => v.status === 'open')
        .map((v) => v.label + ' — ' + v.owner)
        .join('\n')},${JSON.stringify(p.photoIds)}::jsonb,${actor})`,
    );
    await source('project.daily_log', logId);
    }
    for (const e of p.equipment) {
      const id = randomUUID();
      await tx.execute(
        sql`INSERT INTO project.chantier_materiel(id,project_id,date,engin,regime,heures_utilisation,carburant_l,cout_carburant_mad,cout_location_mad,note,saisi_par) VALUES(${id},${projectId},${p.date},${e.engin},${e.regime},${e.heuresUtilisation},${e.carburantL},${e.coutCarburantMad},${e.coutLocationMad},${e.note},${actor})`,
      );
      await source('project.chantier_materiel', id);
    }
    for (const m of p.materials) {
      if (m.kind !== 'consumption') continue;
      const id = randomUUID();
      const cost =
        m.prixUnitaireMad === null ? null : m.quantite * m.prixUnitaireMad;
      await tx.execute(
        sql`INSERT INTO project.chantier_consommation(id,project_id,date,article,unite,quantite,prix_unitaire_mad,cout_mad,fournisseur,bon_livraison,note,saisi_par) VALUES(${id},${projectId},${p.date},${m.article},${m.unite},${m.quantite},${m.prixUnitaireMad},${cost},${m.fournisseur},${m.bonLivraison},${m.note},${actor})`,
      );
      await source('project.chantier_consommation', id);
    }
    for (const v of p.production) {
      if (!v.bpuLigneId) continue;
      const id = randomUUID();
      await tx.execute(
        sql`INSERT INTO project.chantier_attachement(id,project_id,date,ligne_id,designation,unite,quantite,note,saisi_par) VALUES(${id},${projectId},${p.date},${v.bpuLigneId},${v.designation},${v.unite},${v.quantite},${v.note},${actor})`,
      );
      await source('project.chantier_attachement', id);
    }
    for (const e of p.expenses) {
      const id = randomUUID();
      await tx.execute(
        sql`INSERT INTO finance.expense(id,project_id,category,label,amount_mad,spent_at,notes,justificatif_asset_id,saisi_par) VALUES(${id},${projectId},${e.category},${e.label},${e.amountMad},${p.date},${e.note},${e.photoId},${actor})`,
      );
      await source('finance.expense', id);
    }
    for (const a of p.attendance) {
      if (!a.assignmentId) continue;
      const id = randomUUID();
      const added = await rows(
        tx,
        sql`INSERT INTO people.work_day(id,assignment_id,work_date,days_worked,notes,cost_snapshot_mad) SELECT ${id},id,${p.date},${a.daysWorked},${a.note},CASE WHEN rate_amount_mad>0 AND rate_type='jour' THEN rate_amount_mad WHEN rate_amount_mad>0 AND rate_type='mois' THEN rate_amount_mad/26 ELSE NULL END FROM people.assignment WHERE id=${a.assignmentId} AND project_id=${projectId} ON CONFLICT(assignment_id,work_date) DO NOTHING RETURNING id`,
      );
      if (!added.length)
        throw new JourneeConflict(
          'Un pointage existe déjà pour cette affectation et cette date; réconciliez avant validation',
        );
      await source('people.work_day', id);
    }
    return refs;
  }
}
