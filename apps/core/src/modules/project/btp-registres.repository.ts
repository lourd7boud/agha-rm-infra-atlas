// Registres repository — révision des prix entities, avenants, ordres de
// service, pénalités/cautionsBtp/retenues and the validation circuit. Pure CRUD +
// the status machines from btp-registres.domain; the execution chain rebuild
// stays in btp.repository (callers re-trigger it when a change affects money).
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  approvalHistory,
  approvalRequests,
  approvalSteps,
  avenants,
  cautionsBtp,
  decompteRevisions,
  decomptes,
  ordresService,
  penalites,
  projectRevisionConfig,
  projects,
  retenues,
  revisionFormulas,
  revisionIndexAudit,
  revisionIndexes,
} from '../../db/schema';
import { round2, toDecimal, toNumber } from './btp-finance.domain';
import {
  BtpTransitionError,
  assertAvenantTransition,
  assertCautionTransition,
  assertOdsTransition,
  assertPenaliteTransition,
  computePenalite,
  withStopIds,
  type ArretTravaux,
  type OdsAction,
} from './btp-registres.domain';
import { chantierStart, revisionDate, validateFormula, type IndexValues, type PublishedIndexes, type RevisionPostingMode } from './btp-revision.domain';
import { applyApprovedAvenantAmount, approvedAvenant, currentContractAmount, currentContractAmountSql, DrizzleBtpExecutionRepository, listApprovedBordereauImpacts, lockBtpProject, sumApprovedAvenants, type BtpTransaction } from './btp.repository';
import { avenantBordereauImpactSchema, storedAvenantBordereauImpactSchema, priceAvenantBordereau, type AvenantBordereauImpact, type StoredAvenantBordereauImpact } from './btp-avenant-bordereau.domain';
import { shouldApplyMonthlyIndex } from './btp-index-sync.domain';

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function optNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

// ─── Records ─────────────────────────────────────────────────────────────────

export interface RevisionFormulaRecord {
  id: string;
  name: string;
  description: string | null;
  fixedPart: number;
  weights: Record<string, number>;
  isDefault: boolean;
}

export interface RevisionIndexRecord {
  id: string;
  monthDate: Date;
  indexValues: IndexValues;
  source: string | null;
  notes: string | null;
  status: string;
  publishedOn: string | null;
  updatedAt: Date;
}

export interface RevisionConfigRecord {
  id: string;
  projectId: string;
  formulaId: string | null;
  baseIndexes: IndexValues;
  baseDate: Date | null;
  contractDeadline: Date | null;
  delayAttributable: boolean | null;
  postingMode: RevisionPostingMode;
  isEnabled: boolean;
  notes: string | null;
}

export interface AvenantBtpRecord {
  id: string;
  projectId: string;
  numero: number;
  objet: string;
  reference: string | null;
  typeAvenant: string;
  statut: string;
  dateAvenant: Date | null;
  dateNotification: Date | null;
  dateApprobation: Date | null;
  montantDeltaMad: number;
  delaiDeltaMois: number;
  montantInitialMad: number | null;
  montantNouveauMad: number | null;
  pourcentageVariation: number | null;
  modifications: unknown[];
  prixNouveaux: unknown[];
  bordereauImpact: StoredAvenantBordereauImpact | null;
  observations: string | null;
  createdAt: Date;
}

export interface OdsRecord {
  id: string;
  projectId: string;
  numero: number;
  reference: string | null;
  type: string;
  objet: string;
  description: string | null;
  motif: string | null;
  dateEmission: Date | null;
  dateEffet: Date | null;
  arretScope: 'total' | 'partiel' | null;
  repriseArretId: string | null;
  calendarEffectAppliedAt: Date | null;
  dateFin: Date | null;
  delaiJours: number | null;
  impactFinancierMad: number;
  impactDelaiJours: number;
  emetteur: string | null;
  emetteurFonction: string | null;
  destinataire: string | null;
  avenantId: string | null;
  statut: string;
  dateNotification: Date | null;
  dateAccuseReception: Date | null;
  accusePar: string | null;
  observationsDestinataire: string | null;
  createdAt: Date;
}

export interface PenaliteRecord {
  id: string;
  projectId: string;
  type: string;
  dateDebut: Date | null;
  dateFin: Date | null;
  nombreJours: number;
  taux: number;
  baseCalculMad: number | null;
  montantPenaliteMad: number;
  plafondPourcentage: number;
  montantPlafondMad: number | null;
  montantAppliqueMad: number;
  statut: string;
  referenceNotification: string | null;
  dateNotification: Date | null;
  motif: string | null;
  observations: string | null;
  createdAt: Date;
}

export interface CautionRecord {
  id: string;
  projectId: string;
  type: string;
  montantMad: number;
  pourcentage: number | null;
  baseCalculMad: number | null;
  organisme: string | null;
  referenceOrganisme: string | null;
  dateEmission: Date | null;
  dateExpiration: Date | null;
  dateMainlevee: Date | null;
  statut: string;
  observations: string | null;
  createdAt: Date;
}

export interface RetenueRecord {
  id: string;
  projectId: string;
  cautionId: string | null;
  decompteId: string | null;
  decompteNumero: number | null;
  montantDecompteMad: number | null;
  tauxRetenue: number;
  montantRetenueMad: number;
  montantCumuleMad: number | null;
  liberee: boolean;
  dateLiberation: Date | null;
  createdAt: Date;
}

export interface ApprovalStepRecord {
  id: string;
  requestId: string;
  stepOrder: number;
  stepLabel: string;
  role: string | null;
  status: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionDate: Date | null;
  comment: string | null;
}

export interface ApprovalRequestRecord {
  id: string;
  projectId: string;
  documentType: string;
  documentId: string | null;
  documentReference: string | null;
  status: string;
  currentStep: number;
  totalSteps: number;
  priority: string;
  dueDate: Date | null;
  note: string | null;
  montantMad: number | null;
  requestedBy: string | null;
  requestedByName: string | null;
  submittedAt: Date;
  completedAt: Date | null;
  steps: ApprovalStepRecord[];
}

export interface Actor {
  sub: string;
  name: string;
}

export const BTP_REGISTRES_REPOSITORY = Symbol('BTP_REGISTRES_REPOSITORY');

export interface BtpRegistresRepository {
  // Révision des prix
  listFormulas(linkedFormulaId?: string | null): Promise<RevisionFormulaRecord[]>;
  saveFormula(input: {
    id?: string;
    name: string;
    description?: string;
    fixedPart: number;
    weights: Record<string, number>;
    isDefault?: boolean;
  }): Promise<RevisionFormulaRecord>;
  deleteFormula(id: string): Promise<boolean>;
  listIndexes(year?: number): Promise<RevisionIndexRecord[]>;
  upsertIndexMonth(
    input: {
      monthDate: Date;
      indexValues: IndexValues;
      source?: string;
      notes?: string;
      status?: string;
      publishedOn?: string;
    },
    actor: Actor,
  ): Promise<RevisionIndexRecord>;
  deleteIndexMonth(monthDate: Date, actor: Actor): Promise<boolean>;
  listIndexAudit(limit?: number): Promise<
    {
      id: string;
      monthDate: Date | null;
      action: string;
      actorName: string | null;
      changes: unknown;
      createdAt: Date;
    }[]
  >;
  getRevisionConfig(projectId: string): Promise<RevisionConfigRecord | null>;
  saveRevisionConfig(
    projectId: string,
    input: {
      formulaId?: string | null;
      formula?: { fixedPart: number; weights: Record<string, number> };
      baseIndexes?: IndexValues;
      baseDate?: Date | null;
      contractDeadline?: Date | null;
      delayAttributable?: boolean | null;
      postingMode?: RevisionPostingMode;
      isEnabled?: boolean;
      notes?: string | null;
    },
  ): Promise<RevisionConfigRecord>;

  // Avenants
  listAvenants(projectId: string): Promise<AvenantBtpRecord[]>;
  createAvenant(
    projectId: string,
    input: {
      objet: string;
      reference?: string;
      typeAvenant?: string;
      dateAvenant?: Date;
      dateNotification?: Date;
      montantDeltaMad?: number;
      delaiDeltaMois?: number;
      modifications?: unknown[];
      prixNouveaux?: unknown[];
      bordereauImpact?: AvenantBordereauImpact | null;
      observations?: string;
    },
  ): Promise<AvenantBtpRecord>;
  updateAvenant(
    projectId: string,
    avenantId: string,
    patch: Partial<{
      objet: string;
      reference: string;
      typeAvenant: string;
      dateAvenant: Date | null;
      dateNotification: Date | null;
      montantDeltaMad: number;
      delaiDeltaMois: number;
      modifications: unknown[];
      prixNouveaux: unknown[];
      bordereauImpact: AvenantBordereauImpact | null;
      observations: string;
    }>,
  ): Promise<AvenantBtpRecord | null>;
  transitionAvenant(
    projectId: string,
    avenantId: string,
    to: string,
    dateApprobation?: Date,
  ): Promise<AvenantBtpRecord | null>;
  deleteAvenant(projectId: string, avenantId: string): Promise<boolean>;
  avenantSummary(projectId: string): Promise<{
    montantInitial: number | null;
    totalAvenants: number;
    montantActuel: number;
    delaiInitialMois: number;
    delaiSupplementaireMois: number;
    count: number;
    approuves: number;
  }>;
  approvedExtensions(projectIds: string[]): Promise<Map<string, number>>;

