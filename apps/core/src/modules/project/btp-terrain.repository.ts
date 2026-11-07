// Repository Terrain — saisie chantier (rapports, matériel, consommations,
// attachements), dépenses projet (finance.expense) et pointage main d'œuvre
// (people.assignment/work_day, réutilisés — pas de table doublon).
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  assignments,
  chantierAttachements,
  chantierConsommations,
  chantierMateriel,
  dailyLogs,
  decomptes,
  employees,
  expenses,
  projects,
} from '../../db/schema';
import { computeCoutsTerrain, type CoutsTerrain } from './btp-terrain.domain';
import { BtpTransitionError } from './btp-registres.domain';

export const BTP_TERRAIN_REPOSITORY = Symbol('BTP_TERRAIN_REPOSITORY');

const num = (v: string | number | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ─── Records ────────────────────────────────────────────────────────────────
export interface RapportRecord {
  id: string;
  projectId: string;
  reportDate: Date;
  effectifs: number;
  travauxRealises: string;
  materiel: string | null;
  meteo: string | null;
  blocages: string | null;
  incidentsSecurite: number;
  heuresTravail: number | null;
  visites: string | null;
  avancement: string | null;
  photoIds: string[];
  createdBy: string;
  createdAt: Date;
}

export interface MaterielRecord {
  id: string;
  projectId: string;
  date: Date;
  engin: string;
  equipmentId: string | null;
  regime: string;
  heuresUtilisation: number | null;
  carburantL: number | null;
  coutCarburantMad: number | null;
  coutLocationMad: number | null;
  note: string | null;
  saisiPar: string;
}

export interface ConsommationRecord {
  id: string;
  projectId: string;
  date: Date;
  article: string;
  unite: string;
  quantite: number;
  prixUnitaireMad: number | null;
  coutMad: number | null;
  fournisseur: string | null;
  bonLivraison: string | null;
  note: string | null;
  saisiPar: string;
}

export interface AttachementRecord {
  id: string;
  projectId: string;
  date: Date;
  ligneId: string;
  numeroPrix: string | null;
  designation: string;
  unite: string;
  quantite: number;
  note: string | null;
  statut: string;
  metreId: string | null;
  integratedAt: Date | null;
  integratedBy: string | null;
  saisiPar: string;
}

export interface DepenseRecord {
  id: string;
  projectId: string | null;
  category: string;
  label: string;
  amountMad: number;
  method: string | null;
  reference: string | null;
  spentAt: Date;
  notes: string | null;
  justificatifAssetId: string | null;
  saisiPar: string | null;
  createdAt: Date;
}

export interface CrewMember {
  assignmentId: string;
  employeeId: string;
  fullName: string;
  metier: string;
  rateType: string | null;
  rateAmountMad: number | null;
  startDate: Date;
  endDate: Date | null;
}

export interface PointageRecord {
  id: string;
  assignmentId: string;
  employeeName: string;
  metier: string;
  workDate: Date;
  daysWorked: number;
  notes: string | null;
  coutMad: number | null;
}

export interface TerrainCounts {
  rapports: number;
  materiel: number;
  consommations: number;
  attachements: number;
  attachementsASaisir: number;
  depenses: number;
}

export interface BtpTerrainRepository {
  // Rapports de chantier (daily_log enrichi)
  listRapports(projectId: string, limit?: number): Promise<RapportRecord[]>;
  createRapport(input: Omit<RapportRecord, 'id' | 'createdAt'>): Promise<RapportRecord>;
  updateRapport(
    projectId: string,
    id: string,
    patch: Partial<Omit<RapportRecord, 'id' | 'projectId' | 'createdAt' | 'createdBy'>>,
  ): Promise<RapportRecord | null>;
  deleteRapport(projectId: string, id: string): Promise<boolean>;
  // Matériel
  listMateriel(projectId: string): Promise<MaterielRecord[]>;
  createMateriel(input: Omit<MaterielRecord, 'id'>): Promise<MaterielRecord>;
  deleteMateriel(projectId: string, id: string): Promise<boolean>;
  // Consommations
  listConsommations(projectId: string): Promise<ConsommationRecord[]>;
  createConsommation(input: Omit<ConsommationRecord, 'id'>): Promise<ConsommationRecord>;
  deleteConsommation(projectId: string, id: string): Promise<boolean>;
  // Attachements terrain
  listAttachements(projectId: string): Promise<AttachementRecord[]>;
  createAttachement(
    input: Omit<AttachementRecord, 'id' | 'statut' | 'metreId' | 'integratedAt' | 'integratedBy'>,
  ): Promise<AttachementRecord>;
  setAttachementStatut(
    projectId: string,
    id: string,
    statut: 'saisi' | 'integre',
  ): Promise<AttachementRecord | null>;
  deleteAttachement(projectId: string, id: string): Promise<boolean>;
  // Dépenses (finance.expense scoped projet)
  listDepenses(projectId: string): Promise<DepenseRecord[]>;
  createDepense(input: {
    projectId: string;
    category: string;
    label: string;
    amountMad: number;
    method?: string;
    reference?: string;
    spentAt: Date;
    notes?: string;
    justificatifAssetId?: string;
    saisiPar: string;
  }): Promise<DepenseRecord>;
  deleteDepense(projectId: string, id: string): Promise<boolean>;
  // Pointage (people.*)
  getCrew(projectId: string): Promise<CrewMember[]>;
  listPointages(projectId: string, limit?: number | null): Promise<PointageRecord[]>;
  upsertPointage(input: {
    assignmentId: string;
    workDate: Date;
    daysWorked: number;
    notes?: string;
  }): Promise<void>;
  // Agrégats
  getCouts(projectId: string): Promise<CoutsTerrain>;
  getCounts(projectId: string): Promise<TerrainCounts>;
}

// ─── Drizzle implementation ─────────────────────────────────────────────────
type DailyLogRow = typeof dailyLogs.$inferSelect;

function mapRapport(r: DailyLogRow): RapportRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    reportDate: r.reportDate,
    effectifs: r.effectifs,
    travauxRealises: r.travauxRealises,
    materiel: r.materiel,
    meteo: r.meteo,
    blocages: r.blocages,
    incidentsSecurite: r.incidentsSecurite,
    heuresTravail: r.heuresTravail == null ? null : num(r.heuresTravail),
    visites: r.visites,
    avancement: r.avancement,
    photoIds: Array.isArray(r.photoIds) ? (r.photoIds as string[]) : [],
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

function mapMateriel(r: typeof chantierMateriel.$inferSelect): MaterielRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    date: r.date,
    engin: r.engin,
    equipmentId: r.equipmentId,
    regime: r.regime,
    heuresUtilisation: r.heuresUtilisation == null ? null : num(r.heuresUtilisation),
    carburantL: r.carburantL == null ? null : num(r.carburantL),
    coutCarburantMad: r.coutCarburantMad == null ? null : num(r.coutCarburantMad),
    coutLocationMad: r.coutLocationMad == null ? null : num(r.coutLocationMad),
    note: r.note,
    saisiPar: r.saisiPar,
  };
}

