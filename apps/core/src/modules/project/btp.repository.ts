// BTP execution repository — the marché lifecycle chain: fiche marché →
// bordereau → périodes → métrés → décomptes (auto-rebuilt), attachement,
// corbeille. Décomptes are NEVER written directly by callers: every mutation of
// the chain funnels through rebuildProjectChain() so the cumulative model can
// not drift (the source app rebuilt only the current période's décompte; here a
// full in-order rebuild keeps every later décompte consistent too).
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  bordereaux,
  avenants,
  chantierAttachements,
  decompteRevisions,
  decomptes,
  metres,
  ordresService,
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
  type NormalizedBordereauLigne,
  type DecompteLigne,
  type PriorDecompteAcompte,
} from './btp-finance.domain';
import {
  computeLignePartiel,
  computeMetreTotals,
  computePourcentageRealisation,
  type MetreLigne,
  type MetreSection,
  type MetreSousSection,
} from './btp-metre.domain';
import {
  calculateRevisionPeriod,
  chantierStart,
  readRevisionTrace,
  revisionDate,
  revisionDayAfter,
  selectPublishedIndexes,
  settleRevision,
  type IndexValues,
  type PublishedIndexes,
  type RevisionPeriod,
  type RevisionTrace,
  type RevisionFormulaSpec,
} from './btp-revision.domain';
import { BtpTransitionError, assertDecompteTransition } from './btp-registres.domain';
import { withStopIds, type ArretTravaux } from './btp-registres.domain';
import { resolveRevisionDates } from './btp-workflow.domain';
import { buildRevisionReport, type RevisionReport, type RevisionReportInputRow } from './btp-revision-report.domain';
import { appendTerrainMeasurement, assertTerrainMeasurementsPreserved } from './btp-attachement.domain';
import { allocateRevisionFromTerrain } from './btp-terrain-revision.domain';
import { storedAvenantBordereauImpactSchema, projectAvenantBordereau, type AppliedBordereauImpact } from './btp-avenant-bordereau.domain';
import { calculateAvenantRevisionPeriod, splitAvenantRevisionGroups, type AvenantRevisionGroup } from './btp-avenant-revision.domain';

// ─── Records ─────────────────────────────────────────────────────────────────