  // ODS
  listOds(projectId: string): Promise<OdsRecord[]>;
  createOds(
    projectId: string,
    input: {
      type?: string;
      objet: string;
      description?: string;
      motif?: string;
      dateEmission?: Date;
      dateEffet?: Date;
      arretScope?: 'total' | 'partiel';
      repriseArretId?: string;
      dateFin?: Date;
      delaiJours?: number;
      impactFinancierMad?: number;
      impactDelaiJours?: number;
      emetteur?: string;
      emetteurFonction?: string;
      destinataire?: string;
      avenantId?: string;
    },
  ): Promise<OdsRecord>;
  updateOds(
    projectId: string,
    odsId: string,
    patch: Partial<{
      type: string;
      objet: string;
      description: string;
      motif: string;
      dateEmission: Date | null;
      dateEffet: Date | null;
      arretScope: 'total' | 'partiel' | null;
      repriseArretId: string | null;
      dateFin: Date | null;
      delaiJours: number | null;
      impactFinancierMad: number;
      impactDelaiJours: number;
      emetteur: string;
      emetteurFonction: string;
      destinataire: string;
      observationsDestinataire: string;
    }>,
  ): Promise<OdsRecord | null>;
  actionOds(
    projectId: string,
    odsId: string,
    action: OdsAction,
    meta?: { accusePar?: string; dateNotification?: Date; dateEffet?: Date; arretScope?: 'total' | 'partiel'; repriseArretId?: string },
  ): Promise<OdsRecord | null>;
  deleteOds(projectId: string, odsId: string): Promise<boolean>;

  // Pénalités / cautionsBtp / retenues
  listPenalites(projectId: string): Promise<PenaliteRecord[]>;
  createPenalite(
    projectId: string,
    input: {
      type?: string;
      dateDebut?: Date;
      dateFin?: Date;
      nombreJours: number;
      taux?: number;
      baseCalculMad?: number;
      plafondPourcentage?: number;
      motif?: string;
      observations?: string;
    },
  ): Promise<PenaliteRecord>;
  transitionPenalite(
    projectId: string,
    penaliteId: string,
    to: string,
    meta?: { referenceNotification?: string; dateNotification?: Date },
  ): Promise<PenaliteRecord | null>;
  deletePenalite(projectId: string, penaliteId: string): Promise<boolean>;
  listCautions(projectId: string): Promise<CautionRecord[]>;
  createCaution(
    projectId: string,
    input: {
      type: string;
      montantMad?: number;
      pourcentage?: number;
      baseCalculMad?: number;
      organisme?: string;
      referenceOrganisme?: string;
      dateEmission?: Date;
      dateExpiration?: Date;
      observations?: string;
    },
  ): Promise<CautionRecord>;
  transitionCaution(
    projectId: string,
    cautionId: string,
    to: string,
    dateMainlevee?: Date,
  ): Promise<CautionRecord | null>;
  deleteCaution(projectId: string, cautionId: string): Promise<boolean>;
  listRetenues(projectId: string): Promise<RetenueRecord[]>;
  syncRetenuesFromDecomptes(projectId: string): Promise<RetenueRecord[]>;
  libererRetenue(projectId: string, retenueId: string): Promise<RetenueRecord | null>;

  // Circuit de validation
  listApprovals(projectId: string): Promise<ApprovalRequestRecord[]>;
  createApproval(
    projectId: string,
    input: {
      documentType: string;
      documentId?: string;
      documentReference?: string;
      priority?: string;
      dueDate?: Date;
      note?: string;
      montantMad?: number;
      steps?: { stepLabel: string; role?: string }[];
    },
    actor: Actor,
  ): Promise<ApprovalRequestRecord>;
  decideApproval(
    requestId: string,
    decision: 'approve' | 'reject' | 'cancel',
    actor: Actor,
    comment?: string,
  ): Promise<ApprovalRequestRecord | null>;
}

// ─── Drizzle implementation ──────────────────────────────────────────────────

function mapFormula(row: typeof revisionFormulas.$inferSelect): RevisionFormulaRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    fixedPart: num(row.fixedPart),
    weights: (row.weights as Record<string, number>) ?? {},
    isDefault: row.isDefault,
  };
}

function mapIndex(row: typeof revisionIndexes.$inferSelect): RevisionIndexRecord {
  return {
    id: row.id,
    monthDate: row.monthDate,
    indexValues: (row.indexValues as IndexValues) ?? {},
    source: row.source ?? null,
    notes: row.notes ?? null,
    status: row.status,
    publishedOn: row.publishedOn,
    updatedAt: row.updatedAt,
  };
}

function mapConfig(row: typeof projectRevisionConfig.$inferSelect): RevisionConfigRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    formulaId: row.formulaId ?? null,
    baseIndexes: (row.baseIndexes as IndexValues) ?? {},
    baseDate: row.baseDate ?? null,
    contractDeadline: row.contractDeadline,
    delayAttributable: row.delayAttributable,
    postingMode: row.postingMode,
    isEnabled: row.isEnabled,
    notes: row.notes ?? null,
  };
}

function mapAvenant(row: typeof avenants.$inferSelect): AvenantBtpRecord {
  // Legacy rows (pre-BTP) carried approvedAt with statut defaulted 'brouillon'.
  const statut =
    row.statut === 'brouillon' && row.approvedAt ? 'approuve' : (row.statut ?? 'brouillon');
  return {
    id: row.id,
    projectId: row.projectId,
    numero: row.numero,
    objet: row.objet,
    reference: row.reference ?? null,
    typeAvenant: row.typeAvenant ?? 'modification',
    statut,
    dateAvenant: row.dateAvenant ?? null,
    dateNotification: row.dateNotification ?? null,
    dateApprobation: row.dateApprobation ?? row.approvedAt ?? null,
    montantDeltaMad: num(row.montantDeltaMad),
    delaiDeltaMois: num(row.delaiDeltaMois),
    montantInitialMad: optNum(row.montantInitialMad),
    montantNouveauMad: optNum(row.montantNouveauMad),
    pourcentageVariation: optNum(row.pourcentageVariation),
    modifications: (row.modifications as unknown[]) ?? [],
    prixNouveaux: (row.prixNouveaux as unknown[]) ?? [],
    bordereauImpact: readAvenantImpact(row.bordereauImpact, true),
    observations: row.observations ?? null,
    createdAt: row.createdAt,
  };
}

function readAvenantImpact(data: unknown, stored = false): StoredAvenantBordereauImpact | null {
  if (data == null) return null;
  const parsed = (stored ? storedAvenantBordereauImpactSchema : avenantBordereauImpactSchema).safeParse(data);
  if (!parsed.success) throw new BtpTransitionError('L’impact du bordereau de l’avenant est invalide.');
  return parsed.data;
}

function mapOds(row: typeof ordresService.$inferSelect): OdsRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    numero: row.numero,
    reference: row.reference ?? null,
    type: row.type,
    objet: row.objet,
    description: row.description ?? null,
    motif: row.motif ?? null,
    dateEmission: row.dateEmission ?? null,
    dateEffet: row.dateEffet ?? null,
    arretScope: row.arretScope ?? null,
    repriseArretId: row.repriseArretId ?? null,
    calendarEffectAppliedAt: row.calendarEffectAppliedAt ?? null,
    dateFin: row.dateFin ?? null,
    delaiJours: row.delaiJours ?? null,
    impactFinancierMad: num(row.impactFinancierMad),
    impactDelaiJours: row.impactDelaiJours,
    emetteur: row.emetteur ?? null,
    emetteurFonction: row.emetteurFonction ?? null,
    destinataire: row.destinataire ?? null,
    avenantId: row.avenantId ?? null,
    statut: row.statut,
    dateNotification: row.dateNotification ?? null,
    dateAccuseReception: row.dateAccuseReception ?? null,
    accusePar: row.accusePar ?? null,
    observationsDestinataire: row.observationsDestinataire ?? null,
    createdAt: row.createdAt,
  };
}