function mapConsommation(r: typeof chantierConsommations.$inferSelect): ConsommationRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    date: r.date,
    article: r.article,
    unite: r.unite,
    quantite: num(r.quantite),
    prixUnitaireMad: r.prixUnitaireMad == null ? null : num(r.prixUnitaireMad),
    coutMad: r.coutMad == null ? null : num(r.coutMad),
    fournisseur: r.fournisseur,
    bonLivraison: r.bonLivraison,
    note: r.note,
    saisiPar: r.saisiPar,
  };
}

function mapAttachement(r: typeof chantierAttachements.$inferSelect): AttachementRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    date: r.date,
    ligneId: r.ligneId,
    numeroPrix: r.numeroPrix,
    designation: r.designation,
    unite: r.unite,
    quantite: num(r.quantite),
    note: r.note,
    statut: r.statut,
    metreId: r.metreId,
    integratedAt: r.integratedAt,
    integratedBy: r.integratedBy,
    saisiPar: r.saisiPar,
  };
}

function mapDepense(r: typeof expenses.$inferSelect): DepenseRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    category: r.category,
    label: r.label,
    amountMad: num(r.amountMad),
    method: r.method,
    reference: r.reference,
    spentAt: r.spentAt,
    notes: r.notes,
    justificatifAssetId: r.justificatifAssetId,
    saisiPar: r.saisiPar,
    createdAt: r.createdAt,
  };
}

