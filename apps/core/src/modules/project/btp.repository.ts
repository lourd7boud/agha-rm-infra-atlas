// BTP execution repository — the marché lifecycle chain: fiche marché →
// bordereau → périodes → métrés → décomptes (auto-rebuilt), attachement,
// corbeille. Décomptes are NEVER written directly by callers: every mutation of
// the chain funnels through rebuildProjectChain() so the cumulative model can
// not drift (the source app rebuilt only the current période's décompte; here a
// full in-order rebuild keeps every later décompte consistent too).
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  bordereaux,
  decompteRevisions,
  decomptes,
  metres,
  periodes,
  projectRevisionConfig,
  projects,
  revisionFormulas,
  revisionIndexes,
} from '../../db/schema';
import {
  computeBordereau,
  computeDecompte,
  computeProgressPct,
  round2,
  toDecimal,
  toNumber,
  type BordereauLigne,
  type DecompteLigne,
  type PriorDecompteAcompte,
} from './btp-finance.domain';
import {
  computeMetreTotals,
  computePourcentageRealisation,
  type MetreLigne,
  type MetreSection,
  type MetreSousSection,
} from './btp-metre.domain';
import {
  calculateDecompteRevision,
  dateToMonthKey,
  type IndexValues,
  type RevisionFormulaSpec,
} from './btp-revision.domain';
import { BtpTransitionError, assertDecompteTransition } from './btp-registres.domain';
import type { ArretTravaux } from './btp-registres.domain';

// ─── Records ─────────────────────────────────────────────────────────────────