function mapPenalite(row: typeof penalites.$inferSelect): PenaliteRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    dateDebut: row.dateDebut ?? null,
    dateFin: row.dateFin ?? null,
    nombreJours: row.nombreJours,
    taux: num(row.taux),
    baseCalculMad: optNum(row.baseCalculMad),
    montantPenaliteMad: num(row.montantPenaliteMad),
    plafondPourcentage: num(row.plafondPourcentage),
    montantPlafondMad: optNum(row.montantPlafondMad),
    montantAppliqueMad: num(row.montantAppliqueMad),
    statut: row.statut,
    referenceNotification: row.referenceNotification ?? null,
    dateNotification: row.dateNotification ?? null,
    motif: row.motif ?? null,
    observations: row.observations ?? null,
    createdAt: row.createdAt,
  };
}

function mapCaution(row: typeof cautionsBtp.$inferSelect): CautionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    montantMad: num(row.montantMad),
    pourcentage: optNum(row.pourcentage),
    baseCalculMad: optNum(row.baseCalculMad),
    organisme: row.organisme ?? null,
    referenceOrganisme: row.referenceOrganisme ?? null,
    dateEmission: row.dateEmission ?? null,
    dateExpiration: row.dateExpiration ?? null,
    dateMainlevee: row.dateMainlevee ?? null,
    statut: row.statut,
    observations: row.observations ?? null,
    createdAt: row.createdAt,
  };
}

function mapRetenue(row: typeof retenues.$inferSelect): RetenueRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    cautionId: row.cautionId ?? null,
    decompteId: row.decompteId ?? null,
    decompteNumero: row.decompteNumero ?? null,
    montantDecompteMad: optNum(row.montantDecompteMad),
    tauxRetenue: num(row.tauxRetenue),
    montantRetenueMad: num(row.montantRetenueMad),
    montantCumuleMad: optNum(row.montantCumuleMad),
    liberee: row.liberee,
    dateLiberation: row.dateLiberation ?? null,
    createdAt: row.createdAt,
  };
}

function mapStep(row: typeof approvalSteps.$inferSelect): ApprovalStepRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    stepOrder: row.stepOrder,
    stepLabel: row.stepLabel,
    role: row.role ?? null,
    status: row.status,
    decidedBy: row.decidedBy ?? null,
    decidedByName: row.decidedByName ?? null,
    decisionDate: row.decisionDate ?? null,
    comment: row.comment ?? null,
  };
}

export class DrizzleBtpRegistresRepository implements BtpRegistresRepository {
  private readonly execution: DrizzleBtpExecutionRepository;

  constructor(private readonly db: Db) {
    this.execution = new DrizzleBtpExecutionRepository(db);
  }

  private async rebuildRevisionProjects(tx: BtpTransaction) {
    const active = await tx.select({ id: projects.id }).from(projects)
      .innerJoin(projectRevisionConfig, eq(projectRevisionConfig.projectId, projects.id))
      .where(and(eq(projectRevisionConfig.isEnabled, true), isNull(projects.deletedAt)))
      .orderBy(asc(projects.id));
    for (const { id } of active) await this.execution.rebuildChainTx(tx, id);
  }

  // ── Révision des prix ──────────────────────────────────────────────────────

  async listFormulas(linkedFormulaId?: string | null): Promise<RevisionFormulaRecord[]> {
    const rows = await this.db
      .select()
      .from(revisionFormulas)
      .where(or(eq(revisionFormulas.isPublic, true), linkedFormulaId ? eq(revisionFormulas.id, linkedFormulaId) : undefined))
      .orderBy(desc(revisionFormulas.isDefault), asc(revisionFormulas.name));
    return rows.map(mapFormula);
  }