export interface BtpProjectRecord {
  id: string;
  tenderId: string | null;
  reference: string;
  name: string;
  buyerName: string;
  montantMarcheMad: number;
  ordreServiceDate: Date | null;
  executionStartDate: Date | null;
  delaiMois: number | null;
  status: string;
  objet: string | null;
  annee: string | null;
  societe: string | null;
  commune: string | null;
  typeMarche: string | null;
  modePassation: string | null;
  dateOuverture: Date | null;
  dateLimiteRemiseOffres: Date | null;
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
  modeObtention: string;
  acquisition: Record<string, unknown>;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BtpProjectFichePatch {
  tenderId?: string;
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
  executionStartDate?: Date | null;
  delaiMois?: number | null;
  dateOuverture?: Date | null;
  dateLimiteRemiseOffres?: Date | null;
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
  expectedArrets?: ArretTravaux[];
  status?: string;
  modeObtention?: string;
  acquisition?: Record<string, unknown>;
}

export type BtpProjectCreateInput = BtpProjectFichePatch & {
  creationId?: string;
  reference: string;
  name: string;
  bordereau?: { reference?: string; designation?: string; lignes: BordereauLigne[] };
};

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
  lignes: NormalizedBordereauLigne[];
  montantTotalMad: number;
  modifieParAvenant?: boolean;
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
  revisionMonthlyHt: Record<string, number> | null;
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
  getRevisionReport(projectId: string): Promise<RevisionReport | null>;
  listPortfolio(filters: BtpPortfolioFilters): Promise<BtpPortfolioResult>;
  getProject(id: string): Promise<BtpProjectRecord | null>;
  createProject(
    input: BtpProjectCreateInput,
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

  getBordereau(projectId: string, asOf?: Date | null): Promise<BordereauRecord | null>;
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
      revisionMonthlyHt: Record<string, number> | null;
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
    decompteId: string | null;
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

  listTerrainIntegrationWindows(projectId: string): Promise<TerrainIntegrationWindow[]>;
  integrateTerrainAttachement(projectId: string, attachementId: string, periodeId: string, actor: string): Promise<{ metreId: string; periodeId: string }>;
  integrateTerrainAttachements(projectId: string, attachementIds: string[], periodeId: string, actor: string): Promise<{
    periodeId: string;
    attachements: Array<{ attachementId: string; metreId: string }>;
  }>;

  listDecomptes(projectId: string): Promise<(DecompteRecord & {
    periodeLibelle: string | null;
    revisionTrace: RevisionTrace | null;
  })[]>;
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

export type BtpTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Tx = BtpTransaction;

export async function lockBtpProject(tx: Tx, projectId: string, readOnly = false) {
  const query = tx.select({
    reference: projects.reference,
    name: projects.name,
    objet: projects.objet,
    ordreServiceDate: projects.ordreServiceDate,
    executionStartDate: projects.executionStartDate,
    dateLimiteRemiseOffres: projects.dateLimiteRemiseOffres,
    typeMarche: projects.typeMarche,
    modePassation: projects.modePassation,
    delaiMois: projects.delaiMois,
    arrets: projects.arrets,
    montantMarcheMad: projects.montantMarcheMad,
    montantMarcheInitialMad: projects.montantMarcheInitialMad,
  }).from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  const [project] = await (readOnly ? query : query.for('update'));
  return project;
}

export const approvedAvenant = sql`(${avenants.statut} = 'approuve' OR (${avenants.statut} = 'brouillon' AND ${avenants.approvedAt} IS NOT NULL))`;

export async function listApprovedBordereauImpacts(tx: Tx | Db, projectId: string): Promise<AppliedBordereauImpact[]> {
  const rows = await tx.select({
    id: avenants.id, numero: avenants.numero, reference: avenants.reference,
    order: avenants.bordereauImpactOrder, impact: avenants.bordereauImpact,
  }).from(avenants).where(and(
    eq(avenants.projectId, projectId), isNull(avenants.deletedAt), eq(avenants.statut, 'approuve'),
    isNotNull(avenants.bordereauImpactOrder),
  )).orderBy(asc(avenants.bordereauImpactOrder));
  return rows.map((row) => {
    const parsed = storedAvenantBordereauImpactSchema.safeParse(row.impact);
    if (!parsed.success || !row.reference || row.order === null) throw new BtpTransitionError('L’impact d’un avenant approuvé est incomplet.');
    return { id: row.id, numero: row.numero, reference: row.reference, order: row.order, impact: parsed.data };
  });
}

export const currentContractAmountSql = sql<string>`case when ${projects.montantMarcheInitialMad} is null
  then ${projects.montantMarcheMad} + coalesce((select sum(${avenants.montantDeltaMad}) from ${avenants}
    where ${avenants.projectId} = "project"."id" and ${avenants.deletedAt} is null and ${approvedAvenant}), 0)
  else ${projects.montantMarcheMad} end`;

export async function sumApprovedAvenants(tx: Tx | Db, projectId: string) {
  const [totals] = await tx.select({
    months: sql<string>`coalesce(sum(${avenants.delaiDeltaMois}), 0)`,
    amount: sql<string>`coalesce(sum(${avenants.montantDeltaMad}), 0)`,
  }).from(avenants).where(and(eq(avenants.projectId, projectId), isNull(avenants.deletedAt), approvedAvenant));
  return totals ?? { months: '0', amount: '0' };
}

export function currentContractAmount(
  project: { montantMarcheMad: string | number; montantMarcheInitialMad: string | number | null },
  approvedAmount: string | number,
) {
  const recorded = toDecimal(project.montantMarcheMad);
  // Before amount booking, the legacy situation route used the recorded amount as the base.
  return project.montantMarcheInitialMad == null ? round2(recorded.plus(approvedAmount)) : recorded;
}

/** Called while holding the project lock, before writing the new approval. */
export async function applyApprovedAvenantAmount(
  tx: Tx, projectId: string, project: NonNullable<Awaited<ReturnType<typeof lockBtpProject>>>, delta: number,
) {
  const prior = await sumApprovedAvenants(tx, projectId);
  const initial = project.montantMarcheInitialMad ?? project.montantMarcheMad;
  const before = currentContractAmount(project, prior.amount);
  const after = round2(before.plus(delta));
  if (after.isNegative()) throw new BtpTransitionError('Le montant du marché après avenant doit rester positif ou nul.');
  const booked = project.montantMarcheInitialMad != null;
  if (!booked && num(initial) === 0 && (delta !== 0 || num(prior.amount) !== 0)) {
    throw new BtpTransitionError('Enregistrer le montant du marché avant d’approuver un avenant financier.');
  }
  if (booked || delta !== 0 || num(prior.amount) !== 0) {
    await tx.update(projects).set({
      montantMarcheInitialMad: initial, montantMarcheMad: after.toFixed(2), updatedAt: new Date(),
    }).where(eq(projects.id, projectId));
  }
  return {
    montantInitialMad: before.toFixed(2),
    montantNouveauMad: after.toFixed(2),
    pourcentageVariation: num(initial) > 0 ? toDecimal(delta).div(initial).times(100).toFixed(4) : null,
  };
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function mapProject(row: typeof projects.$inferSelect): BtpProjectRecord {
  return {
    id: row.id,
    tenderId: row.tenderId,
    reference: row.reference,
    name: row.name,
    buyerName: row.buyerName,
    montantMarcheMad: num(row.montantMarcheMad),
    ordreServiceDate: row.ordreServiceDate ?? null,
    executionStartDate: row.executionStartDate ?? null,
    delaiMois: row.delaiMois == null ? null : num(row.delaiMois),
    status: row.status,
    objet: row.objet ?? null,
    annee: row.annee ?? null,
    societe: row.societe ?? null,
    commune: row.commune ?? null,
    typeMarche: row.typeMarche ?? null,
    modePassation: row.modePassation ?? null,
    dateOuverture: row.dateOuverture ?? null,
    dateLimiteRemiseOffres: row.dateLimiteRemiseOffres,
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
    arrets: withStopIds((row.arrets as ArretTravaux[]) ?? []),
    modeObtention: row.modeObtention ?? 'ao_direct',
    acquisition: (row.acquisition as Record<string, unknown>) ?? {},
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
    lignes: (row.lignes as NormalizedBordereauLigne[]) ?? [],
    montantTotalMad: num(row.montantTotalMad),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPeriode(row: typeof periodes.$inferSelect, start?: Date | null): PeriodeRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    numero: row.numero,
    libelle: row.libelle ?? null,
    dateDebut: start === undefined ? row.dateDebut : start,
    dateFin: row.dateFin ?? null,
    revisionMonthlyHt: row.revisionMonthlyHt as Record<string, number> | null,
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

type TerrainWindowChange =
  | { executionStart: Date | null }
  | { periodeId: string; dateFin: Date | null }
  | { removePeriodeId: string };

export interface TerrainIntegrationWindow {
  id: string;
  numero: number;
  start: string;
  end: string;
}

/** Periods are sorted by number. Strict integration requires an unbroken, increasing chain up to the target. */
function terrainWindows(executionStart: Date | null, periods: { id: string; dateFin: Date | null }[]) {
  const chantier = executionStart ? revisionDate(executionStart) : null;
  let latestCutoff: Date | null = null;
  let complete = Boolean(chantier);
  return new Map(periods.map((period) => {
    const nextDay = latestCutoff ? revisionDate(revisionDayAfter(latestCutoff)) : null;
    const start = nextDay && (!chantier || nextDay > chantier) ? nextDay : chantier;
    const end = period.dateFin ? revisionDate(period.dateFin) : null;
    const invalid = start !== null && end !== null && end < start;
    complete = complete && end !== null && !invalid;
    if (period.dateFin && (!latestCutoff || period.dateFin > latestCutoff)) latestCutoff = period.dateFin;
    return [period.id, { start, end, complete, invalid }];
  }));
}

function assertAvenantWorkWindow(
  line: BordereauLigne, window: { start: string | null; end: string | null; complete: boolean } | undefined,
  certifiedDay?: string,
) {
  const effective = line.avenant?.dateEffet;
  if (!effective) return;
  if (!window?.complete || !window.start || !window.end || window.end < effective) {
    throw new BtpTransitionError(`Le prix n°${line.numero} est applicable à partir du ${effective}. Vérifiez les dates du métré.`);
  }
  if (certifiedDay && certifiedDay < effective) {
    throw new BtpTransitionError(`L’exécution précède la date d’effet du prix n°${line.numero} (${effective}).`);
  }
  if (!certifiedDay && window.start < effective) {
    throw new BtpTransitionError(`Prix n°${line.numero} · utilisez un attachement daté ou une période commençant à sa date d’effet.`);
  }
}

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
        .select({ project: projects, currentAmount: currentContractAmountSql })
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
          montant: sql<string>`coalesce(sum(${currentContractAmountSql}), 0)`,
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
      items: rows.map(({ project, currentAmount }) => ({ ...mapProject(project), montantMarcheMad: num(currentAmount) })),
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
    const [row] = await this.db.select({ project: projects, currentAmount: currentContractAmountSql })
      .from(projects).where(eq(projects.id, id)).limit(1);
    return row ? { ...mapProject(row.project), montantMarcheMad: num(row.currentAmount) } : null;
  }

  async createProject(
    input: BtpProjectCreateInput,
  ): Promise<BtpProjectRecord> {
    return this.db.transaction(async (tx) => {
    if (input.creationId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.creationId}))`);
      const [previous] = await tx.select().from(projects).where(eq(projects.id, input.creationId));
      if (previous) {
        if (previous.reference !== input.reference || previous.name !== input.name || previous.tenderId !== (input.tenderId ?? null)) {
          throw new BtpTransitionError('Cette création correspond à un autre marché. Recharger le formulaire.');
        }
        return mapProject(previous);
      }
    }
    const [row] = await tx
      .insert(projects)
      .values({
        id: input.creationId,
        tenderId: input.tenderId,
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
        modePassation: input.modePassation ?? (typeof input.acquisition?.modePassation === 'string' ? input.acquisition.modePassation : undefined),
        ordreServiceDate: input.ordreServiceDate ?? undefined,
        executionStartDate: input.executionStartDate ?? undefined,
        delaiMois: input.delaiMois != null ? String(input.delaiMois) : undefined,
        dateOuverture: input.dateOuverture ?? undefined,
        dateLimiteRemiseOffres: input.dateLimiteRemiseOffres,
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
        modeObtention: input.modeObtention ?? 'ao_direct',
        acquisition: input.acquisition ?? {},
      })
      .returning();
    if (!row) throw new BtpTransitionError('Création du marché échouée');
    if (input.bordereau) {
      await this.saveBordereauTx(tx, row.id, input.bordereau);
      const [created] = await tx.select().from(projects).where(eq(projects.id, row.id));
      return mapProject(created!);
    }
    return mapProject(row);
    });
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
      'executionStartDate',
      'dateOuverture',
      'dateLimiteRemiseOffres',
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
      'modeObtention',
      'acquisition',
    ];
    for (const key of direct) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.delaiMois !== undefined) {
      set.delaiMois = patch.delaiMois == null ? null : String(patch.delaiMois);
    }
    const row = await this.db.transaction(async (tx) => {
      const current = await lockBtpProject(tx, id);
      if (current && patch.arrets) {
        const stops = withStopIds((current.arrets ?? []) as ArretTravaux[]);
        if (patch.expectedArrets && !isDeepStrictEqual(stops, patch.expectedArrets)) {
          throw new BtpTransitionError('Le calendrier a changé. Recharger la fiche et reprendre la modification.');
        }
        const linkedStops = stops.filter((stop) => stop.sourceOdsId || stop.repriseOdsId);
        const submittedLinked = patch.arrets.filter((stop) => stop.sourceOdsId || stop.repriseOdsId);
        if (!isDeepStrictEqual(linkedStops, submittedLinked)) {
          throw new BtpTransitionError('Les dates issues d’un ordre de service se gèrent dans le registre ODS.');
        }
      }
      if (current && patch.executionStartDate !== undefined &&
          patch.executionStartDate?.getTime() !== current.executionStartDate?.getTime()) {
        const [source] = await tx.select({ id: ordresService.id }).from(ordresService).where(and(
          eq(ordresService.projectId, id), eq(ordresService.type, 'commencement'),
          sql`${ordresService.calendarEffectAppliedAt} IS NOT NULL`,
        )).limit(1);
        if (source) throw new BtpTransitionError('Le début des travaux est renseigné par un ordre de service.');
      }
      const [updated] = await tx.update(projects).set(set)
        .where(and(eq(projects.id, id), isNull(projects.deletedAt))).returning();
      const affectsChain = ['ordreServiceDate', 'executionStartDate', 'dateLimiteRemiseOffres', 'delaiMois', 'arrets', 'typeMarche', 'modePassation']
        .some((key) => patch[key as keyof BtpProjectFichePatch] !== undefined);
      if (updated && affectsChain) {
        const oldStart = current ? chantierStart(current) : null;
        const newStart = chantierStart(updated);
        if (current && oldStart?.getTime() !== newStart?.getTime()) {
          await this.assertEditableChain(tx, id, 1);
          await this.assertTerrainWindowsPreserved(tx, id, oldStart, { executionStart: newStart });
        }
        if (current && current.dateLimiteRemiseOffres?.getTime() !== updated.dateLimiteRemiseOffres?.getTime()) {
          await this.assertEditableChain(tx, id, 1);
        }
        await this.rebuildChainTx(tx, id);
      }
      return updated;
    });
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

  async getBordereau(projectId: string, asOf?: Date | null): Promise<BordereauRecord | null> {
    return this.getBordereauTx(this.db, projectId, asOf);
  }

  async saveBordereau(
    projectId: string,
    input: { reference?: string; designation?: string; lignes: BordereauLigne[] },
  ): Promise<BordereauRecord> {
    return this.db.transaction((tx) => this.saveBordereauTx(tx, projectId, input));
  }

  private async saveBordereauTx(tx: Tx, projectId: string,
    input: { reference?: string; designation?: string; lignes: BordereauLigne[] }): Promise<BordereauRecord> {
    const totaux = computeBordereau(input.lignes);
      const project = await lockBtpProject(tx, projectId);
      await this.assertEditableChain(tx, projectId, 1);
      const [booked] = await tx.select({ id: avenants.id }).from(avenants).where(and(
        eq(avenants.projectId, projectId), isNull(avenants.deletedAt),
        sql`(${avenants.bordereauImpactOrder} IS NOT NULL OR
          (${avenants.statut} = 'en_attente' AND ${avenants.bordereauImpact} IS NOT NULL))`,
      )).limit(1);
      if (booked) throw new BtpTransitionError('Un avenant du bordereau est soumis ou approuvé. La base du bordereau est verrouillée.');
      if (input.lignes.some((line) => line.id?.startsWith('avenant:'))) {
        throw new BtpTransitionError('Les prix d’avenant sont enregistrés dans le registre des avenants.');
      }
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
      if (project?.montantMarcheInitialMad == null) {
        await tx.update(projects).set({ montantMarcheMad: String(totaux.montantTtc), updatedAt: new Date() })
          .where(eq(projects.id, projectId));
      }
      if (!row) throw new BtpTransitionError('Enregistrement du bordereau échoué');
      await this.rebuildChainTx(tx, projectId);
      return mapBordereau(row);
  }

  // ── Périodes ───────────────────────────────────────────────────────────────

  async listPeriodes(projectId: string): Promise<(PeriodeRecord & { metresCount: number })[]> {
    const [project, rows] = await Promise.all([this.getProject(projectId), this.db
      .select({
        periode: periodes,
        metresCount: sql<number>`(select count(*) from ${metres} m where m.periode_id = ${periodes.id} and m.deleted_at is null)::int`,
      })
      .from(periodes)
      .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)))
      .orderBy(asc(periodes.numero))]);
    const start = project ? chantierStart(project) : null;
    return rows.map((r) => ({ ...mapPeriode(r.periode, start), metresCount: r.metresCount }));
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
      const project = await lockBtpProject(tx, projectId);
      const [closing] = await tx.select({ numero: periodes.numero }).from(periodes)
        .where(and(eq(periodes.projectId, projectId), eq(periodes.isDecompteDernier, true), isNull(periodes.deletedAt))).limit(1);
      if (closing) throw new BtpTransitionError(`La période n°${closing.numero} est déjà marquée « et dernier ».`);
      const [aggregate] = await tx
        .select({ maxNumero: sql<number>`coalesce(max(${periodes.numero}), 0)::int` })
        .from(periodes)
        .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)));
      const numero = (aggregate?.maxNumero ?? 0) + 1;
      const [previous] = await tx.select({ tauxTva: periodes.tauxTva, tauxRetenue: periodes.tauxRetenue })
        .from(periodes).where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)))
        .orderBy(desc(periodes.numero)).limit(1);
      const [periodeRow] = await tx
        .insert(periodes)
        .values({
          projectId,
          numero,
          libelle: input.libelle ?? `Période ${numero}`,
          dateDebut: project ? chantierStart(project) : null,
          dateFin: input.dateFin ?? null,
          tauxTva: input.tauxTva != null ? String(input.tauxTva) : previous?.tauxTva,
          tauxRetenue: input.tauxRetenue != null ? String(input.tauxRetenue) : previous?.tauxRetenue,
          isDecompteDernier: input.isDecompteDernier ?? false,
        })
        .returning();
      if (!periodeRow) throw new BtpTransitionError('Création de la période échouée');
      // "Nouveau métré" creates the empty décompte shell at the same moment —
      // exact source-app behaviour (ProjectDetailPage.handleCreateNewMetre).
      await this.rebuildChainTx(tx, projectId);
      const [decompteRow] = await tx.select().from(decomptes)
        .where(and(eq(decomptes.periodeId, periodeRow.id), isNull(decomptes.deletedAt)));
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
      revisionMonthlyHt: Record<string, number> | null;
      tauxTva: number;
      tauxRetenue: number;
      isDecompteDernier: boolean;
      statut: string;
      observations: string;
    }>,
  ): Promise<PeriodeRecord | null> {
    const updated = await this.db.transaction(async (tx) => {
      const project = await lockBtpProject(tx, projectId);
      const [period] = await tx.select().from(periodes)
        .where(and(eq(periodes.id, periodeId), eq(periodes.projectId, projectId), isNull(periodes.deletedAt)));
      if (!period) return null;
      const sameAllocation = (left: Record<string, number> | null, right: unknown) => {
        if (left == null || right == null) return left === right;
        const record = right as Record<string, number>;
        return Object.keys(left).length === Object.keys(record).length &&
          Object.entries(left).every(([month, amount]) => record[month] === amount);
      };
      const changesFinance =
        (patch.dateFin !== undefined && patch.dateFin?.getTime() !== period.dateFin?.getTime()) ||
        (patch.tauxTva !== undefined && patch.tauxTva !== num(period.tauxTva)) ||
        (patch.tauxRetenue !== undefined && patch.tauxRetenue !== num(period.tauxRetenue)) ||
        (patch.isDecompteDernier !== undefined && patch.isDecompteDernier !== period.isDecompteDernier) ||
        (patch.revisionMonthlyHt !== undefined && !sameAllocation(patch.revisionMonthlyHt, period.revisionMonthlyHt));
      if (changesFinance) await this.assertEditableChain(tx, projectId, period.numero);
      if (project && patch.dateFin !== undefined && patch.dateFin?.getTime() !== period.dateFin?.getTime()) {
        await this.assertTerrainWindowsPreserved(tx, projectId, chantierStart(project), { periodeId, dateFin: patch.dateFin });
      }
      if (patch.isDecompteDernier) {
        const [latest] = await tx.select({ id: periodes.id }).from(periodes)
          .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)))
          .orderBy(desc(periodes.numero)).limit(1);
        if (latest?.id !== periodeId) throw new BtpTransitionError('Seule la dernière période peut clore le marché.');
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.libelle !== undefined) set.libelle = patch.libelle;
      if (patch.dateFin !== undefined) set.dateFin = patch.dateFin;
      if (patch.revisionMonthlyHt !== undefined) set.revisionMonthlyHt = patch.revisionMonthlyHt;
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
    if (!updated) return null;
    return (await this.listPeriodes(projectId)).find((period) => period.id === updated.id) ?? null;
  }

  async deletePeriode(projectId: string, periodeId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const project = await lockBtpProject(tx, projectId);
      const [periodToDelete] = await tx.select({ numero: periodes.numero }).from(periodes).where(and(
        eq(periodes.id, periodeId), eq(periodes.projectId, projectId), isNull(periodes.deletedAt),
      )).limit(1).for('update');
      if (!periodToDelete) return false;
      await this.assertEditableChain(tx, projectId, periodToDelete.numero);
      const linked = await tx.select({ id: chantierAttachements.id }).from(chantierAttachements)
        .innerJoin(metres, eq(metres.id, chantierAttachements.metreId))
        .where(and(eq(metres.projectId, projectId), eq(metres.periodeId, periodeId))).limit(1);
      if (linked.length) throw new BtpTransitionError('Cette période contient des quantités terrain intégrées — suppression impossible');
      if (project) await this.assertTerrainWindowsPreserved(tx, projectId, chantierStart(project), { removePeriodeId: periodeId });
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

  private async getBordereauForPeriode(projectId: string, periodeId: string, end: Date | null): Promise<BordereauRecord | null> {
    const [bordereau, [issued]] = await Promise.all([
      this.getBordereau(projectId, end),
      this.db.select({ lignes: decomptes.lignes }).from(decomptes).where(and(
        eq(decomptes.projectId, projectId), eq(decomptes.periodeId, periodeId), isNull(decomptes.deletedAt),
        sql`${decomptes.statut} IN ('validated', 'paid')`,
      )).limit(1),
    ]);
    if (!bordereau || !issued || !Array.isArray(issued.lignes)) return bordereau;
    const byId = new Map(bordereau.lignes.map((line) => [line.id, line]));
    const historique = (issued.lignes as DecompteLigne[]).map((record) => {
      const matches = record.bordereauLigneId ? [] : bordereau.lignes.filter((line) => line.numero === record.prixNo);
      const line = record.bordereauLigneId ? byId.get(record.bordereauLigneId) : matches.length === 1 ? matches[0] : undefined;
      return { ...line, id: record.bordereauLigneId || line?.id || `historique-${record.prixNo}`,
        numero: record.prixNo, designation: record.designation, unite: record.unite, quantite: record.quantiteBordereau,
        prixUnitaire: record.prixUnitaireHT, montant: round2(toDecimal(record.quantiteBordereau).times(record.prixUnitaireHT)).toNumber() };
    });
    return { ...bordereau, lignes: historique, montantTotalMad: computeBordereau(historique).montantHt };
  }

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
    const [bordereau, allPeriodes, allMetres, [decompte], project] = await Promise.all([
      this.getBordereauForPeriode(projectId, periodeId, periodeRow.dateFin),
      this.db
        .select()
        .from(periodes)
        .where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt))),
      this.db
        .select()
        .from(metres)
        .where(and(eq(metres.projectId, projectId), isNull(metres.deletedAt))),
      this.db.select({ id: decomptes.id }).from(decomptes).where(and(
        eq(decomptes.projectId, projectId), eq(decomptes.periodeId, periodeId), isNull(decomptes.deletedAt),
      )).limit(1),
      this.getProject(projectId),
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
    return { periode: mapPeriode(periodeRow, project ? chantierStart(project) : null), decompteId: decompte?.id ?? null,
      bordereau, metres: current, previousByLigne };
  }

  async saveMetres(
    projectId: string,
    periodeId: string,
    entries: MetreSaveEntry[],
  ): Promise<{ metres: MetreRecord[]; decompte: DecompteRecord | null }> {
    return this.db.transaction(async (tx) => {
      const project = await lockBtpProject(tx, projectId);
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
      await this.assertEditableChain(tx, projectId, periodeRow.numero);

      const bordereau = await this.getBordereauTx(tx, projectId);
      const bordereauByLigneId = new Map(
        (bordereau?.lignes ?? []).map((l) => [l.id ?? String(l.numero), l]),
      );
      const window = project && entries.some((entry) => bordereauByLigneId.get(entry.bordereauLigneId)?.avenant)
        ? terrainWindows(chantierStart(project), await this.terrainPeriodRows(tx, projectId)).get(periodeId) : undefined;

      const savedMetres: MetreRecord[] = [];
      for (const entry of entries) {
        const bordereauLigne = bordereauByLigneId.get(entry.bordereauLigneId);
        const unite = bordereauLigne?.unite ?? 'U';
        const totals = computeMetreTotals(unite, entry.sousSections, entry.lignes);
        if (bordereauLigne?.avenant && project && totals.lignes.some((line) => !line.id.startsWith('terrain-') && computeLignePartiel(unite, line) !== 0)) {
          assertAvenantWorkWindow(bordereauLigne, window);
        }
        if (!bordereauLigne && entry.bordereauLigneId.startsWith('avenant:')) {
          throw new BtpTransitionError('Le prix supplémentaire ne figure pas au bordereau approuvé.');
        }
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
        assertTerrainMeasurementsPreserved((existing?.lignes ?? []) as MetreLigne[], entry.lignes);
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

  private terrainPeriodRows(db: Db | Tx, projectId: string) {
    return db.select({ id: periodes.id, numero: periodes.numero, dateFin: periodes.dateFin, statut: periodes.statut })
      .from(periodes).where(and(eq(periodes.projectId, projectId), isNull(periodes.deletedAt)))
      .orderBy(asc(periodes.numero));
  }

  async listTerrainIntegrationWindows(projectId: string): Promise<TerrainIntegrationWindow[]> {
    const [project, periods, [lastLocked]] = await Promise.all([
      this.getProject(projectId),
      this.terrainPeriodRows(this.db, projectId),
      this.db.select({ numero: decomptes.numero }).from(decomptes).where(and(
        eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt),
        sql`${decomptes.statut} IN ('validated', 'paid')`,
      )).orderBy(desc(decomptes.numero)).limit(1),
    ]);
    if (!project) return [];
    const windows = terrainWindows(chantierStart(project), periods);
    return periods.flatMap(({ id, numero, statut }) => {
      const window = windows.get(id);
      if (statut !== 'en_cours' || numero <= (lastLocked?.numero ?? 0) || !window?.complete || !window.start || !window.end) return [];
      return [{ id, numero, start: window.start, end: window.end }];
    });
  }

  async integrateTerrainAttachement(projectId: string, attachementId: string, periodeId: string, actor: string) {
    const result = await this.integrateTerrainMeasurements(projectId, [attachementId], periodeId, actor, false);
    return { metreId: result.attachements[0]!.metreId, periodeId };
  }

  async integrateTerrainAttachements(projectId: string, attachementIds: string[], periodeId: string, actor: string) {
    return this.integrateTerrainMeasurements(projectId, attachementIds, periodeId, actor, true);
  }

  /** Compare only constraints tightened by this edit so legacy data can be repaired. Caller holds the project lock. */
  async assertTerrainWindowsPreserved(tx: Tx, projectId: string, executionStart: Date | null, change: TerrainWindowChange) {
    const linkedDates = await tx.select({
      periodeId: metres.periodeId,
      earliest: sql<string>`min(${chantierAttachements.date})::text`,
      latest: sql<string>`max(${chantierAttachements.date})::text`,
    }).from(chantierAttachements)
      .innerJoin(metres, eq(metres.id, chantierAttachements.metreId))
      .where(and(eq(chantierAttachements.projectId, projectId), eq(metres.projectId, projectId), isNull(metres.deletedAt)))
      .groupBy(metres.periodeId);
    const supplementalMetres = await tx.select({
      periodeId: metres.periodeId, ligneId: metres.bordereauLigneId, lignes: metres.lignes, id: metres.id,
    }).from(metres).where(and(eq(metres.projectId, projectId), isNull(metres.deletedAt), sql`${metres.bordereauLigneId} LIKE 'avenant:%'`));
    if (linkedDates.length === 0 && supplementalMetres.length === 0) return;

    const periods = await this.terrainPeriodRows(tx, projectId);
    const futurePeriods = 'removePeriodeId' in change
      ? periods.filter((period) => period.id !== change.removePeriodeId)
      : periods.map((period) => 'periodeId' in change && period.id === change.periodeId
        ? { ...period, dateFin: change.dateFin } : period);
    const futureStart = 'executionStart' in change ? change.executionStart : executionStart;
    const oldStart = executionStart ? revisionDate(executionStart) : null;
    const newStart = futureStart ? revisionDate(futureStart) : null;
    const before = terrainWindows(executionStart, periods);
    const after = terrainWindows(futureStart, futurePeriods);
    const datesByPeriod = new Map(linkedDates.map((row) => [row.periodeId, row]));

    if (supplementalMetres.length) {
      const bordereau = await this.getBordereauTx(tx, projectId);
      const supplemental = new Map(bordereau?.lignes.filter((line) => line.avenant).map((line) => [line.id, line]) ?? []);
      const certified = await tx.select({ id: chantierAttachements.id, metreId: chantierAttachements.metreId, date: chantierAttachements.date })
        .from(chantierAttachements).where(and(eq(chantierAttachements.projectId, projectId), eq(chantierAttachements.isExecutionDate, true),
          inArray(chantierAttachements.metreId, supplementalMetres.map((measurement) => measurement.id))));
      const sourceByLine = new Map(certified.map((source) => [`terrain-${source.id}`, source]));
      for (const measurement of supplementalMetres) {
        const line = supplemental.get(measurement.ligneId);
        if (!line || !after.has(measurement.periodeId)) continue;
        const items = (measurement.lignes as MetreLigne[]).filter((item) => computeLignePartiel(line.unite, item) !== 0);
        if (items.length === 0) continue;
        const dates = items.map((item) => sourceByLine.get(item.id)).filter((source) => source?.metreId === measurement.id);
        const firstDay = dates.length === items.length ? dates.map((source) => revisionDate(source!.date)).sort()[0] : undefined;
        assertAvenantWorkWindow(line, after.get(measurement.periodeId), firstDay);
      }
    }

    for (const period of futurePeriods) {
      const dates = datesByPeriod.get(period.id);
      const old = before.get(period.id);
      const next = after.get(period.id);
      if (!dates || !old || !next) continue;
      const dropsBound = (oldStart && !newStart) || (old.start && !next.start) || (old.end && !next.end) || (old.complete && !next.complete);
      const beforeChantier = newStart && (!oldStart || newStart > oldStart) && dates.earliest < newStart;
      const beyondStart = next.start && (!old.start || next.start > old.start) && dates.earliest < next.start;
      const beyondEnd = next.end && (!old.end || next.end < old.end) && dates.latest > next.end;
      if (dropsBound || beforeChantier || beyondStart || beyondEnd || (!old.invalid && next.invalid)) {
        throw new BtpTransitionError(`Les dates proposées excluent des attachements terrain du métré n°${period.numero} ou effacent une borne utilisée.`);
      }
    }
  }

  private async integrateTerrainMeasurements(
    projectId: string, attachementIds: string[], periodeId: string, actor: string, requireDates: boolean,
  ) {
    const ids = [...new Set(attachementIds.map((id) => id.toLowerCase()))];
    if (!ids.length) throw new BtpTransitionError('Sélectionnez au moins un attachement terrain.');
    return this.db.transaction(async (tx) => {
      // Same first lock as saveMetres: a concurrent office save cannot erase this contribution.
      const project = await lockBtpProject(tx, projectId);
      if (!project) throw new BtpTransitionError('Marché introuvable');
      const [periode] = await tx.select().from(periodes).where(and(
        eq(periodes.id, periodeId), eq(periodes.projectId, projectId), isNull(periodes.deletedAt),
      )).limit(1).for('update');
      if (!periode) throw new BtpTransitionError('Période introuvable pour ce projet');
      const sources = await tx.select().from(chantierAttachements).where(and(
        inArray(chantierAttachements.id, ids), eq(chantierAttachements.projectId, projectId),
      )).orderBy(asc(chantierAttachements.id)).for('update');
      if (sources.length !== ids.length) throw new BtpTransitionError('Attachement introuvable pour ce projet');

      const currentMetres = await tx.select().from(metres).where(and(
        eq(metres.projectId, projectId), eq(metres.periodeId, periodeId), isNull(metres.deletedAt),
      )).for('update');
      const linkedIds = new Set(currentMetres.map((metre) => metre.id));
      const result = new Map<string, string>();
      const pending = sources.filter((source) => {
        if (!source.metreId) {
          if (source.statut === 'integre') throw new BtpTransitionError('Ancien marquage sans référence de métré : rapprochez les mesures existantes avant toute nouvelle intégration');
          return true;
        }
        if (!linkedIds.has(source.metreId)) throw new BtpTransitionError('Attachement déjà intégré à un autre métré');
        result.set(source.id, source.metreId);
        return false;
      });

      if (pending.length) {
        if (periode.statut !== 'en_cours') throw new BtpTransitionError('La période doit être en cours pour intégrer une quantité');
        const [locked] = await tx.select({ numero: decomptes.numero }).from(decomptes).where(and(
          eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt),
          gte(decomptes.numero, periode.numero),
          sql`${decomptes.statut} IN ('validated', 'paid')`,
        )).orderBy(asc(decomptes.numero)).limit(1);
        if (locked) throw new BtpTransitionError(locked.numero === periode.numero
          ? 'Le décompte est verrouillé'
          : 'Un décompte ultérieur est verrouillé — intégration impossible');

        const periods = await this.terrainPeriodRows(tx, projectId);
        const window = terrainWindows(chantierStart(project), periods).get(periode.id);
        if (!window || window.invalid || (requireDates && !window.complete)) {
          throw new BtpTransitionError('Vérifiez le début des travaux et renseignez des dates d’arrêté croissantes jusqu’au métré sélectionné.');
        }
        if (pending.some((source) => {
          const date = revisionDate(source.date);
          return (window.start && date < window.start) || (window.end && date > window.end);
        })) {
          throw new BtpTransitionError('La date d’un attachement est hors de la période sélectionnée.');
        }

        const bordereau = await this.getBordereauTx(tx, projectId);
        const lines = new Map((bordereau?.lignes ?? []).map((line) => [line.id ?? String(line.numero), line]));
        const metresByLine = new Map(currentMetres.map((metre) => [metre.bordereauLigneId, metre]));
        const integratedAt = new Date();
        for (const source of pending) {
          const line = lines.get(source.ligneId);
          if (!line) throw new BtpTransitionError('Reliez la quantité à une ligne du bordereau de ce projet');
          if (line.avenant) assertAvenantWorkWindow(line, window, source.isExecutionDate ? revisionDate(source.date) : undefined);
          const existing = metresByLine.get(source.ligneId);
          const totals = appendTerrainMeasurement(line.unite, (existing?.lignes ?? []) as MetreLigne[], {
            id: source.id, designation: source.designation, unite: source.unite, quantite: Number(source.quantite), note: source.note,
          }, (existing?.sousSections ?? []) as MetreSousSection[]);
          const values = { designationBordereau: line.designation, unite: line.unite, lignes: totals.lignes,
            totalPartiel: String(totals.totalPartiel), quantiteBordereau: String(line.quantite), updatedAt: integratedAt };
          const [saved] = existing
            ? await tx.update(metres).set(values).where(eq(metres.id, existing.id)).returning()
            : await tx.insert(metres).values({ projectId, periodeId, bordereauLigneId: source.ligneId, ...values }).returning();
          if (!saved) throw new BtpTransitionError('Enregistrement du métré échoué');
          metresByLine.set(source.ligneId, saved);
          await tx.update(chantierAttachements).set({ statut: 'integre', metreId: saved.id, integratedAt, integratedBy: actor })
            .where(eq(chantierAttachements.id, source.id));
          result.set(source.id, saved.id);
        }
        await this.rebuildChainTx(tx, projectId);
      }
      return { periodeId, attachements: ids.map((attachementId) => ({ attachementId, metreId: result.get(attachementId)! })) };
    });
  }

  async listDecomptes(projectId: string) {
    const rows = await this.db
      .select({ decompte: decomptes, periodeLibelle: periodes.libelle, trace: decompteRevisions.calculationDetails })
      .from(decomptes)
      .leftJoin(periodes, eq(decomptes.periodeId, periodes.id))
      .leftJoin(decompteRevisions, eq(decompteRevisions.decompteId, decomptes.id))
      .where(and(eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt)))
      .orderBy(asc(decomptes.numero));
    return rows.map((r) => ({
      ...mapDecompte(r.decompte), periodeLibelle: r.periodeLibelle, revisionTrace: readRevisionTrace(r.trace),
    }));
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
      const project = await this.getProject(row.projectId);
      periode = periodeRow ? mapPeriode(periodeRow, project ? chantierStart(project) : null) : null;
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
    return this.db.transaction(async (tx) => {
      await lockBtpProject(tx, projectId);
      const [existing] = await tx.select().from(decomptes).where(and(
        eq(decomptes.id, decompteId), eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt),
      )).limit(1);
      if (!existing) return null;
      const locked = LOCKED_DECOMPTE_STATUTS.has(existing.statut);
      const next = patch.statut && patch.statut !== existing.statut
        ? assertDecompteTransition(existing.statut, patch.statut) : existing.statut;
      if (patch.dateDecompte !== undefined && locked) {
        throw new BtpTransitionError('La date d’un décompte validé ou payé est verrouillée.');
      }
      if (locked && next === 'draft') await this.assertEditableChain(tx, projectId, existing.numero + 1);

      const establishing = !locked && next !== existing.statut && (next === 'submitted' || next === 'validated');
      const suppliedDate = patch.dateDecompte === undefined ? existing.dateDecompte : patch.dateDecompte;
      const dateDecompte = suppliedDate ?? (establishing ? new Date(`${casablancaDay()}T00:00:00Z`) : null);
      if (next === 'validated' && !locked) {
        const billedPrices = new Set((existing.lignes as DecompteLigne[]).filter((line) => line.quantiteRealisee !== 0).map((line) => line.prixNo));
        const bordereau = await this.getBordereauTx(tx, projectId);
        const amendmentIds = [...new Set((bordereau?.lignes ?? []).flatMap((line) =>
          line.avenant && billedPrices.has(line.numero) ? [line.avenant.id] : []))];
        if (amendmentIds.length) {
          if (!dateDecompte) throw new BtpTransitionError('Renseigner la date du décompte qui contient des prix supplémentaires.');
          const [notYetApproved] = await tx.select({ reference: avenants.reference }).from(avenants).where(and(
            eq(avenants.projectId, projectId), inArray(avenants.id, amendmentIds),
            sql`(${avenants.dateApprobation} IS NULL OR ${avenants.dateApprobation} > ${revisionDate(dateDecompte)}::date)`,
          )).limit(1);
          if (notYetApproved) throw new BtpTransitionError(`Le décompte précède l’approbation de l’avenant ${notYetApproved.reference ?? ''}.`);
        }
        const [config] = await tx.select({ enabled: projectRevisionConfig.isEnabled })
          .from(projectRevisionConfig).where(eq(projectRevisionConfig.projectId, projectId));
        const [previousDraft] = await tx.select({ numero: decomptes.numero }).from(decomptes)
          .where(and(eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt),
            sql`${decomptes.numero} < ${existing.numero} AND ${decomptes.statut} NOT IN ('validated', 'paid')`))
          .limit(1);
        if (config?.enabled && previousDraft) throw new BtpTransitionError(`Valider d’abord le décompte n°${previousDraft.numero}.`);
      }

      if (establishing && dateDecompte) {
        if (revisionDate(dateDecompte) > casablancaDay()) throw new BtpTransitionError('La date d’établissement est dans le futur.');
        if (existing.periodeId) {
          const [period] = await tx.select({ end: periodes.dateFin }).from(periodes).where(eq(periodes.id, existing.periodeId));
          if (period?.end && dateDecompte < period.end) {
            throw new BtpTransitionError('La date d’établissement précède la date d’arrêté du métré.');
          }
        }
      }

      if (patch.dateDecompte !== undefined || (establishing && !existing.dateDecompte)) {
        await tx.update(decomptes).set({ dateDecompte }).where(eq(decomptes.id, decompteId));
      }
      if (!locked) await this.rebuildChainTx(tx, projectId);
      if (next === 'validated' && !locked) {
        const [revision] = await tx.select({ details: decompteRevisions.calculationDetails })
          .from(decompteRevisions).where(eq(decompteRevisions.decompteId, decompteId));
        const trace = readRevisionTrace(revision?.details);
        if (existing.isDernier && trace?.status === 'pending') {
          throw new BtpTransitionError('Compléter la révision des prix avant de valider le dernier décompte.');
        }
        if (trace?.period.issues.length) throw new BtpTransitionError(trace.period.issues.join(' '));
        if (trace?.pendingPeriods.some(({ period }) =>
          period.issues.some((issue) => issue.startsWith('Décompte historique')))) {
          throw new BtpTransitionError('Rapprocher la révision historique avant de valider ce décompte.');
        }
      }
      await tx.update(decomptes).set({ statut: next, updatedAt: new Date() }).where(eq(decomptes.id, decompteId));
      if (locked && next === 'draft') await this.rebuildChainTx(tx, projectId);
      const [row] = await tx.select().from(decomptes).where(eq(decomptes.id, decompteId));
      return row ? mapDecompte(row) : null;
    });
  }

  // ── Attachement ────────────────────────────────────────────────────────────

  async getAttachement(projectId: string, periodeId?: string) {
    const allPeriodes = (await this.listPeriodes(projectId)) as PeriodeRecord[];
    const target = periodeId
      ? (allPeriodes.find((p) => p.id === periodeId) ?? null)
      : (allPeriodes[allPeriodes.length - 1] ?? null);
    const bordereau = target ? await this.getBordereauForPeriode(projectId, target.id, target.dateFin) : await this.getBordereau(projectId);
    if (!bordereau) return null;
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

  async assertEditableChain(tx: Tx, projectId: string, fromNumero: number): Promise<void> {
    const [locked] = await tx.select({ numero: decomptes.numero }).from(decomptes).where(and(
      eq(decomptes.projectId, projectId), gte(decomptes.numero, fromNumero), isNull(decomptes.deletedAt),
      sql`${decomptes.statut} IN ('validated', 'paid')`,
    )).limit(1);
    if (locked) throw new BtpTransitionError(`Le décompte n°${locked.numero} est validé ou payé. Sa base de calcul est verrouillée.`);
  }

  async getBordereauTx(tx: Tx | Db, projectId: string, asOf?: Date | null): Promise<BordereauRecord | null> {
    if (asOf === null) return this.getOriginalBordereau(tx, projectId);
    return (await this.loadBordereauProjection(tx, projectId))(asOf);
  }

  private async getOriginalBordereau(tx: Tx | Db, projectId: string): Promise<BordereauRecord | null> {
    const [row] = await tx
      .select()
      .from(bordereaux)
      .where(and(eq(bordereaux.projectId, projectId), isNull(bordereaux.deletedAt)))
      .orderBy(asc(bordereaux.createdAt))
      .limit(1);
    return row ? mapBordereau(row) : null;
  }

  async loadBordereauProjection(tx: Tx | Db, projectId: string): Promise<(asOf?: Date | null) => BordereauRecord | null> {
    const original = await this.getOriginalBordereau(tx, projectId);
    if (!original) return () => null;
    const approved = await listApprovedBordereauImpacts(tx, projectId);
    return (asOf) => {
      if (asOf === null || !approved.length) return original;
      const day = asOf ? revisionDate(asOf) : undefined;
      const applicable = day ? approved.filter(({ impact }) => impact.dateEffet <= day) : approved;
      if (!applicable.length) return original;
      const lignes = projectAvenantBordereau(original.lignes, applicable);
      const ht = lignes.reduce((total, line) => total.plus(toDecimal(line.quantite).times(line.prixUnitaire)), toDecimal(0));
      return { ...original, lignes, montantTotalMad: round2(ht).toNumber(), modifieParAvenant: true };
    };
  }

  /**
   * Recomputes, in numero order, every période's décompte from the métrés —
   * cumulative quantities, TVA/TTC, exercices antérieurs vs décomptes
   * précédents, retenue de garantie, révision on the dernier — then refreshes
   * the métrés' cumulés and the project progress. Idempotent.
   */
  async rebuildChainTx(tx: Tx, projectId: string): Promise<void> {
    await this.calculateChainTx(tx, projectId, false);
  }

  async getRevisionReport(projectId: string): Promise<RevisionReport | null> {
    return this.db.transaction((tx) => this.calculateChainTx(tx, projectId, true), {
      isolationLevel: 'repeatable read', accessMode: 'read only',
    });
  }

  private async calculateChainTx(tx: Tx, projectId: string, readOnly: boolean): Promise<RevisionReport | null> {
    const project = await lockBtpProject(tx, projectId, readOnly);
    if (!project) return null;
    const bordereauProjection = await this.loadBordereauProjection(tx, projectId);
    const bordereauLignes = bordereauProjection()?.lignes ?? [];
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
        .select({ row: decomptes, trace: decompteRevisions.calculationDetails })
        .from(decomptes)
        .leftJoin(decompteRevisions, eq(decompteRevisions.decompteId, decomptes.id))
        .where(and(eq(decomptes.projectId, projectId), isNull(decomptes.deletedAt))),
      tx
        .select()
        .from(projectRevisionConfig)
        .where(eq(projectRevisionConfig.projectId, projectId))
        .limit(1),
    ]);

    // Révision context (formula + monthly indexes), loaded once.
    const config = configRow[0];
    const datedAttachments = config?.isEnabled ? await tx.select({
      id: chantierAttachements.id,
      metreId: chantierAttachements.metreId,
      ligneId: chantierAttachements.ligneId,
      date: chantierAttachements.date,
      quantite: chantierAttachements.quantite,
    }).from(chantierAttachements).where(and(
      eq(chantierAttachements.projectId, projectId),
      eq(chantierAttachements.statut, 'integre'),
      eq(chantierAttachements.isExecutionDate, true),
    )) : [];
    const terrainSources = new Map(datedAttachments.map((source) => [source.id, source]));
    const unitPrices = new Map(bordereauLignes.map((line) => [line.id ?? String(line.numero), line.prixUnitaire]));
    const approved = await sumApprovedAvenants(tx, projectId);
    const contractAmount = project.montantMarcheInitialMad != null || num(approved.amount) !== 0
      ? currentContractAmount(project, approved.amount).toNumber() : undefined;
    const revisionDates = resolveRevisionDates(project, config, num(approved.months));
    const formulas = new Map<string, RevisionFormulaSpec>();
    const monthlyIndexes = new Map<string, PublishedIndexes[]>();
    if (config?.isEnabled) {
      const formulaIds = [...new Set([config.formulaId, ...bordereauLignes.map((line) => line.avenant?.formuleId)])]
        .filter((id): id is string => !!id);
      const formulaRows = formulaIds.length ? await tx.select().from(revisionFormulas).where(inArray(revisionFormulas.id, formulaIds)) : [];
      for (const formulaRow of formulaRows) {
        formulas.set(formulaRow.id, {
          id: formulaRow.id,
          name: formulaRow.name,
          fixedPart: num(formulaRow.fixedPart),
          weights: (formulaRow.weights as Record<string, number>) ?? {},
        });
      }
      if (formulas.size || bordereauLignes.some((line) => line.avenant?.formuleSnapshot)) {
        const indexRows = await tx.select().from(revisionIndexes);
        for (const row of indexRows) {
          monthlyIndexes.set(revisionDate(row.monthDate).slice(0, 7), [
            { values: row.indexValues as IndexValues, status: row.status, source: row.source, publishedOn: row.publishedOn },
            ...(row.previousPublications as PublishedIndexes[]),
          ]);
        }
      }
    }
    const formula = config?.formulaId ? formulas.get(config.formulaId) ?? null : null;

    const metresByPeriode = new Map<string, (typeof metreRows)[number][]>();
    for (const m of metreRows) {
      const bucket = metresByPeriode.get(m.periodeId);
      if (bucket) bucket.push(m);
      else metresByPeriode.set(m.periodeId, [m]);
    }
    const decompteByPeriode = new Map(
      existingDecomptes.filter(({ row }) => row.periodeId).map((record) => [record.row.periodeId!, record]),
    );

    const cumulative = new Map<string, number>(); // ligneId → cumul (rounded)
    const priorAcomptes: PriorDecompteAcompte[] = [];
    let dernierTtc = 0;
    let previousHt = 0;
    let previousRevision = 0;
    let legacyUnreconciled = false;
    let previousEnd: Date | null = null;
    let previousStatementDate: string | null = null;
    const recognized = new Map<number, RevisionPeriod>();
    const periods: {
      numero: number;
      start: Date | null;
      end: Date | null;
      amount: number;
      monthlyHt?: Record<string, number>;
      allocationSource?: 'attachements';
      groups?: AvenantRevisionGroup[];
      issues: string[];
    }[] = [];
    const today = casablancaDay();
    const reportCutoff = existingDecomptes.map(({ row }) => row).sort((a, b) => b.numero - a.numero)[0]?.dateDecompte;
    const reportDate = reportCutoff ? revisionDate(reportCutoff) : today;
    const reportRows: RevisionReportInputRow[] = [];
    let reportResults: { numero: number; period: RevisionPeriod }[] = [];
    let reportBase: PublishedIndexes | null = null;
    const finalCount = periodeRows.filter((period) => period.isDecompteDernier).length;

    for (const periodeRow of periodeRows) {
      // Add this période's métré totals to the running cumulative.
      const periodeMetres = metresByPeriode.get(periodeRow.id) ?? [];
      const quantityDeltas = new Map<string, number>();
      for (const m of periodeMetres) {
        const prev = cumulative.get(m.bordereauLigneId) ?? 0;
        const updated = round2(toDecimal(prev).plus(num(m.totalPartiel)));
        cumulative.set(m.bordereauLigneId, updated.toNumber());
        quantityDeltas.set(m.bordereauLigneId, toDecimal(quantityDeltas.get(m.bordereauLigneId) ?? 0).plus(updated.minus(prev)).toNumber());
      }
      // Refresh each métré's cumulé + % réalisation columns.
      for (const m of readOnly ? [] : periodeMetres) {
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
        decompteByPeriode.get(periodeRow.id)?.row.dateDecompte ??
        periodeRow.dateFin ??
        periodeRow.createdAt
      ).getFullYear();

      const existing = decompteByPeriode.get(periodeRow.id);
      const recorded = existing?.row;
      const locked = recorded && LOCKED_DECOMPTE_STATUTS.has(recorded.statut);
      const periodPrices = bordereauProjection(periodeRow.dateFin)?.lignes ?? [];
      const financeInput = {
        bordereauLignes: periodPrices,
        cumulativeQuantites: cumulative,
        tauxTva: num(periodeRow.tauxTva),
        tauxRetenue: num(periodeRow.tauxRetenue),
        isDernier: periodeRow.isDecompteDernier,
        priorAcomptes,
        anneeCourante,
        contractAmount,
      };
      const baseComputation = computeDecompte(financeInput);
      const totalHt = locked ? num(recorded.totalHtMad) : baseComputation.totalHt;
      const periodHt = round2(toDecimal(totalHt).minus(previousHt)).toNumber();
      const { dateFin: end, numero } = periodeRow;
      const cumulativeStart = chantierStart(project);
      const start = periods.length ? previousEnd && revisionDayAfter(previousEnd) : cumulativeStart;
      const issues: string[] = [];
      const cutoff = readOnly ? reportDate : recorded?.dateDecompte ? revisionDate(recorded.dateDecompte) : today;
      const statementDate = recorded?.dateDecompte ? revisionDate(recorded.dateDecompte) : null;
      const outOfOrder = previousStatementDate !== null && (statementDate ?? cutoff) < previousStatementDate;
      if (statementDate && (!previousStatementDate || statementDate > previousStatementDate)) previousStatementDate = statementDate;
      if (outOfOrder) issues.push('La date d’établissement précède celle d’un décompte antérieur.');
      if (!cumulativeStart) issues.push('Renseigner l’OS ou le début effectif des travaux dans la fiche du marché.');
      if (start && end && end < start && !(periodHt === 0 && previousEnd?.getTime() === end.getTime())) {
        issues.push('La date d’arrêté du métré doit suivre celle du métré précédent et le début des travaux.');
      }
      if (periods.length && !previousEnd) issues.push('Renseigner la date d’arrêté du métré précédent.');
      if (end && revisionDates.contractDeadline && end > revisionDates.contractDeadline && config?.delayAttributable === null) {
        issues.push('Qualifier le retard au-delà de la fin du délai contractuel.');
      }
      if (config?.delayAttributable && !revisionDates.contractDeadline) {
        issues.push('Renseigner la fin du délai contractuel pour appliquer la règle de retard.');
      }
      if (revisionDates.contractDeadline && project.ordreServiceDate && revisionDates.contractDeadline < project.ordreServiceDate) {
        issues.push('La fin du délai contractuel précède l’ordre de service.');
      }
      if (!readOnly && locked && !readRevisionTrace(existing.trace) && num(recorded.revisionMontantMad) !== 0) {
        issues.push('Décompte historique validé ou payé · rapprocher la révision de la pièce d’origine.');
      }
      const monthlyHt = (periodeRow.revisionMonthlyHt as Record<string, number> | null) ?? undefined;
      const grouped = config?.isEnabled ? splitAvenantRevisionGroups(periodPrices, quantityDeltas, start, periodHt) : undefined;
      const inputs = periodeMetres.map((measurement) => ({ ...measurement, lignes: measurement.lignes as MetreLigne[] }));
      const terrainMonthlyHt = grouped || monthlyHt || !terrainSources.size ? undefined : allocateRevisionFromTerrain({
        amount: periodHt, start, end, prix: unitPrices, sources: terrainSources,
        metres: inputs,
      });
      if (grouped && !grouped.reconciled) issues.push('Rapprocher le HT des travaux supplémentaires des quantités du métré.');
      if (grouped) {
        for (const group of grouped.groups) {
          group.monthlyHt = allocateRevisionFromTerrain({ start: group.start, end, prix: unitPrices, sources: terrainSources,
            amount: group.amount, metres: inputs.filter(({ bordereauLigneId }) => group.lineIds.includes(bordereauLigneId)) });
          if (group.monthlyHt) group.allocationSource = 'attachements';
        }
        if (monthlyHt && grouped.groups.length === 1) {
          const group = grouped.groups[0]!;
          const startingMonth = group.start && revisionDate(group.start).slice(0, 7);
          group.monthlyHt = Object.fromEntries(Object.entries(monthlyHt).filter(([month, value]) => value !== 0 || !startingMonth || month >= startingMonth));
          delete group.allocationSource;
        } else if (monthlyHt) {
          const measured = new Map<string, number>();
          for (const group of grouped.groups) {
            for (const [month, value] of Object.entries(group.monthlyHt ?? {})) {
              measured.set(month, toDecimal(measured.get(month) ?? 0).plus(value).toNumber());
            }
          }
          if (grouped.groups.some((group) => !group.monthlyHt)
              || [...new Set([...Object.keys(monthlyHt), ...measured.keys()])].some((month) => (monthlyHt[month] ?? 0) !== (measured.get(month) ?? 0))) {
            issues.push('Le HT mensuel saisi regroupe plusieurs bases de prix. Rapprocher la ventilation des attachements par prix ou sélectionner la ventilation automatique.');
          }
        }
      }
      periods.push({
        numero, start, end, amount: periodHt, issues,
        monthlyHt: monthlyHt ?? terrainMonthlyHt,
        ...(terrainMonthlyHt ? { allocationSource: 'attachements' as const } : {}),
        ...(grouped ? { groups: grouped.groups } : {}),
      });
      previousEnd = end;
      previousHt = totalHt;

      if (locked) {
        const snapshot = readRevisionTrace(existing.trace);
        for (const item of snapshot?.recognized ?? []) recognized.set(item.numero, item.period);
        if (!snapshot && num(recorded.revisionMontantMad) !== 0) legacyUnreconciled = true;
        previousRevision = num(recorded.revisionMontantMad);
        priorAcomptes.push({ montantAcompte: num(recorded.montantAcompteMad), annee: anneeCourante });
        dernierTtc = num(recorded.totalTtcMad);
        if (!readOnly) continue;
      }

      let trace: RevisionTrace | null = null;
      let baseIndexes: IndexValues = {};
      let revisionAmount = previousRevision;
      if (config?.isEnabled) {
        const isLast = periodeRow.isDecompteDernier && finalCount === 1 && periodeRows.at(-1)?.id === periodeRow.id;
        const codes = Object.keys(formula?.weights ?? {});
        const basePublication = revisionDates.baseDate
          ? selectPublishedIndexes(monthlyIndexes, revisionDate(revisionDates.baseDate).slice(0, 7), codes, cutoff, false, readOnly)
          : null;
        baseIndexes = { ...basePublication?.values, ...(config.baseIndexes as IndexValues) };
        const blockers: string[] = [];
        const initialAmount = num(project.montantMarcheInitialMad ?? project.montantMarcheMad);
        const limitedIndexes = initialAmount > 0 && initialAmount <= 1_000_000;
        if (finalCount > 1 || (periodeRow.isDecompteDernier && !isLast)) {
          blockers.push('Identifier une seule période de clôture à la fin de la chaîne.');
        }
        if (recorded?.dateDecompte && end && recorded.dateDecompte < end) {
          blockers.push('La date d’établissement précède la fin des travaux de la période.');
        }
        if (cutoff > today) blockers.push('La date d’établissement est dans le futur.');
        const results = periods.map(({ numero: n, issues: periodIssues, groups, ...period }) => {
          const inputs = { ...period, formula, monthlyIndexes, cutoff, allowProvisional: isLast,
            allowUndatedIndexes: readOnly,
            contractDeadline: config.delayAttributable ? revisionDates.contractDeadline : null };
          const issues = [...blockers, ...periodIssues];
          const snapshot = recognized.get(n);
          if (snapshot) return { numero: n, period: snapshot };
          if (groups) return { numero: n, period: calculateAvenantRevisionPeriod({
            ...inputs, groups, baseDate: revisionDates.baseDate, baseOverrides: config.baseIndexes as IndexValues,
            formulas, limitedIndexes, issues,
          }) };
          if (!revisionDates.baseDate) issues.push('Date contractuelle de référence manquante.');
          if (limitedIndexes && codes.length > 5) issues.push('Maximum cinq indices pour un marché jusqu’à 1 000 000 MAD.');
          return { numero: n, period: calculateRevisionPeriod({ ...inputs, baseIndexes, issues }) };
        });
        const period = results.at(-1)!.period;
        // A final statement needs a complete reconciliation. An ordinary one can
        // recognize completed earlier periods and leave the rest to the next.
        const pendingPeriods = results.filter((item) => item.period.amount === null);
        const hold = isLast || legacyUnreconciled || outOfOrder;
        const settlement = settleRevision(results.map((item) => item.period), previousRevision, hold, { postingMode: config.postingMode, isLast });
        const included = settlement.deferred || (hold && pendingPeriods.length) ? [...recognized].map(([n, period]) => ({ numero: n, period }))
          : results.filter((item) => item.period.amount !== null);
        revisionAmount = settlement.cumulative;
        trace = { version: 1, cutoff, basePublication, period, recognized: included, pendingPeriods, ...settlement };
        if (readOnly) {
          reportResults = results;
          reportBase = basePublication;
        }
      }

      const computation = trace || revisionAmount !== 0 ? computeDecompte({ ...financeInput, revisionAmount }) : baseComputation;

      if (readOnly) {
        const original = locked ? readRevisionTrace(existing.trace) : null;
        reportRows.push({
          decompteId: recorded?.id ?? periodeRow.id, numero, isDernier: periodeRow.isDecompteDernier,
          dateDecompte: recorded?.dateDecompte ? revisionDate(recorded.dateDecompte) : null,
          statut: recorded?.statut ?? 'draft', cumulative: num(recorded?.revisionMontantMad), trace: original,
          period: trace?.period ?? null,
          origin: locked ? original ? 'recorded' : 'reconstituted' : 'draft',
          warnings: locked && !recorded.dateDecompte ? ['Date d’établissement historique non renseignée.'] : [],
        });
        if (!locked) {
          priorAcomptes.push({ montantAcompte: computation.montantAcompte, annee: anneeCourante });
          dernierTtc = computation.totalTtc;
          previousRevision = computation.revisionMontant;
        }
        continue;
      }

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
      if (periodeRow.dateDebut?.getTime() !== cumulativeStart?.getTime()) {
        await tx.update(periodes).set({ dateDebut: cumulativeStart }).where(eq(periodes.id, periodeRow.id));
      }
      let decompteId: string;
      if (recorded) {
        decompteId = recorded.id;
        await tx.update(decomptes).set(values).where(eq(decomptes.id, recorded.id));
      } else {
        const [inserted] = await tx
          .insert(decomptes)
          .values({ projectId, periodeId: periodeRow.id, ...values })
          .returning({ id: decomptes.id });
        if (!inserted) throw new BtpTransitionError('Création du décompte échouée');
        decompteId = inserted.id;
      }

      if (trace) {
        const revisionValues = {
          montantAReviser: String(trace.period.ht),
          coefficientApplique: null,
          montantRevision: String(computation.revisionMontant),
          calculationDetails: trace,
          formulaSnapshot: formula,
          baseIndexesSnapshot: baseIndexes,
          status: trace.status,
          updatedAt: new Date(),
        };
        await tx.insert(decompteRevisions).values({ decompteId, ...revisionValues })
          .onConflictDoUpdate({ target: decompteRevisions.decompteId, set: revisionValues });
      } else {
        await tx.delete(decompteRevisions).where(eq(decompteRevisions.decompteId, decompteId));
      }

      priorAcomptes.push({ montantAcompte: computation.montantAcompte, annee: anneeCourante });
      dernierTtc = computation.totalTtc;
      previousRevision = computation.revisionMontant;
    }

    // Progress % (financial): dernier TTC ÷ marché TTC.
    if (!readOnly) {
      const progress = computeProgressPct(dernierTtc, bordereauLignes, contractAmount);
      await tx.update(projects).set({ progressPct: String(progress), updatedAt: new Date() }).where(eq(projects.id, projectId));
      return null;
    }
    const periodByNumber = new Map(reportResults.map((result) => [result.numero, result.period]));
    for (const row of reportRows) {
      row.period = periodByNumber.get(row.numero) ?? row.period;
      if (row.origin === 'recorded' && !isDeepStrictEqual(row.period, row.trace?.period)) row.origin = 'reconstituted';
      if ((reportBase && !reportBase.publishedOn) || row.period?.months.some((month) =>
        (month.publication && !month.publication.publishedOn) || (month.priceBasis?.publication && !month.priceBasis.publication.publishedOn)
        || (month.contractPublication && !month.contractPublication.publishedOn))) {
        row.warnings?.push('Calcul indicatif sur les valeurs du registre. Dates de publication à vérifier avant intégration.');
      }
    }
    for (const { row } of existingDecomptes.filter(({ row }) => !row.periodeId)) {
      reportRows.push({ decompteId: row.id, numero: row.numero, isDernier: row.isDernier,
        dateDecompte: row.dateDecompte ? revisionDate(row.dateDecompte) : null, statut: row.statut,
        cumulative: num(row.revisionMontantMad), trace: null, origin: 'reconstituted',
        warnings: ['Rattacher ce décompte historique à sa période de métré.'] });
    }
    return buildRevisionReport({
      project: { ...project, ordreServiceDate: project.ordreServiceDate && revisionDate(project.ordreServiceDate) },
      mode: config?.postingMode ?? 'each_decompte', cutoff: reportDate,
      baseDate: revisionDates.baseDate && revisionDate(revisionDates.baseDate), formula, basePublication: reportBase,
      baseIndexes: config?.baseIndexes as IndexValues | undefined,
      rows: reportRows.sort((a, b) => a.numero - b.numero),
    });
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

function casablancaDay(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Casablanca' }).format(new Date());
}

export function newId(): string {
  return randomUUID();
}