export interface BtpProjectRecord {
  id: string;
  reference: string;
  name: string;
  buyerName: string;
  montantMarcheMad: number;
  ordreServiceDate: Date | null;
  delaiMois: number | null;
  status: string;
  objet: string | null;
  annee: string | null;
  societe: string | null;
  commune: string | null;
  typeMarche: string | null;
  modePassation: string | null;
  dateOuverture: Date | null;
  receptionProvisoire: Date | null;
  receptionDefinitive: Date | null;
  achevementTravaux: Date | null;
  assistanceTechnique: string | null;
  maitreOeuvre: string | null;
  progressPct: number;
  rc: string | null;
  cb: string | null;
  cnss: string | null;
  patente: string | null;
  programme: string | null;
  projetLibelle: string | null;
  ligneBudgetaire: string | null;
  chapitre: string | null;
  arrets: ArretTravaux[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BtpProjectFichePatch {
  reference?: string;
  name?: string;
  buyerName?: string;
  objet?: string;
  annee?: string;
  societe?: string;
  commune?: string;
  typeMarche?: string;
  modePassation?: string;
  ordreServiceDate?: Date | null;
  delaiMois?: number | null;
  dateOuverture?: Date | null;
  receptionProvisoire?: Date | null;
  receptionDefinitive?: Date | null;
  achevementTravaux?: Date | null;
  assistanceTechnique?: string | null;
  maitreOeuvre?: string | null;
  rc?: string | null;
  cb?: string | null;
  cnss?: string | null;
  patente?: string | null;
  programme?: string | null;
  projetLibelle?: string | null;
  ligneBudgetaire?: string | null;
  chapitre?: string | null;
  arrets?: ArretTravaux[];
  status?: string;
}

export interface BtpPortfolioFilters {
  search?: string;
  statut?: string;
  annee?: string;
  assistanceTechnique?: string;
  maitreOeuvre?: string;
  page: number;
  limit: number;
}

export interface BtpPortfolioStats {
  total: number;
  actifs: number;
  termines: number;
  brouillons: number;
  montantTotalMad: number;
}

export interface BtpPortfolioResult {
  items: BtpProjectRecord[];
  total: number;
  stats: BtpPortfolioStats;
  facets: { annees: string[]; assistanceTechnique: string[]; maitreOeuvre: string[] };
}

export interface BordereauRecord {
  id: string;
  projectId: string;
  reference: string | null;
  designation: string | null;
  lignes: Required<BordereauLigne>[];
  montantTotalMad: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PeriodeRecord {
  id: string;
  projectId: string;
  numero: number;
  libelle: string | null;
  dateDebut: Date | null;
  dateFin: Date | null;
  tauxTva: number;
  tauxRetenue: number;
  isDecompteDernier: boolean;
  statut: string;
  observations: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetreRecord {
  id: string;
  projectId: string;
  periodeId: string;
  bordereauLigneId: string;
  designationBordereau: string | null;
  unite: string | null;
  sections: MetreSection[];
  sousSections: MetreSousSection[];
  lignes: MetreLigne[];
  totalPartiel: number;
  totalCumule: number;
  quantiteBordereau: number;
  pourcentageRealisation: number;
  updatedAt: Date;
}

export interface DecompteRecord {
  id: string;
  projectId: string;
  periodeId: string | null;
  numero: number;
  dateDecompte: Date | null;
  lignes: DecompteLigne[];
  tauxTva: number;
  totalHtMad: number;
  revisionMontantMad: number;
  montantTvaMad: number;
  totalTtcMad: number;
  depensesAnterieuresMad: number;
  decomptesPrecedentsMad: number;
  retenueGarantieMad: number;
  montantAcompteMad: number;
  isDernier: boolean;
  statut: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetreSaveEntry {
  bordereauLigneId: string;
  sections: MetreSection[];
  sousSections: MetreSousSection[];
  lignes: MetreLigne[];
}

export interface AttachementLigne {
  prixNo: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  quantitePrecedente: number;
  quantitePeriode: number;
  quantiteCumulee: number;
}

export const BTP_EXECUTION_REPOSITORY = Symbol('BTP_EXECUTION_REPOSITORY');

export interface BtpExecutionRepository {
  listPortfolio(filters: BtpPortfolioFilters): Promise<BtpPortfolioResult>;
  getProject(id: string): Promise<BtpProjectRecord | null>;
  createProject(
    input: BtpProjectFichePatch & { reference: string; name: string },
  ): Promise<BtpProjectRecord>;
  updateFiche(id: string, patch: BtpProjectFichePatch): Promise<BtpProjectRecord | null>;
  softDeleteProject(id: string): Promise<boolean>;
  restoreProject(id: string): Promise<boolean>;
  listDeletedProjects(): Promise<BtpProjectRecord[]>;
  listIntervenants(): Promise<{
    assistanceTechnique: { name: string; count: number }[];
    maitreOeuvre: { name: string; count: number }[];
    societes: {
      name: string;
      rc: string | null;
      cb: string | null;
      cnss: string | null;
      patente: string | null;
      count: number;
    }[];
  }>;

  getBordereau(projectId: string): Promise<BordereauRecord | null>;
  saveBordereau(
    projectId: string,
    input: { reference?: string; designation?: string; lignes: BordereauLigne[] },
  ): Promise<BordereauRecord>;

  listPeriodes(projectId: string): Promise<(PeriodeRecord & { metresCount: number })[]>;
  createPeriode(
    projectId: string,
    input: {
      libelle?: string;
      dateDebut?: Date;
      dateFin?: Date;
      tauxTva?: number;
      tauxRetenue?: number;
      isDecompteDernier?: boolean;
    },
  ): Promise<{ periode: PeriodeRecord; decompte: DecompteRecord }>;
  updatePeriode(
    projectId: string,
    periodeId: string,
    patch: Partial<{
      libelle: string;
      dateDebut: Date | null;
      dateFin: Date | null;
      tauxTva: number;
      tauxRetenue: number;
      isDecompteDernier: boolean;
      statut: string;
      observations: string;
    }>,
  ): Promise<PeriodeRecord | null>;
  deletePeriode(projectId: string, periodeId: string): Promise<boolean>;

  getMetreContext(
    projectId: string,
    periodeId: string,
  ): Promise<{
    periode: PeriodeRecord;
    bordereau: BordereauRecord | null;
    metres: MetreRecord[];
    previousByLigne: Record<
      string,
      { periodeNumero: number; totalPartiel: number; lignes: MetreLigne[] }[]
    >;
  } | null>;
  saveMetres(
    projectId: string,
    periodeId: string,
    entries: MetreSaveEntry[],
  ): Promise<{ metres: MetreRecord[]; decompte: DecompteRecord | null }>;

  listDecomptes(projectId: string): Promise<(DecompteRecord & { periodeLibelle: string | null })[]>;
  getDecompte(decompteId: string): Promise<
    | (DecompteRecord & {
        periode: PeriodeRecord | null;
        revision: {
          montantAReviser: number | null;
          coefficient: number | null;
          montantRevision: number | null;
          details: unknown;
        } | null;
      })
    | null
  >;
  patchDecompte(
    projectId: string,
    decompteId: string,
    patch: { dateDecompte?: Date | null; statut?: string },
  ): Promise<DecompteRecord | null>;

  getAttachement(
    projectId: string,
    periodeId?: string,
  ): Promise<{
    periode: PeriodeRecord | null;
    isDernier: boolean;
    lignes: AttachementLigne[];
  } | null>;

  /** Recompute every décompte (and the project progress) — used after any
   *  change to bordereau, métrés, périodes or révision config. */
  rebuildProjectChain(projectId: string): Promise<void>;
}

// ─── Drizzle implementation ──────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function mapProject(row: typeof projects.$inferSelect): BtpProjectRecord {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    buyerName: row.buyerName,
    montantMarcheMad: num(row.montantMarcheMad),
    ordreServiceDate: row.ordreServiceDate ?? null,
    delaiMois: row.delaiMois == null ? null : num(row.delaiMois),
    status: row.status,
    objet: row.objet ?? null,
    annee: row.annee ?? null,
    societe: row.societe ?? null,
    commune: row.commune ?? null,
    typeMarche: row.typeMarche ?? null,
    modePassation: row.modePassation ?? null,
    dateOuverture: row.dateOuverture ?? null,
    receptionProvisoire: row.receptionProvisoire ?? null,
    receptionDefinitive: row.receptionDefinitive ?? null,
    achevementTravaux: row.achevementTravaux ?? null,
    assistanceTechnique: row.assistanceTechnique ?? null,
    maitreOeuvre: row.maitreOeuvre ?? null,
    progressPct: num(row.progressPct),
    rc: row.rc ?? null,
    cb: row.cb ?? null,
    cnss: row.cnss ?? null,
    patente: row.patente ?? null,
    programme: row.programme ?? null,
    projetLibelle: row.projetLibelle ?? null,
    ligneBudgetaire: row.ligneBudgetaire ?? null,
    chapitre: row.chapitre ?? null,
    arrets: (row.arrets as ArretTravaux[]) ?? [],
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapBordereau(row: typeof bordereaux.$inferSelect): BordereauRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    reference: row.reference ?? null,
    designation: row.designation ?? null,
    lignes: (row.lignes as Required<BordereauLigne>[]) ?? [],
    montantTotalMad: num(row.montantTotalMad),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPeriode(row: typeof periodes.$inferSelect): PeriodeRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    numero: row.numero,
    libelle: row.libelle ?? null,
    dateDebut: row.dateDebut ?? null,
    dateFin: row.dateFin ?? null,
    tauxTva: num(row.tauxTva),
    tauxRetenue: num(row.tauxRetenue),
    isDecompteDernier: row.isDecompteDernier,
    statut: row.statut,
    observations: row.observations ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMetre(row: typeof metres.$inferSelect): MetreRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    periodeId: row.periodeId,
    bordereauLigneId: row.bordereauLigneId,
    designationBordereau: row.designationBordereau ?? null,
    unite: row.unite ?? null,
    sections: (row.sections as MetreSection[]) ?? [],
    sousSections: (row.sousSections as MetreSousSection[]) ?? [],
    lignes: (row.lignes as MetreLigne[]) ?? [],
    totalPartiel: num(row.totalPartiel),
    totalCumule: num(row.totalCumule),
    quantiteBordereau: num(row.quantiteBordereau),
    pourcentageRealisation: num(row.pourcentageRealisation),
    updatedAt: row.updatedAt,
  };
}

function mapDecompte(row: typeof decomptes.$inferSelect): DecompteRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    periodeId: row.periodeId ?? null,
    numero: row.numero,
    dateDecompte: row.dateDecompte ?? null,
    lignes: (row.lignes as DecompteLigne[]) ?? [],
    tauxTva: num(row.tauxTva),
    totalHtMad: num(row.totalHtMad),
    revisionMontantMad: num(row.revisionMontantMad),
    montantTvaMad: num(row.montantTvaMad),
    totalTtcMad: num(row.totalTtcMad),
    depensesAnterieuresMad: num(row.depensesAnterieuresMad),
    decomptesPrecedentsMad: num(row.decomptesPrecedentsMad),
    retenueGarantieMad: num(row.retenueGarantieMad),
    montantAcompteMad: num(row.montantAcompteMad),
    isDernier: row.isDernier,
    statut: row.statut,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const LOCKED_DECOMPTE_STATUTS = new Set(['validated', 'paid']);

export class DrizzleBtpExecutionRepository implements BtpExecutionRepository {
  constructor(private readonly db: Db) {}

  // ── Portfolio / fiche ──────────────────────────────────────────────────────

  async listPortfolio(filters: BtpPortfolioFilters): Promise<BtpPortfolioResult> {
    const conditions = [isNull(projects.deletedAt)];
    if (filters.statut) conditions.push(eq(projects.status, filters.statut));
    if (filters.annee) conditions.push(eq(projects.annee, filters.annee));
    if (filters.assistanceTechnique) {
      conditions.push(eq(projects.assistanceTechnique, filters.assistanceTechnique));
    }
    if (filters.maitreOeuvre) conditions.push(eq(projects.maitreOeuvre, filters.maitreOeuvre));
    if (filters.search) {
      const needle = `%${filters.search}%`;
      conditions.push(
        sql`(${projects.reference} ilike ${needle} or ${projects.name} ilike ${needle} or ${projects.objet} ilike ${needle} or ${projects.societe} ilike ${needle} or ${projects.buyerName} ilike ${needle})`,
      );
    }
    const where = and(...conditions);

    const offset = (filters.page - 1) * filters.limit;
    const [rows, countRows, [statsRow], facetAnnees, facetAt, facetMoe] = await Promise.all([
      this.db
        .select()
        .from(projects)
        .where(where)
        .orderBy(desc(projects.createdAt))
        .limit(filters.limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(projects).where(where),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          actifs: sql<number>`count(*) filter (where ${projects.status} in ('en_cours','suspendu'))::int`,
          termines: sql<number>`count(*) filter (where ${projects.status} in ('receptionne','clos'))::int`,
          brouillons: sql<number>`count(*) filter (where ${projects.status} = 'preparation')::int`,
          montant: sql<string>`coalesce(sum(${projects.montantMarcheMad}), 0)`,
        })
        .from(projects)
        .where(isNull(projects.deletedAt)),
      this.db
        .selectDistinct({ value: projects.annee })
        .from(projects)
        .where(and(isNull(projects.deletedAt), sql`${projects.annee} is not null`)),
      this.db
        .selectDistinct({ value: projects.assistanceTechnique })
        .from(projects)
        .where(
          and(isNull(projects.deletedAt), sql`coalesce(${projects.assistanceTechnique}, '') <> ''`),
        ),
      this.db
        .selectDistinct({ value: projects.maitreOeuvre })
        .from(projects)
        .where(and(isNull(projects.deletedAt), sql`coalesce(${projects.maitreOeuvre}, '') <> ''`)),
    ]);

    return {
      items: rows.map(mapProject),
      total: countRows[0]?.count ?? 0,
      stats: {
        total: statsRow?.total ?? 0,
        actifs: statsRow?.actifs ?? 0,
        termines: statsRow?.termines ?? 0,
        brouillons: statsRow?.brouillons ?? 0,
        montantTotalMad: num(statsRow?.montant),
      },
      facets: {
        annees: facetAnnees
          .map((r) => r.value)
          .filter((v): v is string => !!v)
          .sort((a, b) => b.localeCompare(a)),
        assistanceTechnique: facetAt
          .map((r) => r.value)
          .filter((v): v is string => !!v)
          .sort(),
        maitreOeuvre: facetMoe
          .map((r) => r.value)
          .filter((v): v is string => !!v)
          .sort(),
      },
    };
  }

  async getProject(id: string): Promise<BtpProjectRecord | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row ? mapProject(row) : null;
  }

  async createProject(
    input: BtpProjectFichePatch & { reference: string; name: string },
  ): Promise<BtpProjectRecord> {
    const [row] = await this.db
      .insert(projects)
      .values({
        reference: input.reference,
        name: input.name,
        buyerName: input.buyerName ?? input.maitreOeuvre ?? '—',
        montantMarcheMad: '0',
        status: input.status ?? 'preparation',
        objet: input.objet,
        annee: input.annee,
        societe: input.societe,
        commune: input.commune,
        typeMarche: input.typeMarche ?? 'normal',
        modePassation: input.modePassation,
        ordreServiceDate: input.ordreServiceDate ?? undefined,
        delaiMois: input.delaiMois != null ? String(input.delaiMois) : undefined,
        dateOuverture: input.dateOuverture ?? undefined,
        assistanceTechnique: input.assistanceTechnique,
        maitreOeuvre: input.maitreOeuvre,
        rc: input.rc,
        cb: input.cb,
        cnss: input.cnss,
        patente: input.patente,
        programme: input.programme,
        projetLibelle: input.projetLibelle,
        ligneBudgetaire: input.ligneBudgetaire,
        chapitre: input.chapitre,
        arrets: input.arrets ?? [],
      })
      .returning();
    if (!row) throw new BtpTransitionError('Création du marché échouée');
    return mapProject(row);
  }

  async updateFiche(id: string, patch: BtpProjectFichePatch): Promise<BtpProjectRecord | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const direct: (keyof BtpProjectFichePatch)[] = [
      'reference',
      'name',
      'buyerName',
      'objet',
      'annee',
      'societe',
      'commune',
      'typeMarche',
      'modePassation',
      'ordreServiceDate',
      'dateOuverture',
      'receptionProvisoire',
      'receptionDefinitive',
      'achevementTravaux',
      'assistanceTechnique',
      'maitreOeuvre',
      'rc',
      'cb',
      'cnss',
      'patente',
      'programme',
      'projetLibelle',
      'ligneBudgetaire',
      'chapitre',
      'arrets',
      'status',
    ];
    for (const key of direct) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.delaiMois !== undefined) {
      set.delaiMois = patch.delaiMois == null ? null : String(patch.delaiMois);
    }
    const [row] = await this.db
      .update(projects)
      .set(set)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning();
    return row ? mapProject(row) : null;
  }

  async softDeleteProject(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning({ id: projects.id });
    return !!row;
  }

  async restoreProject(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(projects)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(projects.id, id), sql`${projects.deletedAt} is not null`))
      .returning({ id: projects.id });
    return !!row;
  }

  async listDeletedProjects(): Promise<BtpProjectRecord[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(sql`${projects.deletedAt} is not null`)
      .orderBy(desc(projects.deletedAt));
    return rows.map(mapProject);
  }

  async listIntervenants() {
    const rows = await this.db
      .select({
        assistanceTechnique: projects.assistanceTechnique,
        maitreOeuvre: projects.maitreOeuvre,
        societe: projects.societe,
        rc: projects.rc,
        cb: projects.cb,
        cnss: projects.cnss,
        patente: projects.patente,
      })
      .from(projects)
      .where(isNull(projects.deletedAt));
    const at = new Map<string, number>();
    const moe = new Map<string, number>();
    const societes = new Map<
      string,
      {
        name: string;
        rc: string | null;
        cb: string | null;
        cnss: string | null;
        patente: string | null;
        count: number;
      }
    >();
    for (const row of rows) {
      if (row.assistanceTechnique) {
        at.set(row.assistanceTechnique, (at.get(row.assistanceTechnique) ?? 0) + 1);
      }
      if (row.maitreOeuvre) moe.set(row.maitreOeuvre, (moe.get(row.maitreOeuvre) ?? 0) + 1);
      if (row.societe) {
        const existing = societes.get(row.societe);
        if (existing) {
          existing.count += 1;
          existing.rc = existing.rc ?? row.rc;
          existing.cb = existing.cb ?? row.cb;
          existing.cnss = existing.cnss ?? row.cnss;
          existing.patente = existing.patente ?? row.patente;
        } else {
          societes.set(row.societe, {
            name: row.societe,
            rc: row.rc,
            cb: row.cb,
            cnss: row.cnss,
            patente: row.patente,
            count: 1,
          });
        }
      }
    }
    const toSorted = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      assistanceTechnique: toSorted(at),
      maitreOeuvre: toSorted(moe),
      societes: [...societes.values()].sort((a, b) => b.count - a.count),
    };
  }

  // ── Bordereau ──────────────────────────────────────────────────────────────

  async getBordereau(projectId: string): Promise<BordereauRecord | null> {
    const [row] = await this.db
      .select()
      .from(bordereaux)
      .where(and(eq(bordereaux.projectId, projectId), isNull(bordereaux.deletedAt)))
      .orderBy(asc(bordereaux.createdAt))
      .limit(1);
    return row ? mapBordereau(row) : null;
  }

  async saveBordereau(
    projectId: string,
    input: { reference?: string; designation?: string; lignes: BordereauLigne[] },
  ): Promise<BordereauRecord> {
    const totaux = computeBordereau(input.lignes);
    const saved = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(bordereaux)
        .where(and(eq(bordereaux.projectId, projectId), isNull(bordereaux.deletedAt)))
        .orderBy(asc(bordereaux.createdAt))
        .limit(1)
        .for('update');
      let row: typeof bordereaux.$inferSelect | undefined;
      if (existing) {
        [row] = await tx
          .update(bordereaux)
          .set({
            reference: input.reference ?? existing.reference,
            designation: input.designation ?? existing.designation,
            lignes: totaux.lignes,
            montantTotalMad: String(totaux.montantHt),
            updatedAt: new Date(),
          })
          .where(eq(bordereaux.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(bordereaux)
          .values({
            projectId,
            reference: input.reference,
            designation: input.designation,
            lignes: totaux.lignes,
            montantTotalMad: String(totaux.montantHt),
          })
          .returning();
      }
      // The bordereau defines the marché: refresh the official montant (TTC) —
      // source-app behaviour (bordereau.controller wrote projects.montant).
      await tx
        .update(projects)
        .set({ montantMarcheMad: String(totaux.montantTtc), updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      if (!row) throw new BtpTransitionError('Enregistrement du bordereau échoué');
      await this.rebuildChainTx(tx, projectId);
      return row;
    });
    return mapBordereau(saved);
  }

  // ── Périodes ───────────────────────────────────────────────────────────────

  async listPeriodes(projectId: string): Promise<(PeriodeRecord & { metresCount: number })[]> {
    const rows = await this.db
      .select({
        periode: periodes,
        metresCount: sql<number>`(select count(*) from ${metres} m where m.periode_id = ${periodes.id} and m.deleted_at is null)::int`,
      })
      .from(periodes)
      .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)))
      .orderBy(asc(periodes.numero));
    return rows.map((r) => ({ ...mapPeriode(r.periode), metresCount: r.metresCount }));
  }

  async createPeriode(
    projectId: string,
    input: {
      libelle?: string;
      dateDebut?: Date;
      dateFin?: Date;
      tauxTva?: number;
      tauxRetenue?: number;
      isDecompteDernier?: boolean;
    },
  ): Promise<{ periode: PeriodeRecord; decompte: DecompteRecord }> {
    return this.db.transaction(async (tx) => {
      const [aggregate] = await tx
        .select({ maxNumero: sql<number>`coalesce(max(${periodes.numero}), 0)::int` })
        .from(periodes)
        .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)));
      const numero = (aggregate?.maxNumero ?? 0) + 1;
      const [periodeRow] = await tx
        .insert(periodes)
        .values({
          projectId,
          numero,
          libelle: input.libelle ?? `Période ${numero}`,
          dateDebut: input.dateDebut ?? new Date(),
          dateFin: input.dateFin ?? new Date(),
          tauxTva: input.tauxTva != null ? String(input.tauxTva) : undefined,
          tauxRetenue: input.tauxRetenue != null ? String(input.tauxRetenue) : undefined,
          isDecompteDernier: input.isDecompteDernier ?? false,
        })
        .returning();
      if (!periodeRow) throw new BtpTransitionError('Création de la période échouée');
      // "Nouveau métré" creates the empty décompte shell at the same moment —
      // exact source-app behaviour (ProjectDetailPage.handleCreateNewMetre).
      const [decompteRow] = await tx
        .insert(decomptes)
        .values({
          projectId,
          periodeId: periodeRow.id,
          numero,
          tauxTva: periodeRow.tauxTva,
          isDernier: periodeRow.isDecompteDernier,
        })
        .returning();
      if (!decompteRow) throw new BtpTransitionError('Création du décompte échouée');
      return { periode: mapPeriode(periodeRow), decompte: mapDecompte(decompteRow) };
    });
  }

  async updatePeriode(
    projectId: string,
    periodeId: string,
    patch: Partial<{
      libelle: string;
      dateDebut: Date | null;
      dateFin: Date | null;
      tauxTva: number;
      tauxRetenue: number;
      isDecompteDernier: boolean;
      statut: string;
      observations: string;
    }>,
  ): Promise<PeriodeRecord | null> {
    const updated = await this.db.transaction(async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.libelle !== undefined) set.libelle = patch.libelle;
      if (patch.dateDebut !== undefined) set.dateDebut = patch.dateDebut;
      if (patch.dateFin !== undefined) set.dateFin = patch.dateFin;
      if (patch.tauxTva !== undefined) set.tauxTva = String(patch.tauxTva);
      if (patch.tauxRetenue !== undefined) set.tauxRetenue = String(patch.tauxRetenue);
      if (patch.isDecompteDernier !== undefined) set.isDecompteDernier = patch.isDecompteDernier;
      if (patch.statut !== undefined) set.statut = patch.statut;
      if (patch.observations !== undefined) set.observations = patch.observations;
      const [row] = await tx
        .update(periodes)
        .set(set)
        .where(
          and(
            eq(periodes.id, periodeId),
            eq(periodes.projectId, projectId),
            isNull(periodes.deletedAt),
          ),
        )
        .returning();
      if (!row) return null;
      await this.rebuildChainTx(tx, projectId);
      return row;
    });
    return updated ? mapPeriode(updated) : null;
  }

  async deletePeriode(projectId: string, periodeId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [decompteRow] = await tx
        .select()
        .from(decomptes)
        .where(and(eq(decomptes.periodeId, periodeId), isNull(decomptes.deletedAt)))
        .limit(1)
        .for('update');
      if (decompteRow && LOCKED_DECOMPTE_STATUTS.has(decompteRow.statut)) {
        throw new BtpTransitionError(
          `Le décompte n°${decompteRow.numero} est ${decompteRow.statut} — suppression impossible`,
        );
      }
      const now = new Date();
      const [periodeRow] = await tx
        .update(periodes)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(periodes.id, periodeId),
            eq(periodes.projectId, projectId),
            isNull(periodes.deletedAt),
          ),
        )
        .returning({ id: periodes.id });
      if (!periodeRow) return false;
      // Deleting a métré/période deletes its décompte too (source-app warning).
      await tx
        .update(metres)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(metres.periodeId, periodeId), isNull(metres.deletedAt)));
      if (decompteRow) {
        await tx
          .update(decomptes)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(decomptes.id, decompteRow.id));
      }
      await this.rebuildChainTx(tx, projectId);
      return true;
    });
  }

  // ── Métrés ─────────────────────────────────────────────────────────────────

  async getMetreContext(projectId: string, periodeId: string) {
    const [periodeRow] = await this.db
      .select()
      .from(periodes)
      .where(
        and(
          eq(periodes.id, periodeId),
          eq(periodes.projectId, projectId),
          isNull(periodes.deletedAt),
        ),
      )
      .limit(1);
    if (!periodeRow) return null;
    const [bordereau, allPeriodes, allMetres] = await Promise.all([
      this.getBordereau(projectId),
      this.db
        .select()
        .from(periodes)
        .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt))),
      this.db
        .select()
        .from(metres)
        .where(and(eq(metres.projectId, projectId), isNull(metres.deletedAt))),
    ]);
    const numeroByPeriode = new Map(allPeriodes.map((p) => [p.id, p.numero]));
    const current = allMetres
      .filter((m) => m.periodeId === periodeId)
      .map(mapMetre)
      .sort((a, b) => a.bordereauLigneId.localeCompare(b.bordereauLigneId));
    const previousByLigne: Record<
      string,
      { periodeNumero: number; totalPartiel: number; lignes: MetreLigne[] }[]
    > = {};
    for (const m of allMetres) {
      const numero = numeroByPeriode.get(m.periodeId);
      if (numero === undefined || numero >= periodeRow.numero) continue;
      const mapped = mapMetre(m);
      (previousByLigne[mapped.bordereauLigneId] ??= []).push({
        periodeNumero: numero,
        totalPartiel: mapped.totalPartiel,
        lignes: mapped.lignes,
      });
    }
    for (const key of Object.keys(previousByLigne)) {
      previousByLigne[key]?.sort((a, b) => a.periodeNumero - b.periodeNumero);
    }
    return { periode: mapPeriode(periodeRow), bordereau, metres: current, previousByLigne };
  }

  async saveMetres(
    projectId: string,
    periodeId: string,
    entries: MetreSaveEntry[],
  ): Promise<{ metres: MetreRecord[]; decompte: DecompteRecord | null }> {
    return this.db.transaction(async (tx) => {
      const [periodeRow] = await tx
        .select()
        .from(periodes)
        .where(
          and(
            eq(periodes.id, periodeId),
            eq(periodes.projectId, projectId),
            isNull(periodes.deletedAt),
          ),
        )
        .limit(1)
        .for('update');
      if (!periodeRow) throw new BtpTransitionError('Période introuvable');
      const [lockedDecompte] = await tx
        .select({ statut: decomptes.statut, numero: decomptes.numero })
        .from(decomptes)
        .where(and(eq(decomptes.periodeId, periodeId), isNull(decomptes.deletedAt)))
        .limit(1);
      if (lockedDecompte && LOCKED_DECOMPTE_STATUTS.has(lockedDecompte.statut)) {
        throw new BtpTransitionError(
          `Le décompte n°${lockedDecompte.numero} est ${lockedDecompte.statut} — le métré est verrouillé`,
        );
      }

      const bordereau = await this.getBordereauTx(tx, projectId);
      const bordereauByLigneId = new Map(
        (bordereau?.lignes ?? []).map((l) => [l.id ?? String(l.numero), l]),
      );

      const savedMetres: MetreRecord[] = [];
      for (const entry of entries) {
        const bordereauLigne = bordereauByLigneId.get(entry.bordereauLigneId);
        const unite = bordereauLigne?.unite ?? 'U';
        const totals = computeMetreTotals(unite, entry.sousSections, entry.lignes);
        const [existing] = await tx
          .select()
          .from(metres)
          .where(
            and(
              eq(metres.periodeId, periodeId),
              eq(metres.bordereauLigneId, entry.bordereauLigneId),
              isNull(metres.deletedAt),
            ),
          )
          .limit(1)
          .for('update');
        const values = {
          designationBordereau: bordereauLigne?.designation ?? null,
          unite,
          sections: entry.sections,
          sousSections: entry.sousSections,
          lignes: totals.lignes,
          totalPartiel: String(totals.totalPartiel),
          quantiteBordereau: String(bordereauLigne?.quantite ?? 0),
          updatedAt: new Date(),
        };
        let row: typeof metres.$inferSelect | undefined;
        if (existing) {
          [row] = await tx.update(metres).set(values).where(eq(metres.id, existing.id)).returning();
        } else {
          [row] = await tx
            .insert(metres)
            .values({
              projectId,
              periodeId,
              bordereauLigneId: entry.bordereauLigneId,
              ...values,
            })
            .returning();
        }
        if (!row) throw new BtpTransitionError('Enregistrement du métré échoué');
        savedMetres.push(mapMetre(row));
      }

      await this.rebuildChainTx(tx, projectId);
      const [decompteRow] = await tx
        .select()
        .from(decomptes)
        .where(and(eq(decomptes.periodeId, periodeId), isNull(decomptes.deletedAt)))
        .limit(1);
      return {
        metres: savedMetres,
        decompte: decompteRow ? mapDecompte(decompteRow) : null,
      };
    });
  }

  // ── Décomptes ──────────────────────────────────────────────────────────────

  async listDecomptes(projectId: string) {
    const rows = await this.db
      .select({ decompte: decomptes, periodeLibelle: periodes.libelle })
      .from(decomptes)
      .leftJoin(periodes, eq(decomptes.periodeId, periodes.id))
      .where(and(eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt)))
      .orderBy(asc(decomptes.numero));
    return rows.map((r) => ({ ...mapDecompte(r.decompte), periodeLibelle: r.periodeLibelle }));
  }

  async getDecompte(decompteId: string) {
    const [row] = await this.db
      .select()
      .from(decomptes)
      .where(and(eq(decomptes.id, decompteId), isNull(decomptes.deletedAt)))
      .limit(1);
    if (!row) return null;
    let periode: PeriodeRecord | null = null;
    if (row.periodeId) {
      const [periodeRow] = await this.db
        .select()
        .from(periodes)
        .where(eq(periodes.id, row.periodeId))
        .limit(1);
      periode = periodeRow ? mapPeriode(periodeRow) : null;
    }
    const [revisionRow] = await this.db
      .select()
      .from(decompteRevisions)
      .where(eq(decompteRevisions.decompteId, decompteId))
      .limit(1);
    return {
      ...mapDecompte(row),
      periode,
      revision: revisionRow
        ? {
            montantAReviser:
              revisionRow.montantAReviser == null ? null : num(revisionRow.montantAReviser),
            coefficient:
              revisionRow.coefficientApplique == null ? null : num(revisionRow.coefficientApplique),
            montantRevision:
              revisionRow.montantRevision == null ? null : num(revisionRow.montantRevision),
            details: revisionRow.calculationDetails,
          }
        : null,
    };
  }

  async patchDecompte(
    projectId: string,
    decompteId: string,
    patch: { dateDecompte?: Date | null; statut?: string },
  ): Promise<DecompteRecord | null> {
    const [existing] = await this.db
      .select()
      .from(decomptes)
      .where(
        and(
          eq(decomptes.id, decompteId),
          eq(decomptes.projectId, projectId),
          isNull(decomptes.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.dateDecompte !== undefined) set.dateDecompte = patch.dateDecompte;
    if (patch.statut !== undefined && patch.statut !== existing.statut) {
      set.statut = assertDecompteTransition(existing.statut, patch.statut);
    }
    const [row] = await this.db
      .update(decomptes)
      .set(set)
      .where(eq(decomptes.id, decompteId))
      .returning();
    return row ? mapDecompte(row) : null;
  }

  // ── Attachement ────────────────────────────────────────────────────────────

  async getAttachement(projectId: string, periodeId?: string) {
    const bordereau = await this.getBordereau(projectId);
    if (!bordereau) return null;
    const allPeriodes = (await this.listPeriodes(projectId)) as PeriodeRecord[];
    const target = periodeId
      ? (allPeriodes.find((p) => p.id === periodeId) ?? null)
      : (allPeriodes[allPeriodes.length - 1] ?? null);
    const allMetres = await this.db
      .select()
      .from(metres)
      .where(and(eq(metres.projectId, projectId), isNull(metres.deletedAt)));
    const numeroByPeriode = new Map(allPeriodes.map((p) => [p.id, p.numero]));
    const targetNumero = target?.numero ?? Number.MAX_SAFE_INTEGER;

    const previous = new Map<string, number>();
    const currentPeriode = new Map<string, number>();
    for (const m of allMetres) {
      const numero = numeroByPeriode.get(m.periodeId);
      if (numero === undefined || numero > targetNumero) continue;
      const key = m.bordereauLigneId;
      const total = num(m.totalPartiel);
      if (numero === targetNumero) {
        currentPeriode.set(
          key,
          toNumber(round2(toDecimal(currentPeriode.get(key) ?? 0).plus(total))),
        );
      } else {
        previous.set(key, toNumber(round2(toDecimal(previous.get(key) ?? 0).plus(total))));
      }
    }

    const lignes: AttachementLigne[] = bordereau.lignes.map((ligne) => {
      const key = ligne.id ?? String(ligne.numero);
      const prev = previous.get(key) ?? 0;
      const cur = currentPeriode.get(key) ?? 0;
      return {
        prixNo: ligne.numero,
        designation: ligne.designation,
        unite: ligne.unite,
        quantiteBordereau: ligne.quantite,
        quantitePrecedente: prev,
        quantitePeriode: cur,
        quantiteCumulee: toNumber(round2(toDecimal(prev).plus(cur))),
      };
    });
    return { periode: target, isDernier: target?.isDecompteDernier ?? false, lignes };
  }

  // ── Chain rebuild (the automation core) ────────────────────────────────────

  async rebuildProjectChain(projectId: string): Promise<void> {
    await this.db.transaction(async (tx) => this.rebuildChainTx(tx, projectId));
  }

  private async getBordereauTx(tx: Tx, projectId: string): Promise<BordereauRecord | null> {
    const [row] = await tx
      .select()
      .from(bordereaux)
      .where(and(eq(bordereaux.projectId, projectId), isNull(bordereaux.deletedAt)))
      .orderBy(asc(bordereaux.createdAt))
      .limit(1);
    return row ? mapBordereau(row) : null;
  }

  /**
   * Recomputes, in numero order, every période's décompte from the métrés —
   * cumulative quantities, TVA/TTC, exercices antérieurs vs décomptes
   * précédents, retenue de garantie, révision on the dernier — then refreshes
   * the métrés' cumulés and the project progress. Idempotent.
   */
  private async rebuildChainTx(tx: Tx, projectId: string): Promise<void> {
    const bordereau = await this.getBordereauTx(tx, projectId);
    const bordereauLignes = bordereau?.lignes ?? [];
    const [periodeRows, metreRows, existingDecomptes, configRow] = await Promise.all([
      tx
        .select()
        .from(periodes)
        .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)))
        .orderBy(asc(periodes.numero)),
      tx
        .select()
        .from(metres)
        .where(and(eq(metres.projectId, projectId), isNull(metres.deletedAt))),
      tx
        .select()
        .from(decomptes)
        .where(and(eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt)))
        .for('update'),
      tx
        .select()
        .from(projectRevisionConfig)
        .where(eq(projectRevisionConfig.projectId, projectId))
        .limit(1),
    ]);

    // Révision context (formula + monthly indexes), loaded once.
    const config = configRow[0];
    let formula: RevisionFormulaSpec | null = null;
    let monthlyIndexes: Map<string, IndexValues> | null = null;
    if (config?.isEnabled && config.formulaId) {
      const [formulaRow] = await tx
        .select()
        .from(revisionFormulas)
        .where(eq(revisionFormulas.id, config.formulaId))
        .limit(1);
      if (formulaRow) {
        formula = {
          id: formulaRow.id,
          name: formulaRow.name,
          fixedPart: num(formulaRow.fixedPart),
          weights: (formulaRow.weights as Record<string, number>) ?? {},
        };
        const indexRows = await tx.select().from(revisionIndexes);
        monthlyIndexes = new Map(
          indexRows.map((r) => [dateToMonthKey(r.monthDate), (r.indexValues as IndexValues) ?? {}]),
        );
      }
    }

    const metresByPeriode = new Map<string, (typeof metreRows)[number][]>();
    for (const m of metreRows) {
      const bucket = metresByPeriode.get(m.periodeId);
      if (bucket) bucket.push(m);
      else metresByPeriode.set(m.periodeId, [m]);
    }
    const decompteByPeriode = new Map(
      existingDecomptes.filter((d) => d.periodeId).map((d) => [d.periodeId as string, d]),
    );

    const cumulative = new Map<string, number>(); // ligneId → cumul (rounded)
    const priorAcomptes: PriorDecompteAcompte[] = [];
    let dernierTtc = 0;

    for (const periodeRow of periodeRows) {
      // Add this période's métré totals to the running cumulative.
      const periodeMetres = metresByPeriode.get(periodeRow.id) ?? [];
      for (const m of periodeMetres) {
        const prev = cumulative.get(m.bordereauLigneId) ?? 0;
        cumulative.set(
          m.bordereauLigneId,
          toNumber(round2(toDecimal(prev).plus(num(m.totalPartiel)))),
        );
      }
      // Refresh each métré's cumulé + % réalisation columns.
      for (const m of periodeMetres) {
        const cumul = cumulative.get(m.bordereauLigneId) ?? 0;
        await tx
          .update(metres)
          .set({
            totalCumule: String(cumul),
            pourcentageRealisation: String(
              computePourcentageRealisation(cumul, num(m.quantiteBordereau)),
            ),
          })
          .where(eq(metres.id, m.id));
      }

      const anneeCourante = (
        periodeRow.dateDebut ??
        periodeRow.dateFin ??
        periodeRow.createdAt
      ).getFullYear();

      // Révision coefficient for the dernier décompte only.
      let revisionCoefficient: number | null = null;
      let revisionTrace: ReturnType<typeof calculateDecompteRevision> | null = null;
      if (
        periodeRow.isDecompteDernier &&
        formula &&
        monthlyIndexes &&
        config &&
        Object.keys((config.baseIndexes as IndexValues) ?? {}).length > 0
      ) {
        const start = periodeRow.dateDebut ?? periodeRow.dateFin ?? periodeRow.createdAt;
        const end = periodeRow.dateFin ?? periodeRow.dateDebut ?? periodeRow.createdAt;
        // montantAReviser = cumulative HT before révision — applied by the
        // finance engine; the coefficient only depends on dates/indexes.
        revisionTrace = calculateDecompteRevision({
          montantAReviser: 0,
          periodStart: start,
          periodEnd: end,
          baseIndexes: (config.baseIndexes as IndexValues) ?? {},
          monthlyIndexes,
          formula,
        });
        revisionCoefficient = revisionTrace.coefficient;
      }

      const computation = computeDecompte({
        bordereauLignes,
        cumulativeQuantites: cumulative,
        tauxTva: num(periodeRow.tauxTva),
        tauxRetenue: num(periodeRow.tauxRetenue),
        isDernier: periodeRow.isDecompteDernier,
        priorAcomptes,
        anneeCourante,
        revisionCoefficient,
      });

      const existing = decompteByPeriode.get(periodeRow.id);
      const values = {
        numero: periodeRow.numero,
        lignes: computation.lignes,
        tauxTva: String(num(periodeRow.tauxTva)),
        totalHtMad: String(computation.totalHt),
        revisionMontantMad: String(computation.revisionMontant),
        montantTvaMad: String(computation.montantTva),
        totalTtcMad: String(computation.totalTtc),
        depensesAnterieuresMad: String(computation.depensesAnterieures),
        decomptesPrecedentsMad: String(computation.decomptesPrecedents),
        retenueGarantieMad: String(computation.retenueGarantie),
        montantAcompteMad: String(computation.montantAcompte),
        isDernier: periodeRow.isDecompteDernier,
        updatedAt: new Date(),
      };
      let decompteId: string;
      if (existing) {
        decompteId = existing.id;
        await tx.update(decomptes).set(values).where(eq(decomptes.id, existing.id));
      } else {
        const [inserted] = await tx
          .insert(decomptes)
          .values({ projectId, periodeId: periodeRow.id, ...values })
          .returning({ id: decomptes.id });
        if (!inserted) throw new BtpTransitionError('Création du décompte échouée');
        decompteId = inserted.id;
      }

      // Persist the révision trace (or clear it when no longer applicable).
      if (revisionCoefficient != null && revisionTrace && computation.revisionMontant !== 0) {
        const revisionValues = {
          montantAReviser: String(computation.totalHt),
          coefficientApplique: String(revisionCoefficient),
          montantRevision: String(computation.revisionMontant),
          calculationDetails: {
            totalDays: revisionTrace.totalDays,
            details: revisionTrace.details,
            missingMonths: revisionTrace.missingMonths,
          },
          formulaSnapshot: formula,
          baseIndexesSnapshot: (config?.baseIndexes as IndexValues) ?? {},
          updatedAt: new Date(),
        };
        const [existingRevision] = await tx
          .select({ id: decompteRevisions.id })
          .from(decompteRevisions)
          .where(eq(decompteRevisions.decompteId, decompteId))
          .limit(1);
        if (existingRevision) {
          await tx
            .update(decompteRevisions)
            .set(revisionValues)
            .where(eq(decompteRevisions.id, existingRevision.id));
        } else {
          await tx.insert(decompteRevisions).values({ decompteId, ...revisionValues });
        }
      } else {
        await tx.delete(decompteRevisions).where(eq(decompteRevisions.decompteId, decompteId));
      }

      priorAcomptes.push({ montantAcompte: computation.montantAcompte, annee: anneeCourante });
      dernierTtc = computation.totalTtc;
    }

    // Progress % (financial): dernier TTC ÷ marché TTC.
    const progress = bordereauLignes.length ? computeProgressPct(dernierTtc, bordereauLignes) : 0;
    await tx
      .update(projects)
      .set({ progressPct: String(progress), updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }
}

// ─── Unavailable fallback (no DATABASE_URL) ──────────────────────────────────

/** Fails fast with a clear message instead of silently no-oping in dev. */
export function unavailableBtpRepository<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return () => {
        throw new Error(
          `${name}: DATABASE_URL non configurée — le module Projets BTP nécessite Postgres`,
        );
      };
    },
  });
}

export function newId(): string {
  return randomUUID();
}