export class DrizzleBtpTerrainRepository implements BtpTerrainRepository {
  constructor(private readonly db: Db) {}

  // Rapports
  async listRapports(projectId: string, limit = 60): Promise<RapportRecord[]> {
    const rows = await this.db
      .select()
      .from(dailyLogs)
      .where(eq(dailyLogs.projectId, projectId))
      .orderBy(desc(dailyLogs.reportDate), desc(dailyLogs.createdAt))
      .limit(limit);
    return rows.map(mapRapport);
  }

  async createRapport(input: Omit<RapportRecord, 'id' | 'createdAt'>): Promise<RapportRecord> {
    const [row] = await this.db
      .insert(dailyLogs)
      .values({
        projectId: input.projectId,
        reportDate: input.reportDate,
        effectifs: input.effectifs,
        travauxRealises: input.travauxRealises,
        materiel: input.materiel,
        meteo: input.meteo,
        blocages: input.blocages,
        incidentsSecurite: input.incidentsSecurite,
        heuresTravail: input.heuresTravail != null ? String(input.heuresTravail) : undefined,
        visites: input.visites,
        avancement: input.avancement,
        photoIds: input.photoIds,
        createdBy: input.createdBy,
      })
      .returning();
    return mapRapport(row!);
  }

  async updateRapport(
    projectId: string,
    id: string,
    patch: Partial<Omit<RapportRecord, 'id' | 'projectId' | 'createdAt' | 'createdBy'>>,
  ): Promise<RapportRecord | null> {
    const set: Record<string, unknown> = {};
    if (patch.reportDate !== undefined) set.reportDate = patch.reportDate;
    if (patch.effectifs !== undefined) set.effectifs = patch.effectifs;
    if (patch.travauxRealises !== undefined) set.travauxRealises = patch.travauxRealises;
    if (patch.materiel !== undefined) set.materiel = patch.materiel;
    if (patch.meteo !== undefined) set.meteo = patch.meteo;
    if (patch.blocages !== undefined) set.blocages = patch.blocages;
    if (patch.incidentsSecurite !== undefined) set.incidentsSecurite = patch.incidentsSecurite;
    if (patch.heuresTravail !== undefined)
      set.heuresTravail = patch.heuresTravail == null ? null : String(patch.heuresTravail);
    if (patch.visites !== undefined) set.visites = patch.visites;
    if (patch.avancement !== undefined) set.avancement = patch.avancement;
    if (patch.photoIds !== undefined) set.photoIds = patch.photoIds;
    if (Object.keys(set).length === 0) {
      const [row] = await this.db.select().from(dailyLogs).where(eq(dailyLogs.id, id)).limit(1);
      return row ? mapRapport(row) : null;
    }
    const [row] = await this.db
      .update(dailyLogs)
      .set(set)
      .where(and(eq(dailyLogs.id, id), eq(dailyLogs.projectId, projectId)))
      .returning();
    return row ? mapRapport(row) : null;
  }

  async deleteRapport(projectId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(dailyLogs)
      .where(and(eq(dailyLogs.id, id), eq(dailyLogs.projectId, projectId)))
      .returning({ id: dailyLogs.id });
    return rows.length > 0;
  }

  // Matériel
  async listMateriel(projectId: string): Promise<MaterielRecord[]> {
    const rows = await this.db
      .select()
      .from(chantierMateriel)
      .where(eq(chantierMateriel.projectId, projectId))
      .orderBy(desc(chantierMateriel.date), desc(chantierMateriel.createdAt));
    return rows.map(mapMateriel);
  }

