// Repository Terrain — saisie chantier (rapports, matériel, consommations,
// attachements), dépenses projet (finance.expense) et pointage main d'œuvre
// (people.assignment/work_day, réutilisés — pas de table doublon).
import { and, desc, eq, sql } from 'drizzle-orm';
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
import { computeCoutsTerrain, coutPointage, type CoutsTerrain } from './btp-terrain.domain';

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
  coutCarburantMad: number;
  coutLocationMad: number;
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
  coutMad: number;
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
  coutMad: number;
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
  createAttachement(input: Omit<AttachementRecord, 'id' | 'statut'>): Promise<AttachementRecord>;
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
  listPointages(projectId: string, limit?: number): Promise<PointageRecord[]>;
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
    coutCarburantMad: num(r.coutCarburantMad),
    coutLocationMad: num(r.coutLocationMad),
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
    coutMad: num(r.coutMad),
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
        coutCarburantMad: String(input.coutCarburantMad ?? 0),
        coutLocationMad: String(input.coutLocationMad ?? 0),
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
      input.coutMad > 0
        ? input.coutMad
        : input.prixUnitaireMad != null
          ? Math.round(input.quantite * input.prixUnitaireMad * 100) / 100
          : 0;
    const [row] = await this.db
      .insert(chantierConsommations)
      .values({
        projectId: input.projectId,
        date: input.date,
        article: input.article,
        unite: input.unite,
        quantite: String(input.quantite),
        prixUnitaireMad: input.prixUnitaireMad != null ? String(input.prixUnitaireMad) : undefined,
        coutMad: String(cout),
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
    input: Omit<AttachementRecord, 'id' | 'statut'>,
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
    const [row] = await this.db
      .update(chantierAttachements)
      .set({ statut })
      .where(and(eq(chantierAttachements.id, id), eq(chantierAttachements.projectId, projectId)))
      .returning();
    return row ? mapAttachement(row) : null;
  }

  async deleteAttachement(projectId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(chantierAttachements)
      .where(and(eq(chantierAttachements.id, id), eq(chantierAttachements.projectId, projectId)))
      .returning({ id: chantierAttachements.id });
    return rows.length > 0;
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
    const rows = await this.db
      .delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.projectId, projectId)))
      .returning({ id: expenses.id });
    return rows.length > 0;
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

  async listPointages(projectId: string, limit = 120): Promise<PointageRecord[]> {
    const result = await this.db.execute(sql`
      select wd.id, wd.assignment_id, e.full_name, e.metier, wd.work_date,
             wd.days_worked, wd.notes, a.rate_type, a.rate_amount_mad
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
        coutMad: coutPointage(
          days,
          (r.rate_type as string | null) ?? null,
          r.rate_amount_mad == null ? null : num(r.rate_amount_mad as string),
        ),
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
      insert into people.work_day (assignment_id, work_date, days_worked, notes)
      values (${input.assignmentId}, ${input.workDate.toISOString().slice(0, 10)},
              ${String(input.daysWorked)}, ${input.notes ?? null})
      on conflict (assignment_id, work_date)
      do update set days_worked = excluded.days_worked, notes = excluded.notes
    `);
  }

  // Agrégats
  async getCouts(projectId: string): Promise<CoutsTerrain> {
    const [mo, mat, conso, dep, dec, proj] = await Promise.all([
      this.db.execute(sql`
        select coalesce(sum(wd.days_worked *
          case when a.rate_type = 'mois' then coalesce(a.rate_amount_mad, 0) / 26.0
               else coalesce(a.rate_amount_mad, 0) end), 0) as total
        from people.work_day wd
        join people.assignment a on a.id = wd.assignment_id
        where a.project_id = ${projectId}
      `),
      this.db
        .select({
          total: sql<string>`coalesce(sum(${chantierMateriel.coutCarburantMad} + ${chantierMateriel.coutLocationMad}), 0)`,
        })
        .from(chantierMateriel)
        .where(eq(chantierMateriel.projectId, projectId)),
      this.db
        .select({ total: sql<string>`coalesce(sum(${chantierConsommations.coutMad}), 0)` })
        .from(chantierConsommations)
        .where(eq(chantierConsommations.projectId, projectId)),
      this.db
        .select({ total: sql<string>`coalesce(sum(${expenses.amountMad}), 0)` })
        .from(expenses)
        .where(eq(expenses.projectId, projectId)),
      this.db
        .select({ total: sql<string>`coalesce(max(${decomptes.totalTtcMad}), 0)` })
        .from(decomptes)
        .where(eq(decomptes.projectId, projectId)),
      this.db
        .select({ montant: projects.montantMarcheMad })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1),
    ]);
    return computeCoutsTerrain({
      mainOeuvreMad: num((mo.rows[0] as { total?: string } | undefined)?.total),
      materielMad: num(mat[0]?.total),
      consommationsMad: num(conso[0]?.total),
      depensesMad: num(dep[0]?.total),
      decompteCumuleTtcMad: num(dec[0]?.total),
      montantMarcheMad: num(proj[0]?.montant),
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
            eq(chantierAttachements.statut, 'saisi'),
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