  async saveFormula(input: {
    id?: string;
    name: string;
    description?: string;
    fixedPart: number;
    weights: Record<string, number>;
    isDefault?: boolean;
  }): Promise<RevisionFormulaRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('btp-revision-indexes'))`);
      if (input.id) {
        const [used] = await tx.select({ id: projectRevisionConfig.id }).from(projectRevisionConfig)
          .where(eq(projectRevisionConfig.formulaId, input.id)).limit(1);
        if (used) throw new BtpTransitionError('Cette formule est liée à un marché. Créer une nouvelle formule pour modifier les coefficients.');
      }
      if (input.isDefault) {
        await tx.update(revisionFormulas).set({ isDefault: false });
      }
      if (input.id) {
        const [row] = await tx
          .update(revisionFormulas)
          .set({
            name: input.name,
            description: input.description,
            fixedPart: String(input.fixedPart),
            weights: input.weights,
            isDefault: input.isDefault ?? false,
            updatedAt: new Date(),
          })
          .where(eq(revisionFormulas.id, input.id))
          .returning();
        if (!row) throw new BtpTransitionError('Formule introuvable');
        return mapFormula(row);
      }
      const [row] = await tx
        .insert(revisionFormulas)
        .values({
          name: input.name,
          description: input.description,
          fixedPart: String(input.fixedPart),
          weights: input.weights,
          isDefault: input.isDefault ?? false,
        })
        .returning();
      if (!row) throw new BtpTransitionError('Création de la formule échouée');
      return mapFormula(row);
    });
  }

  async deleteFormula(id: string): Promise<boolean> {
    const [used] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectRevisionConfig)
      .where(eq(projectRevisionConfig.formulaId, id));
    if ((used?.count ?? 0) > 0) {
      throw new BtpTransitionError('Formule utilisée par au moins un marché — suppression refusée');
    }
    const rows = await this.db
      .delete(revisionFormulas)
      .where(eq(revisionFormulas.id, id))
      .returning({ id: revisionFormulas.id });
    return rows.length > 0;
  }

  async listIndexes(year?: number): Promise<RevisionIndexRecord[]> {
    const where = year ? sql`extract(year from ${revisionIndexes.monthDate}) = ${year}` : undefined;
    const rows = await this.db
      .select()
      .from(revisionIndexes)
      .where(where)
      .orderBy(desc(revisionIndexes.monthDate));
    return rows.map(mapIndex);
  }

  async upsertIndexMonth(
    input: {
      monthDate: Date;
      indexValues: IndexValues;
      source?: string;
      notes?: string;
      status?: string;
      publishedOn?: string;
    },
    actor: Actor,
  ): Promise<RevisionIndexRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('btp-revision-indexes'))`);
      const row = await this.upsertIndexMonthTx(tx, input, actor);
      await this.rebuildRevisionProjects(tx);
      return row!;
    });
  }

  async upsertIndexMonthsTx(
    tx: BtpTransaction, inputs: Parameters<BtpRegistresRepository['upsertIndexMonth']>[0][], actor: Actor, automatic = false,
  ) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('btp-revision-indexes'))`);
    const rows: RevisionIndexRecord[] = [];
    for (const input of inputs) {
      const row = await this.upsertIndexMonthTx(tx, input, actor, automatic);
      if (row) rows.push(row);
    }
    if (rows.length) await this.rebuildRevisionProjects(tx);
    return rows;
  }

  private async upsertIndexMonthTx(
    tx: BtpTransaction, input: Parameters<BtpRegistresRepository['upsertIndexMonth']>[0], actor: Actor, automatic = false,
  ): Promise<RevisionIndexRecord | null> {
      const monthStart = new Date(`${revisionDate(input.monthDate).slice(0, 7)}-01T00:00:00Z`);
      const [existing] = await tx
        .select()
        .from(revisionIndexes)
        .where(eq(revisionIndexes.monthDate, monthStart))
        .limit(1)
        .for('update');
      if (existing && automatic && !shouldApplyMonthlyIndex(existing, input)) {
        if (!input.publishedOn || !input.source || !input.status) return null;
        const previous = existing.previousPublications as PublishedIndexes[];
        const samePublication = ({ source, status, publishedOn }: Pick<PublishedIndexes, 'source' | 'status' | 'publishedOn'>) =>
          source === input.source && status === input.status && publishedOn === input.publishedOn;
        if (samePublication(existing) || previous.some(samePublication)) return null;
        const publication = { values: input.indexValues, source: input.source, status: input.status, publishedOn: input.publishedOn };
        const [retained] = await tx.update(revisionIndexes).set({
          previousPublications: [publication, ...previous], updatedAt: new Date(),
        }).where(eq(revisionIndexes.id, existing.id)).returning();
        await tx.insert(revisionIndexAudit).values({
          monthDate: monthStart, action: 'update', actorSub: actor.sub, actorName: actor.name,
          changes: { publication }, source: input.source,
        });
        return retained ? mapIndex(retained) : null;
      }
      let row: typeof revisionIndexes.$inferSelect | undefined;
      if (existing) {
        const previousPublications = [...existing.previousPublications as PublishedIndexes[]];
        const oldValues = existing.indexValues as IndexValues;
        const valuesChanged = Object.keys(oldValues).length !== Object.keys(input.indexValues).length ||
          Object.entries(oldValues).some(([code, value]) => input.indexValues[code] !== value);
        if (existing.publishedOn && existing.source && (
          valuesChanged || existing.publishedOn !== (input.publishedOn ?? null) ||
          existing.source !== (input.source ?? existing.source) || existing.status !== (input.status ?? existing.status)
        )) {
          previousPublications.unshift({
            values: existing.indexValues as IndexValues, status: existing.status,
            source: existing.source, publishedOn: existing.publishedOn,
          });
        }
        [row] = await tx
          .update(revisionIndexes)
          .set({
            indexValues: input.indexValues,
            source: input.source ?? existing.source,
            notes: input.notes ?? (existing.notes?.startsWith('Import ') ? null : existing.notes),
            status: input.status ?? existing.status,
            publishedOn: input.publishedOn ?? null,
            previousPublications,
            updatedAt: new Date(),
          })
          .where(eq(revisionIndexes.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(revisionIndexes)
          .values({
            monthDate: monthStart,
            indexValues: input.indexValues,
            source: input.source,
            notes: input.notes,
            status: input.status ?? 'provisoire',
            publishedOn: input.publishedOn,
            createdBy: actor.sub,
          })
          .returning();
      }
      if (!row) throw new BtpTransitionError("Enregistrement de l'index échoué");
      await tx.insert(revisionIndexAudit).values({
        monthDate: monthStart,
        action: existing ? 'update' : 'create',
        actorSub: actor.sub,
        actorName: actor.name,
        changes: {
          indexValues: row.indexValues, status: row.status, publishedOn: row.publishedOn,
          before: existing ? {
            indexValues: existing.indexValues, status: existing.status, source: existing.source,
            publishedOn: existing.publishedOn, notes: existing.notes,
          } : null,
          after: {
            indexValues: row.indexValues, status: row.status, source: row.source,
            publishedOn: row.publishedOn, notes: row.notes,
          },
        },
        source: row.source,
      });
      return mapIndex(row);
  }

  async deleteIndexMonth(monthDate: Date, actor: Actor): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const monthStart = new Date(`${revisionDate(monthDate).slice(0, 7)}-01T00:00:00Z`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('btp-revision-indexes'))`);
      const [existing] = await tx.select().from(revisionIndexes).where(eq(revisionIndexes.monthDate, monthStart));
      if (existing?.publishedOn || (existing?.previousPublications as PublishedIndexes[] | undefined)?.length) {
        throw new BtpTransitionError('Ce mois comporte des publications officielles. Enregistrer un bulletin rectificatif pour corriger les valeurs.');
      }
      const rows = await tx
        .delete(revisionIndexes)
        .where(eq(revisionIndexes.monthDate, monthStart))
        .returning({ id: revisionIndexes.id });
      if (rows.length === 0) return false;
      await tx.insert(revisionIndexAudit).values({
        monthDate: monthStart,
        action: 'delete',
        actorSub: actor.sub,
        actorName: actor.name,
      });
      await this.rebuildRevisionProjects(tx);
      return true;
    });
  }

  async listIndexAudit(limit = 100) {
    const rows = await this.db
      .select()
      .from(revisionIndexAudit)
      .orderBy(desc(revisionIndexAudit.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      monthDate: r.monthDate ?? null,
      action: r.action,
      actorName: r.actorName ?? null,
      changes: r.changes,
      createdAt: r.createdAt,
    }));
  }

  async getRevisionConfig(projectId: string): Promise<RevisionConfigRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectRevisionConfig)
      .where(eq(projectRevisionConfig.projectId, projectId))
      .limit(1);
    return row ? mapConfig(row) : null;
  }

  async saveRevisionConfig(
    projectId: string,
    input: {
      formulaId?: string | null;
      formula?: { fixedPart: number; weights: Record<string, number> };
      baseIndexes?: IndexValues;
      baseDate?: Date | null;
      contractDeadline?: Date | null;
      delayAttributable?: boolean | null;
      postingMode?: RevisionPostingMode;
      isEnabled?: boolean;
      notes?: string | null;
    },
  ): Promise<RevisionConfigRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('btp-revision-indexes'))`);
      if (!await lockBtpProject(tx, projectId)) throw new BtpTransitionError('Marché introuvable.');
      const [existing] = await tx
        .select()
        .from(projectRevisionConfig)
        .where(eq(projectRevisionConfig.projectId, projectId))
        .limit(1)
        .for('update');
      let formulaId = input.formulaId;
      if (formulaId && formulaId !== existing?.formulaId) {
        const [selected] = await tx.select({ id: revisionFormulas.id }).from(revisionFormulas)
          .where(and(eq(revisionFormulas.id, formulaId), eq(revisionFormulas.isPublic, true))).limit(1);
        if (!selected) throw new BtpTransitionError('Formule du CPS indisponible pour ce marché.');
      }
      if (input.formula) {
        if (formulaId != null) throw new BtpTransitionError('Choisir ou saisir une seule formule du CPS.');
        const definition = { name: 'Formule du CPS', ...input.formula };
        if (!validateFormula(definition).valid) {
          throw new BtpTransitionError('La partie fixe doit être d’au moins 15 % et le total des coefficients doit valoir 100 %.');
        }
        const [linked] = existing?.formulaId ? await tx.select({ id: revisionFormulas.id }).from(revisionFormulas)
          .where(and(eq(revisionFormulas.id, existing.formulaId), eq(revisionFormulas.fixedPart, String(definition.fixedPart)),
            sql`${revisionFormulas.weights} = ${JSON.stringify(definition.weights)}::jsonb`)).limit(1) : [];
        if (linked) {
          formulaId = linked.id;
        } else {
          const [created] = await tx.insert(revisionFormulas).values({
            ...definition, fixedPart: String(definition.fixedPart), isPublic: false,
          }).returning({ id: revisionFormulas.id });
          if (!created) throw new BtpTransitionError('Création de la formule échouée');
          formulaId = created.id;
        }
      }
      const isEnabled = input.isEnabled ?? (formulaId ? true : existing?.isEnabled ?? true);
      const oldBase = (existing?.baseIndexes as IndexValues | undefined) ?? {};
      const baseChanged = input.baseIndexes && Object.keys({ ...oldBase, ...input.baseIndexes })
        .some((code) => input.baseIndexes?.[code] !== oldBase[code]);
      const modeChanged = input.postingMode !== undefined && input.postingMode !== (existing?.postingMode ?? 'each_decompte');
      if (modeChanged || existing?.isEnabled && (
        !isEnabled || baseChanged ||
        (formulaId !== undefined && formulaId !== existing.formulaId) ||
        (input.baseDate !== undefined && input.baseDate?.getTime() !== existing.baseDate?.getTime())
      )) {
        const [issued] = await tx.select({ id: decomptes.id }).from(decomptes)
          .leftJoin(decompteRevisions, eq(decompteRevisions.decompteId, decomptes.id)).where(and(
          eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt),
          sql`${decomptes.statut} IN ('validated', 'paid') AND
            (${decomptes.revisionMontantMad} <> 0 OR
              (${decompteRevisions.id} IS NOT NULL AND ${decomptes.totalHtMad} <> 0))`,
        )).limit(1);
        if (issued) throw new BtpTransitionError('La révision figure sur un décompte validé ou payé. La formule, les données de base, le mode de report et l’activation sont verrouillés.');
      }
      let row: typeof projectRevisionConfig.$inferSelect | undefined;
      if (existing) {
        [row] = await tx
          .update(projectRevisionConfig)
          .set({
            formulaId: formulaId !== undefined ? formulaId : existing.formulaId,
            baseIndexes: input.baseIndexes ?? existing.baseIndexes,
            baseDate: input.baseDate !== undefined ? input.baseDate : existing.baseDate,
            contractDeadline: input.contractDeadline !== undefined ? input.contractDeadline : existing.contractDeadline,
            delayAttributable: input.delayAttributable !== undefined ? input.delayAttributable : existing.delayAttributable,
            postingMode: input.postingMode ?? existing.postingMode,
            isEnabled,
            notes: input.notes !== undefined ? input.notes : existing.notes,
            updatedAt: new Date(),
          })
          .where(eq(projectRevisionConfig.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(projectRevisionConfig)
          .values({
            projectId,
            formulaId: formulaId ?? null,
            baseIndexes: input.baseIndexes ?? {},
            baseDate: input.baseDate ?? null,
            contractDeadline: input.contractDeadline ?? null,
            delayAttributable: input.delayAttributable ?? null,
            postingMode: input.postingMode ?? 'each_decompte',
            isEnabled,
            notes: input.notes ?? null,
          })
          .returning();
      }
      if (!row) throw new BtpTransitionError('Enregistrement de la configuration échoué');
      await this.execution.rebuildChainTx(tx, projectId);
      return mapConfig(row);
    });
  }

  // ── Avenants ───────────────────────────────────────────────────────────────

  async listAvenants(projectId: string): Promise<AvenantBtpRecord[]> {
    const rows = await this.db
      .select()
      .from(avenants)
      .where(and(eq(avenants.projectId, projectId), isNull(avenants.deletedAt)))
      .orderBy(asc(avenants.numero));
    return rows.map(mapAvenant);
  }

  async createAvenant(
    projectId: string,
    input: Parameters<BtpRegistresRepository['createAvenant']>[1],
  ): Promise<AvenantBtpRecord> {
    return this.db.transaction(async (tx) => {
      const project = await lockBtpProject(tx, projectId);
      if (!project) throw new BtpTransitionError('Marché introuvable.');
      const [aggregate] = await tx
        .select({ maxNumero: sql<number>`coalesce(max(${avenants.numero}), 0)::int` })
        .from(avenants)
        .where(and(eq(avenants.projectId, projectId), isNull(avenants.deletedAt)));
      const prior = await sumApprovedAvenants(tx, projectId);
      const montantAvant = currentContractAmount(project, prior.amount).toNumber();
      const montantInitial = num(project.montantMarcheInitialMad ?? project.montantMarcheMad);
      const impact = readAvenantImpact(input.bordereauImpact);
      const delta = impact
        ? (await this.reviewBordereauImpact(tx, projectId, impact, input.montantDeltaMad)).delta
        : input.montantDeltaMad ?? 0;
      const montantNouveau = toNumber(round2(toDecimal(montantAvant).plus(delta)));
      const pourcentage =
        montantInitial > 0
          ? toNumber(toDecimal(delta).dividedBy(montantInitial).times(100).toDecimalPlaces(4))
          : 0;
      const [row] = await tx
        .insert(avenants)
        .values({
          projectId,
          numero: (aggregate?.maxNumero ?? 0) + 1,
          objet: input.objet,
          reference: input.reference,
          typeAvenant: input.typeAvenant ?? 'modification',
          statut: 'brouillon',
          dateAvenant: input.dateAvenant,
          dateNotification: input.dateNotification,
          montantDeltaMad: String(delta),
          delaiDeltaMois: String(input.delaiDeltaMois ?? 0),
          montantInitialMad: String(montantAvant),
          montantNouveauMad: String(montantNouveau),
          pourcentageVariation: String(pourcentage),
          modifications: input.modifications ?? [],
          prixNouveaux: input.prixNouveaux ?? [],
          bordereauImpact: impact,
          observations: input.observations,
        })
        .returning();
      if (!row) throw new BtpTransitionError("Création de l'avenant échouée");
      return mapAvenant(row);
    });
  }

  async updateAvenant(
    projectId: string,
    avenantId: string,
    patch: Parameters<BtpRegistresRepository['updateAvenant']>[2],
  ): Promise<AvenantBtpRecord | null> {
    return this.db.transaction(async (tx) => {
      if (!await lockBtpProject(tx, projectId)) return null;
      const [existing] = await tx.select().from(avenants).where(and(
        eq(avenants.id, avenantId), eq(avenants.projectId, projectId), isNull(avenants.deletedAt),
      )).limit(1).for('update');
      if (!existing) return null;
      const statut = mapAvenant(existing).statut;
      if (statut === 'approuve') throw new BtpTransitionError('Avenant approuvé — modification impossible');
      const impact = readAvenantImpact(patch.bordereauImpact === undefined ? existing.bordereauImpact : patch.bordereauImpact);
      if (statut !== 'brouillon' && (impact || existing.bordereauImpact)) {
        throw new BtpTransitionError('Un avenant soumis avec des postes de bordereau doit revenir en brouillon avant modification.');
      }
      const set: Partial<typeof avenants.$inferInsert> = { updatedAt: new Date() };
      if (patch.objet !== undefined) set.objet = patch.objet;
      if (patch.reference !== undefined) set.reference = patch.reference;
      if (patch.typeAvenant !== undefined) set.typeAvenant = patch.typeAvenant;
      if (patch.dateAvenant !== undefined) set.dateAvenant = patch.dateAvenant;
      if (patch.dateNotification !== undefined) set.dateNotification = patch.dateNotification;
      const delta = impact
        ? (await this.reviewBordereauImpact(tx, projectId, impact, patch.montantDeltaMad)).delta
        : patch.montantDeltaMad ?? (patch.bordereauImpact === null && existing.bordereauImpact ? 0 : undefined);
      if (delta !== undefined) {
        set.montantDeltaMad = String(delta);
        const base = optNum(existing.montantInitialMad) ?? 0;
        set.montantNouveauMad = String(toNumber(round2(toDecimal(base).plus(delta))));
      }
      if (patch.delaiDeltaMois !== undefined) set.delaiDeltaMois = String(patch.delaiDeltaMois);
      if (patch.modifications !== undefined) set.modifications = patch.modifications;
      if (patch.prixNouveaux !== undefined) set.prixNouveaux = patch.prixNouveaux;
      if (patch.bordereauImpact !== undefined) set.bordereauImpact = impact;
      if (patch.observations !== undefined) set.observations = patch.observations;
      const [row] = await tx.update(avenants).set(set).where(and(
        eq(avenants.id, avenantId), isNull(avenants.deletedAt), sql`not ${approvedAvenant}`,
      )).returning();
      if (!row) throw new BtpTransitionError('Avenant modifié entre-temps. Actualiser la page.');
      return mapAvenant(row);
    });
  }

  private async reviewBordereauImpact(tx: BtpTransaction, projectId: string, impact: AvenantBordereauImpact, supplied?: number) {
    const original = await this.execution.getBordereauTx(tx, projectId, null);
    if (!original?.lignes.length) throw new BtpTransitionError('Enregistrer le bordereau initial avant de saisir les postes de l’avenant.');
    const approved = await listApprovedBordereauImpacts(tx, projectId);
    const delta = priceAvenantBordereau(original.lignes, approved, impact);
    if (supplied !== undefined && !round2(toDecimal(supplied)).eq(delta)) {
      throw new BtpTransitionError('Le montant TTC renseigné ne correspond pas aux postes signés de l’avenant.');
    }
    return { delta, approved };
  }

  async transitionAvenant(
    projectId: string,
    avenantId: string,
    to: string,
    dateApprobation?: Date,
  ): Promise<AvenantBtpRecord | null> {
    return this.db.transaction(async (tx) => {
      const project = await lockBtpProject(tx, projectId);
      const [existing] = await tx.select().from(avenants).where(and(
        eq(avenants.id, avenantId), eq(avenants.projectId, projectId), isNull(avenants.deletedAt),
      )).for('update');
      if (!project || !existing) return null;
      const current = mapAvenant(existing);
      if (current.statut === 'approuve' && to === 'approuve') return current;
      const next = assertAvenantTransition(current.statut, to);
      const now = new Date();
      const set: Partial<typeof avenants.$inferInsert> = { statut: next, updatedAt: now };
      if ((next === 'en_attente' || next === 'approuve') && current.typeAvenant === 'prix_nouveaux' &&
          !current.bordereauImpact?.additions.length) {
        throw new BtpTransitionError('Le relevé des prix nouveaux est documentaire. Saisissez les postes signés du bordereau pour les mettre en application.');
      }
      if (current.bordereauImpact && (next === 'en_attente' || next === 'approuve') && !current.reference?.trim()) {
        throw new BtpTransitionError('Renseigner la référence de l’avenant signé.');
      }
      if (current.bordereauImpact && next === 'en_attente') {
        await this.reviewBordereauImpact(tx, projectId, current.bordereauImpact, current.montantDeltaMad);
      }
      if (next === 'approuve') {
        let delta = current.montantDeltaMad;
        if (current.bordereauImpact) {
          if (!dateApprobation || !Number.isFinite(dateApprobation.getTime())) {
            throw new BtpTransitionError('Renseigner la date d’approbation de l’avenant signé.');
          }
          if (current.bordereauImpact.dateSignatureTitulaire &&
              revisionDate(dateApprobation) < current.bordereauImpact.dateSignatureTitulaire) {
            throw new BtpTransitionError('L’approbation ne peut pas précéder la signature du titulaire.');
          }
          const [closed] = await tx.select({ id: decomptes.id }).from(decomptes).where(and(
            eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt), eq(decomptes.isDernier, true),
            inArray(decomptes.statut, ['validated', 'paid']),
          )).limit(1);
          if (closed) throw new BtpTransitionError('Le dernier décompte est validé ou payé. Traiter l’avenant par un décompte rectificatif.');
          const reviewed = await this.reviewBordereauImpact(tx, projectId, current.bordereauImpact, delta);
          const formulaIds = [...new Set(current.bordereauImpact.additions.flatMap(({ formuleId }) => formuleId ? [formuleId] : []))];
          if (formulaIds.length) {
            const formulas = await tx.select({
              id: revisionFormulas.id, name: revisionFormulas.name, fixedPart: revisionFormulas.fixedPart, weights: revisionFormulas.weights,
            }).from(revisionFormulas).where(inArray(revisionFormulas.id, formulaIds));
            if (formulas.length !== formulaIds.length) throw new BtpTransitionError('Une formule prévue par l’avenant n’est pas enregistrée.');
            const snapshots = new Map(formulas.map((item) => [item.id, {
              id: item.id, name: item.name, fixedPart: num(item.fixedPart), weights: item.weights as Record<string, number>,
            }]));
            set.bordereauImpact = readAvenantImpact({
              ...current.bordereauImpact,
              additions: current.bordereauImpact.additions.map((line) => line.formuleId
                ? { ...line, formuleSnapshot: snapshots.get(line.formuleId) } : line),
            }, true);
          }
          delta = reviewed.delta;
          set.bordereauImpactOrder = (reviewed.approved.at(-1)?.order ?? 0) + 1;
          set.montantDeltaMad = String(delta);
        }
        Object.assign(set, await applyApprovedAvenantAmount(tx, projectId, project, delta));
        set.dateApprobation = dateApprobation ?? now;
        set.approvedAt = set.dateApprobation;
      }
      const [row] = await tx.update(avenants).set(set).where(eq(avenants.id, avenantId)).returning();
      if (next === 'approuve') await this.execution.rebuildChainTx(tx, projectId);
      return row ? mapAvenant(row) : null;
    });
  }

  async deleteAvenant(projectId: string, avenantId: string): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(avenants)
      .where(
        and(
          eq(avenants.id, avenantId),
          eq(avenants.projectId, projectId),
          isNull(avenants.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return false;
    const statut = mapAvenant(existing).statut;
    if (statut === 'approuve') {
      throw new BtpTransitionError('Avenant approuvé — suppression impossible');
    }
    if (statut === 'en_attente' && existing.bordereauImpact) {
      throw new BtpTransitionError('Annuler l’avenant soumis depuis le registre pour conserver son historique.');
    }
    const [removed] = await this.db
      .update(avenants)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(avenants.id, avenantId), isNull(avenants.deletedAt),
        sql`not ${approvedAvenant}`,
        sql`(${avenants.statut} <> 'en_attente' OR ${avenants.bordereauImpact} IS NULL)`,
      ))
      .returning({ id: avenants.id });
    if (!removed) throw new BtpTransitionError('Avenant modifié entre-temps. Actualiser la page.');
    return true;
  }

  async avenantSummary(projectId: string) {
    const [project] = await this.db
      .select({ montantMarcheMad: projects.montantMarcheMad, montantMarcheInitialMad: projects.montantMarcheInitialMad,
        montantActuel: currentContractAmountSql, delai: projects.delaiMois })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const all = await this.listAvenants(projectId);
    const approuves = all.filter((a) => a.statut === 'approuve');
    const totalAvenants = approuves.reduce(
      (sum, a) => toNumber(round2(toDecimal(sum).plus(a.montantDeltaMad))),
      0,
    );
    const delaiSupp = approuves.reduce((sum, a) => sum + a.delaiDeltaMois, 0);
    const montantInitial = optNum(project?.montantMarcheInitialMad ?? project?.montantMarcheMad);
    return {
      montantInitial,
      totalAvenants,
      montantActuel: num(project?.montantActuel),
      delaiInitialMois: num(project?.delai),
      delaiSupplementaireMois: delaiSupp,
      count: all.length,
      approuves: approuves.length,
    };
  }

  async approvedExtensions(projectIds: string[]) {
    if (projectIds.length === 0) return new Map<string, number>();
    const rows = await this.db.select({ projectId: avenants.projectId,
      months: sql<string>`sum(${avenants.delaiDeltaMois})`,
    }).from(avenants).where(and(inArray(avenants.projectId, projectIds), isNull(avenants.deletedAt), approvedAvenant))
      .groupBy(avenants.projectId);
    return new Map(rows.map((row) => [row.projectId, num(row.months)]));
  }

  // ── ODS ────────────────────────────────────────────────────────────────────

  async listOds(projectId: string): Promise<OdsRecord[]> {
    const rows = await this.db
      .select()
      .from(ordresService)
      .where(and(eq(ordresService.projectId, projectId), isNull(ordresService.deletedAt)))
      .orderBy(asc(ordresService.numero));
    return rows.map(mapOds);
  }

  async createOds(projectId: string, input: Parameters<BtpRegistresRepository['createOds']>[1]) {
    return this.db.transaction(async (tx) => {
      await lockBtpProject(tx, projectId);
      if (input.type === 'arret' && !input.arretScope) {
        throw new BtpTransitionError('Préciser si l’arrêt est total ou partiel.');
      }
      const [aggregate] = await tx
        .select({ maxNumero: sql<number>`coalesce(max(${ordresService.numero}), 0)::int` })
        .from(ordresService)
        .where(and(eq(ordresService.projectId, projectId), isNull(ordresService.deletedAt)));
      const numero = (aggregate?.maxNumero ?? 0) + 1;
      const [row] = await tx
        .insert(ordresService)
        .values({
          projectId,
          numero,
          reference: `ODS-${String(numero).padStart(3, '0')}`,
          type: input.type ?? 'commencement',
          objet: input.objet,
          description: input.description,
          motif: input.motif,
          dateEmission: input.dateEmission ?? new Date(),
          dateEffet: input.dateEffet,
          arretScope: input.arretScope,
          repriseArretId: input.repriseArretId,
          dateFin: input.dateFin,
          delaiJours: input.delaiJours,
          impactFinancierMad: String(input.impactFinancierMad ?? 0),
          impactDelaiJours: input.impactDelaiJours ?? 0,
          emetteur: input.emetteur,
          emetteurFonction: input.emetteurFonction,
          destinataire: input.destinataire,
          avenantId: input.avenantId,
        })
        .returning();
      if (!row) throw new BtpTransitionError("Création de l'ODS échouée");
      return mapOds(row);
    });
  }

  async updateOds(
    projectId: string,
    odsId: string,
    patch: Parameters<BtpRegistresRepository['updateOds']>[2],
  ) {
    const [existing] = await this.db
      .select()
      .from(ordresService)
      .where(
        and(
          eq(ordresService.id, odsId),
          eq(ordresService.projectId, projectId),
          isNull(ordresService.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return null;
    if (existing.statut !== 'brouillon') {
      throw new BtpTransitionError(`ODS ${existing.statut} — seul un brouillon est modifiable`);
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'type',
      'objet',
      'description',
      'motif',
      'dateEmission',
      'dateEffet',
      'arretScope',
      'repriseArretId',
      'dateFin',
      'delaiJours',
      'emetteur',
      'emetteurFonction',
      'destinataire',
      'observationsDestinataire',
    ] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.impactFinancierMad !== undefined) {
      set.impactFinancierMad = String(patch.impactFinancierMad);
    }
    if (patch.impactDelaiJours !== undefined) set.impactDelaiJours = patch.impactDelaiJours;
    const [row] = await this.db
      .update(ordresService)
      .set(set)
      .where(and(eq(ordresService.id, odsId), eq(ordresService.statut, 'brouillon'), isNull(ordresService.deletedAt)))
      .returning();
    return row ? mapOds(row) : null;
  }

  async actionOds(
    projectId: string,
    odsId: string,
    action: OdsAction,
    meta?: Parameters<BtpRegistresRepository['actionOds']>[3],
  ): Promise<OdsRecord | null> {
    return this.db.transaction(async (tx) => {
      const project = await lockBtpProject(tx, projectId);
      const [existing] = await tx.select().from(ordresService).where(and(
        eq(ordresService.id, odsId), eq(ordresService.projectId, projectId), isNull(ordresService.deletedAt),
      )).for('update');
      if (!project || !existing) return null;
      if (action === 'notify' && ['notifie', 'accuse', 'execute', 'cloture'].includes(existing.statut)) {
        return mapOds(existing);
      }
      const now = new Date();
      const set: Partial<typeof ordresService.$inferInsert> = {
        statut: assertOdsTransition(existing.statut, action), updatedAt: now,
      };
      let calendarChanged = false;
      if (action === 'notify') {
        set.dateNotification = meta?.dateNotification ?? now;
        const type = existing.type;
        if (type === 'commencement' || type === 'arret' || type === 'reprise') {
          if (meta?.dateEffet && existing.dateEffet && meta.dateEffet.getTime() !== existing.dateEffet.getTime()) {
            throw new BtpTransitionError('La date d’effet doit correspondre à l’ordre émis.');
          }
          const effective = existing.dateEffet ?? meta?.dateEffet;
          if (!effective) throw new BtpTransitionError('Renseigner la date d’effet de l’ordre de service.');
          set.dateEffet = effective;
          set.calendarEffectAppliedAt = now;
          const stops = withStopIds((project.arrets ?? []) as ArretTravaux[]);
          if (type === 'commencement') {
            const previousStart = chantierStart(project);
            if (previousStart?.getTime() !== effective.getTime()) {
              await this.execution.assertEditableChain(tx, projectId, 1);
              await this.execution.assertTerrainWindowsPreserved(tx, projectId, previousStart, { executionStart: effective });
            }
            await tx.update(projects).set({ executionStartDate: effective, updatedAt: now })
              .where(eq(projects.id, projectId));
            calendarChanged = true;
          } else if (type === 'arret') {
            if (meta?.arretScope && existing.arretScope && meta.arretScope !== existing.arretScope) {
              throw new BtpTransitionError('La portée doit correspondre à l’ordre émis.');
            }
            const scope = existing.arretScope ?? meta?.arretScope;
            if (!scope) throw new BtpTransitionError('Préciser si l’arrêt est total ou partiel.');
            set.arretScope = scope;
            if (scope === 'total') {
              await tx.update(projects).set({ arrets: [...stops, {
                id: odsId, sourceOdsId: odsId, dateArret: revisionDate(effective), motif: existing.motif,
              }], updatedAt: now }).where(eq(projects.id, projectId));
              calendarChanged = true;
            }
          } else {
            if (meta?.repriseArretId && existing.repriseArretId && meta.repriseArretId !== existing.repriseArretId) {
              throw new BtpTransitionError('L’arrêt sélectionné doit correspondre à l’ordre de reprise émis.');
            }
            const selected = existing.repriseArretId ?? meta?.repriseArretId;
            const open = stops.filter((stop) => !stop.dateReprise);
            const stop = selected ? open.find((candidate) => candidate.id === selected) : open.length === 1 ? open[0] : undefined;
            if (!stop) throw new BtpTransitionError('Sélectionner un arrêt total en cours pour la reprise.');
            const resumeDate = revisionDate(effective);
            if (resumeDate < stop.dateArret.slice(0, 10)) {
              throw new BtpTransitionError('La date de reprise est antérieure à l’arrêt.');
            }
            set.repriseArretId = stop.id;
            await tx.update(projects).set({ arrets: stops.map((entry) => entry === stop
              ? { ...entry, dateReprise: resumeDate, repriseOdsId: odsId } : entry), updatedAt: now })
              .where(eq(projects.id, projectId));
            calendarChanged = true;
          }
        }
      }
      if (action === 'acknowledge') {
        set.dateAccuseReception = now;
        if (meta?.accusePar) set.accusePar = meta.accusePar;
      }
      const [row] = await tx.update(ordresService).set(set).where(eq(ordresService.id, odsId)).returning();
      if (calendarChanged) await this.execution.rebuildChainTx(tx, projectId);
      return row ? mapOds(row) : null;
    });
  }

  async deleteOds(projectId: string, odsId: string): Promise<boolean> {
    const rows = await this.db
      .update(ordresService)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(ordresService.id, odsId),
          eq(ordresService.projectId, projectId),
          isNull(ordresService.deletedAt),
          eq(ordresService.statut, 'brouillon'),
        ),
      )
      .returning({ id: ordresService.id });
    return rows.length > 0;
  }

  // ── Pénalités / cautionsBtp / retenues ────────────────────────────────────────

  async listPenalites(projectId: string): Promise<PenaliteRecord[]> {
    const rows = await this.db
      .select()
      .from(penalites)
      .where(and(eq(penalites.projectId, projectId), isNull(penalites.deletedAt)))
      .orderBy(desc(penalites.createdAt));
    return rows.map(mapPenalite);
  }

  async createPenalite(
    projectId: string,
    input: Parameters<BtpRegistresRepository['createPenalite']>[1],
  ): Promise<PenaliteRecord> {
    const [project] = await this.db
      .select({ montant: projects.montantMarcheMad })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const base = input.baseCalculMad ?? num(project?.montant);
    const taux = input.taux ?? 0.001;
    const plafondPct = input.plafondPourcentage ?? 10;
    const computation = computePenalite({
      baseCalcul: base,
      taux,
      nombreJours: input.nombreJours,
      plafondPourcentage: plafondPct,
    });
    const [row] = await this.db
      .insert(penalites)
      .values({
        projectId,
        type: input.type ?? 'retard',
        dateDebut: input.dateDebut,
        dateFin: input.dateFin,
        nombreJours: input.nombreJours,
        taux: String(taux),
        baseCalculMad: String(base),
        montantPenaliteMad: String(computation.montantPenalite),
        plafondPourcentage: String(plafondPct),
        montantPlafondMad: String(computation.montantPlafond),
        montantAppliqueMad: String(computation.montantApplique),
        motif: input.motif,
        observations: input.observations,
      })
      .returning();
    if (!row) throw new BtpTransitionError('Création de la pénalité échouée');
    return mapPenalite(row);
  }

  async transitionPenalite(
    projectId: string,
    penaliteId: string,
    to: string,
    meta?: { referenceNotification?: string; dateNotification?: Date },
  ): Promise<PenaliteRecord | null> {
    const [existing] = await this.db
      .select()
      .from(penalites)
      .where(
        and(
          eq(penalites.id, penaliteId),
          eq(penalites.projectId, projectId),
          isNull(penalites.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return null;
    const next = assertPenaliteTransition(existing.statut, to);
    const set: Record<string, unknown> = { statut: next, updatedAt: new Date() };
    if (next === 'notifiee') {
      set.dateNotification = meta?.dateNotification ?? new Date();
      if (meta?.referenceNotification) set.referenceNotification = meta.referenceNotification;
    }
    const [row] = await this.db
      .update(penalites)
      .set(set)
      .where(eq(penalites.id, penaliteId))
      .returning();
    return row ? mapPenalite(row) : null;
  }

  async deletePenalite(projectId: string, penaliteId: string): Promise<boolean> {
    const rows = await this.db
      .update(penalites)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(penalites.id, penaliteId),
          eq(penalites.projectId, projectId),
          isNull(penalites.deletedAt),
        ),
      )
      .returning({ id: penalites.id });
    return rows.length > 0;
  }

  async listCautions(projectId: string): Promise<CautionRecord[]> {
    const rows = await this.db
      .select()
      .from(cautionsBtp)
      .where(and(eq(cautionsBtp.projectId, projectId), isNull(cautionsBtp.deletedAt)))
      .orderBy(desc(cautionsBtp.createdAt));
    return rows.map(mapCaution);
  }

  async createCaution(
    projectId: string,
    input: Parameters<BtpRegistresRepository['createCaution']>[1],
  ): Promise<CautionRecord> {
    let montant = input.montantMad ?? 0;
    if (!montant && input.pourcentage && input.baseCalculMad) {
      montant = toNumber(
        round2(toDecimal(input.baseCalculMad).times(input.pourcentage).dividedBy(100)),
      );
    }
    const [row] = await this.db
      .insert(cautionsBtp)
      .values({
        projectId,
        type: input.type,
        montantMad: String(montant),
        pourcentage: input.pourcentage != null ? String(input.pourcentage) : undefined,
        baseCalculMad: input.baseCalculMad != null ? String(input.baseCalculMad) : undefined,
        organisme: input.organisme,
        referenceOrganisme: input.referenceOrganisme,
        dateEmission: input.dateEmission,
        dateExpiration: input.dateExpiration,
        observations: input.observations,
      })
      .returning();
    if (!row) throw new BtpTransitionError('Création de la caution échouée');
    return mapCaution(row);
  }

  async transitionCaution(
    projectId: string,
    cautionId: string,
    to: string,
    dateMainlevee?: Date,
  ): Promise<CautionRecord | null> {
    const [existing] = await this.db
      .select()
      .from(cautionsBtp)
      .where(
        and(
          eq(cautionsBtp.id, cautionId),
          eq(cautionsBtp.projectId, projectId),
          isNull(cautionsBtp.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return null;
    const next = assertCautionTransition(existing.statut, to);
    const set: Record<string, unknown> = { statut: next, updatedAt: new Date() };
    if (next === 'liberee') set.dateMainlevee = dateMainlevee ?? new Date();
    const [row] = await this.db
      .update(cautionsBtp)
      .set(set)
      .where(eq(cautionsBtp.id, cautionId))
      .returning();
    return row ? mapCaution(row) : null;
  }

  async deleteCaution(projectId: string, cautionId: string): Promise<boolean> {
    const rows = await this.db
      .update(cautionsBtp)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(cautionsBtp.id, cautionId),
          eq(cautionsBtp.projectId, projectId),
          isNull(cautionsBtp.deletedAt),
        ),
      )
      .returning({ id: cautionsBtp.id });
    return rows.length > 0;
  }

  async listRetenues(projectId: string): Promise<RetenueRecord[]> {
    const rows = await this.db
      .select()
      .from(retenues)
      .where(and(eq(retenues.projectId, projectId), isNull(retenues.deletedAt)))
      .orderBy(asc(retenues.decompteNumero));
    return rows.map(mapRetenue);
  }

  /** Materialises one retenue row per (non-deleted) décompte — keeps the
   *  Retenues panel in sync with the engine's computed retenue de garantie. */
  async syncRetenuesFromDecomptes(projectId: string): Promise<RetenueRecord[]> {
    return this.db.transaction(async (tx) => {
      const decompteRows = await tx.execute(sql`
        select d.id, d.numero, d.total_ttc_mad, d.retenue_garantie_mad
        from "project"."decompte" d
        where d.project_id = ${projectId} and d.deleted_at is null
        order by d.numero asc
      `);
      let cumul = 0;
      for (const d of decompteRows.rows as {
        id: string;
        numero: number;
        total_ttc_mad: string;
        retenue_garantie_mad: string;
      }[]) {
        // The engine's retenue is cumulative; the per-décompte increment is the
        // delta against the previous décompte's retenue.
        const retenueCumulee = num(d.retenue_garantie_mad);
        const increment = toNumber(round2(toDecimal(retenueCumulee).minus(cumul)));
        cumul = retenueCumulee;
        const [existing] = await tx
          .select()
          .from(retenues)
          .where(and(eq(retenues.decompteId, d.id), isNull(retenues.deletedAt)))
          .limit(1);
        const values = {
          decompteNumero: d.numero,
          montantDecompteMad: String(num(d.total_ttc_mad)),
          montantRetenueMad: String(increment),
          montantCumuleMad: String(retenueCumulee),
          updatedAt: new Date(),
        };
        if (existing) {
          if (!existing.liberee) {
            await tx.update(retenues).set(values).where(eq(retenues.id, existing.id));
          }
        } else {
          await tx.insert(retenues).values({
            projectId,
            decompteId: d.id,
            tauxRetenue: '10',
            ...values,
          });
        }
      }
      const rows = await tx
        .select()
        .from(retenues)
        .where(and(eq(retenues.projectId, projectId), isNull(retenues.deletedAt)))
        .orderBy(asc(retenues.decompteNumero));
      return rows.map(mapRetenue);
    });
  }

  async libererRetenue(projectId: string, retenueId: string): Promise<RetenueRecord | null> {
    const [row] = await this.db
      .update(retenues)
      .set({ liberee: true, dateLiberation: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(retenues.id, retenueId),
          eq(retenues.projectId, projectId),
          isNull(retenues.deletedAt),
        ),
      )
      .returning();
    return row ? mapRetenue(row) : null;
  }

  // ── Circuit de validation ──────────────────────────────────────────────────

  async listApprovals(projectId: string): Promise<ApprovalRequestRecord[]> {
    const requests = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.projectId, projectId))
      .orderBy(desc(approvalRequests.createdAt));
    if (requests.length === 0) return [];
    const ids = requests.map((r) => r.id);
    const steps = await this.db
      .select()
      .from(approvalSteps)
      .where(sql`${approvalSteps.requestId} in ${ids}`)
      .orderBy(asc(approvalSteps.stepOrder));
    const stepsByRequest = new Map<string, ApprovalStepRecord[]>();
    for (const step of steps) {
      const mapped = mapStep(step);
      const bucket = stepsByRequest.get(step.requestId);
      if (bucket) bucket.push(mapped);
      else stepsByRequest.set(step.requestId, [mapped]);
    }
    return requests.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      documentType: r.documentType,
      documentId: r.documentId ?? null,
      documentReference: r.documentReference ?? null,
      status: r.status,
      currentStep: r.currentStep,
      totalSteps: r.totalSteps,
      priority: r.priority,
      dueDate: r.dueDate ?? null,
      note: r.note ?? null,
      montantMad: optNum(r.montantMad),
      requestedBy: r.requestedBy ?? null,
      requestedByName: r.requestedByName ?? null,
      submittedAt: r.submittedAt,
      completedAt: r.completedAt ?? null,
      steps: stepsByRequest.get(r.id) ?? [],
    }));
  }

  async createApproval(
    projectId: string,
    input: Parameters<BtpRegistresRepository['createApproval']>[1],
    actor: Actor,
  ): Promise<ApprovalRequestRecord> {
    const requestId = await this.db.transaction(async (tx) => {
      const stepInputs =
        input.steps && input.steps.length > 0
          ? input.steps
          : [{ stepLabel: 'Validation', role: 'responsable' }];
      const [request] = await tx
        .insert(approvalRequests)
        .values({
          projectId,
          documentType: input.documentType,
          documentId: input.documentId,
          documentReference: input.documentReference,
          status: 'en_cours',
          currentStep: 1,
          totalSteps: stepInputs.length,
          priority: input.priority ?? 'normal',
          dueDate: input.dueDate,
          note: input.note,
          montantMad: input.montantMad != null ? String(input.montantMad) : undefined,
          requestedBy: actor.sub,
          requestedByName: actor.name,
        })
        .returning();
      if (!request) throw new BtpTransitionError('Création de la demande échouée');
      for (const [i, step] of stepInputs.entries()) {
        await tx.insert(approvalSteps).values({
          requestId: request.id,
          stepOrder: i + 1,
          stepLabel: step.stepLabel,
          role: step.role,
          status: i === 0 ? 'en_cours' : 'en_attente',
        });
      }
      await tx.insert(approvalHistory).values({
        requestId: request.id,
        action: 'submitted',
        actorSub: actor.sub,
        actorName: actor.name,
      });
      return request.id;
    });
    const all = await this.listApprovals(projectId);
    const created = all.find((r) => r.id === requestId);
    if (!created) throw new BtpTransitionError('Création de la demande échouée');
    return created;
  }

  async decideApproval(
    requestId: string,
    decision: 'approve' | 'reject' | 'cancel',
    actor: Actor,
    comment?: string,
  ): Promise<ApprovalRequestRecord | null> {
    const projectId = await this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, requestId))
        .limit(1)
        .for('update');
      if (!request) return null;
      if (!['en_attente', 'en_cours'].includes(request.status)) {
        throw new BtpTransitionError(`Demande ${request.status} — décision impossible`);
      }
      if (decision === 'cancel') {
        await tx
          .update(approvalRequests)
          .set({ status: 'annule', completedAt: new Date(), updatedAt: new Date() })
          .where(eq(approvalRequests.id, requestId));
        await tx.insert(approvalHistory).values({
          requestId,
          action: 'cancelled',
          actorSub: actor.sub,
          actorName: actor.name,
          comment,
        });
        return request.projectId;
      }
      const [step] = await tx
        .select()
        .from(approvalSteps)
        .where(
          and(
            eq(approvalSteps.requestId, requestId),
            eq(approvalSteps.stepOrder, request.currentStep),
          ),
        )
        .limit(1)
        .for('update');
      if (!step) throw new BtpTransitionError('Étape courante introuvable');
      const now = new Date();
      if (decision === 'reject') {
        await tx
          .update(approvalSteps)
          .set({
            status: 'rejete',
            decidedBy: actor.sub,
            decidedByName: actor.name,
            decisionDate: now,
            comment,
          })
          .where(eq(approvalSteps.id, step.id));
        await tx
          .update(approvalRequests)
          .set({ status: 'rejete', completedAt: now, updatedAt: now })
          .where(eq(approvalRequests.id, requestId));
        await tx.insert(approvalHistory).values({
          requestId,
          stepId: step.id,
          action: 'rejected',
          actorSub: actor.sub,
          actorName: actor.name,
          comment,
        });
        return request.projectId;
      }
      // approve
      await tx
        .update(approvalSteps)
        .set({
          status: 'approuve',
          decidedBy: actor.sub,
          decidedByName: actor.name,
          decisionDate: now,
          comment,
        })
        .where(eq(approvalSteps.id, step.id));
      const isLast = request.currentStep >= request.totalSteps;
      if (isLast) {
        await tx
          .update(approvalRequests)
          .set({ status: 'approuve', completedAt: now, updatedAt: now })
          .where(eq(approvalRequests.id, requestId));
      } else {
        await tx
          .update(approvalRequests)
          .set({ currentStep: request.currentStep + 1, status: 'en_cours', updatedAt: now })
          .where(eq(approvalRequests.id, requestId));
        await tx
          .update(approvalSteps)
          .set({ status: 'en_cours' })
          .where(
            and(
              eq(approvalSteps.requestId, requestId),
              eq(approvalSteps.stepOrder, request.currentStep + 1),
            ),
          );
      }
      await tx.insert(approvalHistory).values({
        requestId,
        stepId: step.id,
        action: 'approved',
        actorSub: actor.sub,
        actorName: actor.name,
        comment,
      });
      return request.projectId;
    });
    if (!projectId) return null;
    const all = await this.listApprovals(projectId);
    return all.find((r) => r.id === requestId) ?? null;
  }
}