  async createMateriel(input: Omit<MaterielRecord, 'id'>): Promise<MaterielRecord> {
    const [row] = await this.db
      .insert(chantierMateriel)
      .values({
        projectId: input.projectId,
        date: input.date,
        engin: input.engin,
        equipmentId: input.equipmentId,
        regime: input.regime,
        heuresUtilisation:
          input.heuresUtilisation != null ? String(input.heuresUtilisation) : undefined,
        carburantL: input.carburantL != null ? String(input.carburantL) : undefined,
        coutCarburantMad: input.coutCarburantMad == null ? null : String(input.coutCarburantMad),
        coutLocationMad: input.coutLocationMad == null ? null : String(input.coutLocationMad),
        note: input.note,
        saisiPar: input.saisiPar,
      })
      .returning();
    return mapMateriel(row!);
  }

  async deleteMateriel(projectId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(chantierMateriel)
      .where(and(eq(chantierMateriel.id, id), eq(chantierMateriel.projectId, projectId)))
      .returning({ id: chantierMateriel.id });
    return rows.length > 0;
  }

  // Consommations
  async listConsommations(projectId: string): Promise<ConsommationRecord[]> {
    const rows = await this.db
      .select()
      .from(chantierConsommations)
      .where(eq(chantierConsommations.projectId, projectId))
      .orderBy(desc(chantierConsommations.date), desc(chantierConsommations.createdAt));
    return rows.map(mapConsommation);
  }

  async createConsommation(input: Omit<ConsommationRecord, 'id'>): Promise<ConsommationRecord> {
    // coût = quantité × PU quand le PU est fourni et le coût omis.
    const cout =
      input.coutMad != null
        ? input.coutMad
        : input.prixUnitaireMad != null
          ? Math.round(input.quantite * input.prixUnitaireMad * 100) / 100
          : null;
    const [row] = await this.db
      .insert(chantierConsommations)
      .values({
        projectId: input.projectId,
        date: input.date,
        article: input.article,
        unite: input.unite,
        quantite: String(input.quantite),
        prixUnitaireMad: input.prixUnitaireMad != null ? String(input.prixUnitaireMad) : undefined,
        coutMad: cout == null ? null : String(cout),
        fournisseur: input.fournisseur,
        bonLivraison: input.bonLivraison,
        note: input.note,
        saisiPar: input.saisiPar,
      })
      .returning();
    return mapConsommation(row!);
  }

  async deleteConsommation(projectId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(chantierConsommations)
      .where(and(eq(chantierConsommations.id, id), eq(chantierConsommations.projectId, projectId)))
      .returning({ id: chantierConsommations.id });
    return rows.length > 0;
  }

  // Attachements
  async listAttachements(projectId: string): Promise<AttachementRecord[]> {
    const rows = await this.db
      .select()
      .from(chantierAttachements)
      .where(eq(chantierAttachements.projectId, projectId))
      .orderBy(desc(chantierAttachements.date), desc(chantierAttachements.createdAt));
    return rows.map(mapAttachement);
  }

  async createAttachement(
    input: Omit<AttachementRecord, 'id' | 'statut' | 'metreId' | 'integratedAt' | 'integratedBy'>,
  ): Promise<AttachementRecord> {
    const [row] = await this.db
      .insert(chantierAttachements)
      .values({
        projectId: input.projectId,
        date: input.date,
        ligneId: input.ligneId,
        numeroPrix: input.numeroPrix,
        designation: input.designation,
        unite: input.unite,
        quantite: String(input.quantite),
        note: input.note,
        saisiPar: input.saisiPar,
      })
      .returning();
    return mapAttachement(row!);
  }

  async setAttachementStatut(
    projectId: string,
    id: string,
    statut: 'saisi' | 'integre',
  ): Promise<AttachementRecord | null> {
    if (statut === 'integre') {
      throw new BtpTransitionError(
        'Intégrez la quantité à un métré pour confirmer son intégration',
      );
    }
    const [row] = await this.db
      .update(chantierAttachements)
      .set({ statut })
      .where(
        and(
          eq(chantierAttachements.id, id),
          eq(chantierAttachements.projectId, projectId),
          isNull(chantierAttachements.metreId),
        ),
      )
      .returning();
    return row ? mapAttachement(row) : null;
  }

  async deleteAttachement(projectId: string, id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [source] = await tx
        .select({ metreId: chantierAttachements.metreId })
        .from(chantierAttachements)
        .where(and(eq(chantierAttachements.id, id), eq(chantierAttachements.projectId, projectId)))
        .for('update');
      if (source?.metreId)
        throw new BtpTransitionError(
          'Cette quantité est intégrée à un métré — suppression impossible',
        );
      const rows = await tx
        .delete(chantierAttachements)
        .where(and(eq(chantierAttachements.id, id), eq(chantierAttachements.projectId, projectId)))
        .returning({ id: chantierAttachements.id });
      return rows.length > 0;
    });
  }

  // Dépenses
  async listDepenses(projectId: string): Promise<DepenseRecord[]> {
    const rows = await this.db
      .select()
      .from(expenses)
      .where(eq(expenses.projectId, projectId))
      .orderBy(desc(expenses.spentAt), desc(expenses.createdAt));
    return rows.map(mapDepense);
  }

  async createDepense(input: {
    projectId: string;
    category: string;
    label: string;
    amountMad: number;
    method?: string;
    reference?: string;
    spentAt: Date;
    notes?: string;
    justificatifAssetId?: string;
    saisiPar: string;
  }): Promise<DepenseRecord> {
    const [row] = await this.db
      .insert(expenses)
      .values({
        projectId: input.projectId,
        category: input.category,
        label: input.label,
        amountMad: String(input.amountMad),
        method: input.method,
        reference: input.reference,
        spentAt: input.spentAt,
        notes: input.notes,
        justificatifAssetId: input.justificatifAssetId,
        saisiPar: input.saisiPar,
      })
      .returning();
    return mapDepense(row!);
  }

  async deleteDepense(projectId: string, id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [expense] = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.projectId, projectId)))
        .for('update');
      if (!expense) return false;
      const classified =
        await tx.execute(sql`select expense_id from project.terrain_expense_reconciliation
        where expense_id=${id}`);
      if (classified.rows.length)
        throw new BtpTransitionError(
          'Cette dépense est rapprochée — son historique doit être conservé',
        );
      const rows = await tx
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.projectId, projectId)))
        .returning({ id: expenses.id });
      return rows.length > 0;
    });
  }

  // Pointage — réutilise people.assignment / people.work_day
  async getCrew(projectId: string): Promise<CrewMember[]> {
    const rows = await this.db
      .select({
        assignmentId: assignments.id,
        employeeId: employees.id,
        fullName: employees.fullName,
        metier: employees.metier,
        rateType: assignments.rateType,
        rateAmountMad: assignments.rateAmountMad,
        startDate: assignments.startDate,
        endDate: assignments.endDate,
      })
      .from(assignments)
      .innerJoin(employees, eq(assignments.employeeId, employees.id))
      .where(eq(assignments.projectId, projectId))
      .orderBy(employees.fullName);
    return rows.map((r) => ({
      assignmentId: r.assignmentId,
      employeeId: r.employeeId,
      fullName: r.fullName,
      metier: r.metier,
      rateType: r.rateType,
      rateAmountMad: r.rateAmountMad == null ? null : num(r.rateAmountMad),
      startDate: r.startDate,
      endDate: r.endDate,
    }));
  }

  async listPointages(projectId: string, limit: number | null = 120): Promise<PointageRecord[]> {
    const result = await this.db.execute(sql`
      select wd.id, wd.assignment_id, e.full_name, e.metier, wd.work_date,
             wd.days_worked, wd.notes, wd.cost_snapshot_mad
      from people.work_day wd
      join people.assignment a on a.id = wd.assignment_id
      join people.employee e on e.id = a.employee_id
      where a.project_id = ${projectId}
      order by wd.work_date desc, e.full_name
      limit ${limit}
    `);
    return (result.rows as Record<string, unknown>[]).map((r) => {
      const days = num(r.days_worked as string);
      return {
        id: String(r.id),
        assignmentId: String(r.assignment_id),
        employeeName: String(r.full_name),
        metier: String(r.metier),
        workDate: new Date(String(r.work_date)),
        daysWorked: days,
        notes: (r.notes as string | null) ?? null,
        coutMad:
          r.cost_snapshot_mad == null
            ? null
            : Math.round(days * num(r.cost_snapshot_mad as string) * 100) / 100,
      };
    });
  }

  async upsertPointage(input: {
    assignmentId: string;
    workDate: Date;
    daysWorked: number;
    notes?: string;
  }): Promise<void> {
    // Même clé naturelle que people: (assignment, date) — UPSERT idempotent.
    await this.db.execute(sql`
      insert into people.work_day (assignment_id, work_date, days_worked, notes, cost_snapshot_mad)
      select a.id, ${input.workDate.toISOString().slice(0, 10)},
             ${String(input.daysWorked)}::numeric, ${input.notes ?? null},
             case when a.rate_amount_mad > 0 and a.rate_type = 'mois' then a.rate_amount_mad / 26.0
                  when a.rate_amount_mad > 0 and a.rate_type = 'jour' then a.rate_amount_mad
                  else null end
      from people.assignment a where a.id = ${input.assignmentId}
      on conflict (assignment_id, work_date)
      do update set days_worked = excluded.days_worked, notes = excluded.notes
    `);
  }

  // Agrégats
  async getCouts(projectId: string): Promise<CoutsTerrain> {
    const [mo, mat, conso, dep, dec, proj, temporary] = await Promise.all([
      this.db.execute(sql`
        select coalesce(sum(round(wd.days_worked * wd.cost_snapshot_mad, 2)), 0) as total,
               count(*) filter (where wd.cost_snapshot_mad is null) as missing
        from people.work_day wd
        join people.assignment a on a.id = wd.assignment_id
        where a.project_id = ${projectId}
      `),
      this.db
        .select({
          total: sql<string>`coalesce(sum(coalesce(${chantierMateriel.coutCarburantMad}, 0) + coalesce(${chantierMateriel.coutLocationMad}, 0)), 0)`,
          missing: sql<string>`count(*) filter (where ${chantierMateriel.coutCarburantMad} is null or ${chantierMateriel.coutLocationMad} is null)`,
        })
        .from(chantierMateriel)
        .where(eq(chantierMateriel.projectId, projectId)),
      this.db
        .select({
          total: sql<string>`coalesce(sum(${chantierConsommations.coutMad}), 0)`,
          missing: sql<string>`count(*) filter (where ${chantierConsommations.coutMad} is null)`,
        })
        .from(chantierConsommations)
        .where(eq(chantierConsommations.projectId, projectId)),
      this.db.execute(sql`
        with classified as (
          select e.amount_mad, r.treatment,
            coalesce(r.project_id=e.project_id and r.expense_amount_mad=e.amount_mad and
              (r.treatment <> 'linked_resource' or
                case r.resource_kind
                  when 'main_oeuvre' then exists (
                    select 1 from people.work_day w join people.assignment a on a.id=w.assignment_id
                    where w.id=r.resource_id and a.project_id=e.project_id
                      and round(w.days_worked*w.cost_snapshot_mad,2)=r.resource_amount_mad)
                  when 'materiel' then exists (
                    select 1 from project.chantier_materiel m where m.id=r.resource_id and m.project_id=e.project_id
                      and m.cout_carburant_mad+m.cout_location_mad=r.resource_amount_mad)
                  when 'consommation' then exists (
                    select 1 from project.chantier_consommation c where c.id=r.resource_id and c.project_id=e.project_id
                      and c.cout_mad=r.resource_amount_mad)
                  else false end), false) as reconciled
          from finance.expense e left join project.terrain_expense_reconciliation r on r.expense_id=e.id
          where e.project_id=${projectId}
        )
        select coalesce(sum(amount_mad),0) as total,
          coalesce(sum(amount_mad) filter (where reconciled and treatment='standalone'),0) as standalone,
          coalesce(sum(amount_mad) filter (where not reconciled),0) as unresolved,
          count(*) filter (where reconciled) as reconciled_count,
          count(*) filter (where not reconciled) as unresolved_count from classified
      `),
      this.db
        .select({
          total: decomptes.totalTtcMad,
          id: decomptes.id,
          numero: decomptes.numero,
          dateDecompte: decomptes.dateDecompte,
          statut: decomptes.statut,
        })
        .from(decomptes)
        .where(and(eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt)))
        .orderBy(desc(decomptes.numero))
        .limit(1),
      this.db
        .select({ montant: projects.montantMarcheMad })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1),
      this.db.execute(sql`select count(*) as missing from project.terrain_journee j
        cross join lateral jsonb_array_elements(coalesce(j.payload->'attendance','[]'::jsonb)) a
        where j.project_id=${projectId} and j.status='reviewed'
          and a->>'assignmentId' is null and (a->>'daysWorked')::numeric > 0`),
    ]);
    return computeCoutsTerrain({
      mainOeuvreMad: num((mo.rows[0] as { total?: string } | undefined)?.total),
      materielMad: num(mat[0]?.total),
      consommationsMad: num(conso[0]?.total),
      depensesMad: num((dep.rows[0] as { total?: string } | undefined)?.total),
      reconciledExpensesMad: num((dep.rows[0] as { standalone?: string } | undefined)?.standalone),
      expensesAwaitingReconciliationMad: num(
        (dep.rows[0] as { unresolved?: string } | undefined)?.unresolved,
      ),
      unresolvedExpenseCount: num(
        (dep.rows[0] as { unresolved_count?: string } | undefined)?.unresolved_count,
      ),
      reconciledExpenseCount: num(
        (dep.rows[0] as { reconciled_count?: string } | undefined)?.reconciled_count,
      ),
      decompteCumuleTtcMad: num(dec[0]?.total),
      montantMarcheMad: num(proj[0]?.montant),
      latestDecompte: dec[0]
        ? {
            id: dec[0].id,
            numero: dec[0].numero,
            dateDecompte: dec[0].dateDecompte,
            statut: dec[0].statut,
          }
        : null,
      missingValuations: {
        mainOeuvre:
          num((mo.rows[0] as { missing?: string } | undefined)?.missing) +
          num((temporary.rows[0] as { missing?: string } | undefined)?.missing),
        materiel: num(mat[0]?.missing),
        consommations: num(conso[0]?.missing),
      },
    });
  }

  async getCounts(projectId: string): Promise<TerrainCounts> {
    const [rap, mat, conso, att, attSaisi, dep] = await Promise.all([
      this.db
        .select({ n: sql<string>`count(*)` })
        .from(dailyLogs)
        .where(eq(dailyLogs.projectId, projectId)),
      this.db
        .select({ n: sql<string>`count(*)` })
        .from(chantierMateriel)
        .where(eq(chantierMateriel.projectId, projectId)),
      this.db
        .select({ n: sql<string>`count(*)` })
        .from(chantierConsommations)
        .where(eq(chantierConsommations.projectId, projectId)),
      this.db
        .select({ n: sql<string>`count(*)` })
        .from(chantierAttachements)
        .where(eq(chantierAttachements.projectId, projectId)),
      this.db
        .select({ n: sql<string>`count(*)` })
        .from(chantierAttachements)
        .where(
          and(
            eq(chantierAttachements.projectId, projectId),
            isNull(chantierAttachements.metreId),
          ),
        ),
      this.db
        .select({ n: sql<string>`count(*)` })
        .from(expenses)
        .where(eq(expenses.projectId, projectId)),
    ]);
    return {
      rapports: num(rap[0]?.n),
      materiel: num(mat[0]?.n),
      consommations: num(conso[0]?.n),
      attachements: num(att[0]?.n),
      attachementsASaisir: num(attSaisi[0]?.n),
      depenses: num(dep[0]?.n),
    };
  }
}
