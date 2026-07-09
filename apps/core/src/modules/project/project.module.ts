import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { PeopleModule } from '../people/people.module';
import { StockModule } from '../stock/stock.module';
import { buildDecompte } from './decompte.domain';
import { computeDecompteTotals, computeRecap } from './decompte-finance.domain';
import {
  calculatePartiel,
  computeMetreTotals,
  type MetreLigneInput,
  type Unite,
} from './metre-calc.domain';
import {
  generateAttachement,
  generateDecompteFromMetres,
  type BordereauLine,
  type MetreContribution,
} from './decompte-generation.domain';
import { ProjectCostService } from './project-cost.service';
import { ProjectRepositoryModule } from './project-repository.module';
import {
  PROJECT_REPOSITORY,
  type PeriodeRecord,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectStatus,
  type SituationRecord,
  type SituationStatus,
} from './project.repository';
import {
  computeProjectPhysicalProgress,
  summarizeTaskStatuses,
  TASK_STATUSES,
  type TaskStatus,
} from './task.domain';

const projectInputSchema = z.object({
  reference: z.string().min(3).max(200),
  name: z.string().min(3).max(500),
  buyerName: z.string().min(2).max(300),
  montantMarcheMad: z.number().positive().max(10_000_000_000),
  tenderId: z.string().uuid().optional(),
  ordreServiceDate: z.coerce.date().optional(),
  delaiMois: z.number().positive().max(240).optional(),
});

const situationInputSchema = z.object({
  periodEnd: z.coerce.date(),
  montantCumuleMad: z.number().nonnegative().max(10_000_000_000),
  notes: z.string().max(2000).optional(),
});

const transitionSchema = z.object({ to: z.string().min(2).max(30) });

const taskInputSchema = z.object({
  label: z.string().min(3).max(300),
  description: z.string().max(2000).optional(),
  progressPct: z.number().min(0).max(100).optional(),
  status: z.enum(TASK_STATUSES as readonly [TaskStatus, ...TaskStatus[]]).optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  orderIndex: z.number().int().min(0).max(10_000).optional(),
});

const taskPatchSchema = z
  .object({
    label: z.string().min(3).max(300),
    description: z.string().max(2000),
    progressPct: z.number().min(0).max(100),
    status: z.enum(TASK_STATUSES as readonly [TaskStatus, ...TaskStatus[]]),
    startDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    orderIndex: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Au moins un champ à modifier est requis',
  });

/** Editable "fiche marché" fields (partial patch — at least one required). */
const projectDetailsSchema = z
  .object({
    name: z.string().min(3).max(500),
    buyerName: z.string().min(2).max(300),
    montantMarcheMad: z.number().nonnegative().max(10_000_000_000),
    objet: z.string().max(4000),
    annee: z.string().max(10),
    societe: z.string().max(300),
    commune: z.string().max(200),
    typeMarche: z.string().max(60),
    modePassation: z.string().max(120),
    delaiExecutionJours: z.number().int().min(0).max(100_000),
    dateOuverture: z.coerce.date(),
    receptionProvisoire: z.coerce.date(),
    receptionDefinitive: z.coerce.date(),
    achevementTravaux: z.coerce.date(),
    assistanceTechnique: z.string().max(300),
    maitreOeuvre: z.string().max(300),
    progressPct: z.number().min(0).max(100),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Au moins un champ à modifier est requis',
  });

const bordereauLigneSchema = z.object({
  prixNo: z.union([z.string(), z.number()]).optional(),
  designation: z.string().max(1000).optional(),
  unite: z.string().max(60).optional(),
  quantite: z.number().optional(),
  prixUnitaire: z.number().optional(),
  montant: z.number().optional(),
});
const bordereauSchema = z.object({
  lignes: z.array(bordereauLigneSchema).max(5000),
});

const periodeInputSchema = z.object({
  numero: z.number().int().min(1).max(1000),
  libelle: z.string().max(255).optional(),
  dateDebut: z.coerce.date().optional(),
  dateFin: z.coerce.date().optional(),
  tauxTva: z.number().min(0).max(100).default(20),
  tauxRetenue: z.number().min(0).max(100).default(10),
  decomptesPrecedents: z.number().min(0).max(10_000_000_000).default(0),
  depensesExercicesAnterieurs: z.number().min(0).max(10_000_000_000).default(0),
  isDecompteDernier: z.boolean().default(false),
  observations: z.string().max(2000).optional(),
});

const decompteLigneSchema = z.object({
  prixNo: z.union([z.string(), z.number()]).optional(),
  designation: z.string().max(1000).optional(),
  unite: z.string().max(60).optional(),
  quantiteBordereau: z.number().optional(),
  quantiteRealisee: z.number().min(0).max(1_000_000_000),
  prixUnitaireHT: z.number().min(0).max(1_000_000_000),
});
const decompteInputSchema = z.object({
  periodeId: z.string().uuid().optional(),
  dateDecompte: z.coerce.date().optional(),
  isDernier: z.boolean().default(false),
  lignes: z.array(decompteLigneSchema).min(1).max(5000),
});

const metreLigneSchema = z.object({
  designation: z.string().max(500).optional(),
  sectionTitre: z.string().max(300).optional(),
  sousSectionTitre: z.string().max(300).optional(),
  longueur: z.number().optional(),
  largeur: z.number().optional(),
  profondeur: z.number().optional(),
  nombre: z.number().optional(),
  diametre: z.number().optional(),
  nombreSemblables: z.number().optional(),
  partiel: z.number().optional(), // direct override of the geometry calc
});
/** Save the métré of one période — one entry per bordereau line. */
const metreSaveSchema = z.object({
  metres: z
    .array(
      z.object({
        bordereauLigneId: z.string().min(1).max(200),
        designation: z.string().max(1000).optional(),
        unite: z.string().max(20),
        lignes: z.array(metreLigneSchema).max(5000),
      }),
    )
    .max(5000),
});

/** Chantier lifecycle (construction ops v1). */
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  preparation: ['en_cours'],
  en_cours: ['suspendu', 'receptionne'],
  suspendu: ['en_cours'],
  receptionne: ['clos'],
  clos: [],
};

/** Décompte lifecycle: drafting → submission → validation → payment. */
const SITUATION_TRANSITIONS: Record<SituationStatus, SituationStatus[]> = {
  brouillon: ['soumis'],
  soumis: ['valide'],
  valide: ['paye'],
  paye: [],
};

@Controller('project')
export class ProjectController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repository: ProjectRepository,
    // Explicit token: the runtime is tsx/esbuild which does NOT emit decorator
    // metadata, so type-only injection resolves to undefined. Every provider in
    // this codebase is injected via @Inject for exactly this reason.
    @Inject(ProjectCostService) private readonly cost: ProjectCostService,
  ) {
    // Fail loudly at construction if the cost service was not wired. A nullish
    // value here means the DI graph regressed (e.g. a reintroduced module cycle
    // instantiated this controller before ProjectCostService resolved). The real
    // guarantee is the acyclic module graph; this is a guard against silent
    // `Cannot read properties of undefined (reading 'costSummary')` at runtime.
    if (!this.cost) {
      throw new Error(
        'ProjectController: ProjectCostService was not injected — the project ' +
          'module DI graph is broken (likely a reintroduced circular dependency).',
      );
    }
  }

  /** Register a chantier (from a won tender or manually). */
  @Roles('travaux', 'direction', 'admin-si')
  @Post('projects')
  async create(@Body() body: unknown) {
    const parsed = projectInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.create(parsed.data);
  }

  /** Portfolio: every chantier with its financial position. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects')
  async list() {
    // One query for the whole portfolio instead of 1 (findAll) + N
    // (listSituations per project). The per-project fan-out made this endpoint's
    // latency grow with project count — it was the /stock Promise.all member most
    // likely to blow the read deadline on the shared DB and crash that page.
    const [records, allSituations] = await Promise.all([
      this.repository.findAll(),
      this.repository.listAllSituations(),
    ]);
    const byProject = new Map<string, SituationRecord[]>();
    for (const situation of allSituations) {
      const bucket = byProject.get(situation.projectId);
      if (bucket) bucket.push(situation);
      else byProject.set(situation.projectId, [situation]);
    }
    return records.map((record) =>
      this.financialPosition(record, byProject.get(record.id) ?? []),
    );
  }

  /**
   * Portfolio cost rollup for the list: per-project matériaux + main-d'œuvre +
   * dépenses against the marché budget, with restant + marge. Defined BEFORE the
   * :id routes so the literal path is not shadowed by projects/:id. One batched
   * service call (~5 queries), no per-project N+1.
   */
  @Roles('travaux', 'direction', 'finance', 'admin-si')
  @Get('projects/cost-summary')
  async costSummary() {
    return this.cost.costSummary();
  }

  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id')
  async detail(@Param('id') id: string) {
    const record = await this.findOr404(id);
    const situations = await this.repository.listSituations(id);
    return { ...(await this.present(record)), situations };
  }

  /** One chantier's cost breakdown: matériaux + main-d'œuvre + dépenses vs budget. */
  @Roles('travaux', 'direction', 'finance', 'admin-si')
  @Get('projects/:id/cost')
  async projectCost(@Param('id') id: string) {
    const cost = await this.cost.projectCost(id);
    if (!cost) throw new NotFoundException(`Project not found: ${id}`);
    return cost;
  }

  /** Chantier lifecycle transition. */
  @Roles('travaux', 'direction')
  @Post('projects/:id/transition')
  async transition(@Param('id') id: string, @Body() body: unknown) {
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);
    const allowed = PROJECT_TRANSITIONS[record.status] ?? [];
    if (!allowed.includes(parsed.data.to as ProjectStatus)) {
      throw new ConflictException(
        `Illegal transition: ${record.status} -> ${parsed.data.to}`,
      );
    }
    return this.repository.updateStatus(id, parsed.data.to as ProjectStatus);
  }

  /**
   * New situation de travaux: the décompte engine derives the period
   * amount, retenue de garantie and net à payer from the cumulative.
   */
  @Roles('travaux', 'direction')
  @Post('projects/:id/situations')
  async createSituation(@Param('id') id: string, @Body() body: unknown) {
    const parsed = situationInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);
    if (record.status !== 'en_cours') {
      throw new ConflictException(
        `Situations uniquement sur chantier en cours (état: ${record.status})`,
      );
    }

    const existing = await this.repository.listSituations(id);
    const last = existing[existing.length - 1];
    // The décompte ceiling includes approved avenants (contract amendments).
    const avenants = await this.repository.listAvenants(id);
    const plafond =
      record.montantMarcheMad +
      avenants.reduce((sum, a) => sum + a.montantDeltaMad, 0);
    let decompte;
    try {
      decompte = buildDecompte({
        montantMarcheMad: plafond,
        montantCumuleMad: parsed.data.montantCumuleMad,
        previousCumuleMad: last?.montantCumuleMad ?? 0,
        previousRetenueCumuleMad: existing.reduce(
          (sum, s) => sum + s.retenueGarantieMad,
          0,
        ),
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Décompte invalide',
      );
    }

    const created = await this.repository.createSituation({
      projectId: id,
      numero: (last?.numero ?? 0) + 1,
      periodEnd: parsed.data.periodEnd,
      montantCumuleMad: parsed.data.montantCumuleMad,
      notes: parsed.data.notes,
      ...decompte,
    });
    new Logger('Project').log(
      `situation.created ${record.reference} n°${created.numero} net=${created.netAPayerMad}`,
    );
    return created;
  }

  /** Avenant: contract amendment — direction approves, ceiling moves. */
  @Roles('direction')
  @Post('projects/:id/avenants')
  async createAvenant(@Param('id') id: string, @Body() body: unknown) {
    const schema = z.object({
      objet: z.string().min(5).max(500),
      montantDeltaMad: z.number().min(-1_000_000_000).max(1_000_000_000),
      delaiDeltaMois: z.number().min(-120).max(120).default(0),
      approvedAt: z.coerce.date(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    const existing = await this.repository.listAvenants(id);
    const created = await this.repository.createAvenant({
      projectId: id,
      numero: (existing[existing.length - 1]?.numero ?? 0) + 1,
      ...parsed.data,
    });
    new Logger('Project').log(
      `avenant.approved n°${created.numero} delta=${created.montantDeltaMad} MAD`,
    );
    return created;
  }

  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/avenants')
  async listAvenants(@Param('id') id: string) {
    await this.findOr404(id);
    return this.repository.listAvenants(id);
  }

  /** Bordereau des prix (BPU) lines for a chantier. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/bordereaux')
  async listBordereaux(@Param('id') id: string) {
    await this.findOr404(id);
    return this.repository.listBordereaux(id);
  }

  /** Périodes (billing periods) of a chantier. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/periodes')
  async listPeriodes(@Param('id') id: string) {
    await this.findOr404(id);
    return this.repository.listPeriodes(id);
  }

  /** Décomptes (line-item, BTP-style) of a chantier. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/decomptes')
  async listDecomptes(@Param('id') id: string) {
    await this.findOr404(id);
    return this.repository.listDecomptes(id);
  }

  /** Révision des prix: per-project config + reference formulas + monthly indexes. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/revision')
  async revision(@Param('id') id: string) {
    await this.findOr404(id);
    const [config, formulas, indexes] = await Promise.all([
      this.repository.getRevisionConfig(id),
      this.repository.listRevisionFormulas(),
      this.repository.listRevisionIndexes(),
    ]);
    return { config, formulas, indexes };
  }

  /** Métrés (measurements) of a chantier. */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/metres')
  async listMetres(@Param('id') id: string) {
    await this.findOr404(id);
    return this.repository.listMetres(id);
  }

  /** Edit a chantier's "fiche marché" (objet, société, dates, etc.). */
  @Roles('travaux', 'direction', 'admin-si')
  @Patch('projects/:id/details')
  async updateDetails(@Param('id') id: string, @Body() body: unknown) {
    const parsed = projectDetailsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    const updated = await this.repository.updateProjectDetails(id, parsed.data);
    if (!updated) throw new NotFoundException(`Project not found: ${id}`);
    new Logger('Project').log(`project.details.updated ${id}`);
    return updated;
  }

  /** Upsert the chantier's bordereau des prix (BPU). */
  @Roles('travaux', 'direction', 'admin-si')
  @Post('projects/:id/bordereau')
  async saveBordereau(@Param('id') id: string, @Body() body: unknown) {
    const parsed = bordereauSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    return this.repository.upsertBordereau(id, parsed.data.lignes);
  }

  /** Create a période de travaux for the chantier. */
  @Roles('travaux', 'direction', 'admin-si')
  @Post('projects/:id/periodes')
  async createPeriode(@Param('id') id: string, @Body() body: unknown) {
    const parsed = periodeInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    const existing = await this.repository.listPeriodes(id);
    if (existing.some((p) => p.numero === parsed.data.numero)) {
      throw new ConflictException(
        `Une période N°${parsed.data.numero} existe déjà pour ce chantier`,
      );
    }
    return this.repository.createPeriode({ projectId: id, ...parsed.data });
  }

  /**
   * Create a décompte — HT/TVA/TTC and the récapitulatif (retenue de garantie,
   * net à payer) are computed server-side by the Excel-compliant finance engine
   * from the entered realized quantities and the période's TVA/retenue rates.
   */
  @Roles('travaux', 'direction')
  @Post('projects/:id/decomptes')
  async createDecompte(@Param('id') id: string, @Body() body: unknown) {
    const parsed = decompteInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);

    const periode = parsed.data.periodeId
      ? (await this.repository.listPeriodes(id)).find(
          (p) => p.id === parsed.data.periodeId,
        )
      : undefined;
    if (parsed.data.periodeId && !periode) {
      throw new NotFoundException(`Période introuvable: ${parsed.data.periodeId}`);
    }
    const decomptes = await this.repository.listDecomptes(id);
    if (
      parsed.data.periodeId &&
      decomptes.some((d) => d.periodeId === parsed.data.periodeId)
    ) {
      throw new ConflictException('Un décompte existe déjà pour cette période');
    }

    const tauxTva = periode?.tauxTva ?? 20;
    const tauxRetenue = periode?.tauxRetenue ?? 10;
    const decomptesPrecedents = periode?.decomptesPrecedents ?? 0;
    const depensesExercicesAnterieurs = periode?.depensesExercicesAnterieurs ?? 0;

    const totals = computeDecompteTotals(parsed.data.lignes, tauxTva);
    const recap = computeRecap({
      totalTtcMad: totals.totalTtcMad,
      tauxRetenue,
      decomptesPrecedents,
      depensesExercicesAnterieurs,
    });
    const numero = (decomptes[decomptes.length - 1]?.numero ?? 0) + 1;

    const created = await this.repository.createDecompte({
      projectId: id,
      periodeId: parsed.data.periodeId,
      numero,
      dateDecompte: parsed.data.dateDecompte,
      lignes: totals.lignes,
      totalHtMad: totals.totalHtMad,
      montantTvaMad: totals.montantTvaMad,
      totalTtcMad: totals.totalTtcMad,
      totalGeneralTtcMad: totals.totalTtcMad,
      montantCumuleMad: totals.totalTtcMad,
      montantPrecedentMad: decomptesPrecedents,
      montantActuelMad: recap.montantActuelMad,
      retenueGarantieMad: recap.retenueGarantieMad,
      netAPayerMad: recap.netAPayerMad,
      isDernier: parsed.data.isDernier,
      statut: 'draft',
    });
    new Logger('Project').log(
      `decompte.created ${id} n°${created.numero} ttc=${created.totalTtcMad} net=${created.netAPayerMad}`,
    );
    return created;
  }

  /**
   * Save the métré of a période (the ONLY quantity input) and AUTO-REBUILD the
   * décompte: quantité réalisée per bordereau line = cumulative Σ métré partiels
   * over périodes ≤ current. Partiels are computed server-side per unité.
   */
  @Roles('travaux', 'direction', 'admin-si')
  @Post('projects/:id/periodes/:periodeId/metres')
  async saveMetres(
    @Param('id') id: string,
    @Param('periodeId') periodeId: string,
    @Body() body: unknown,
  ) {
    const parsed = metreSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    const periodes = await this.repository.listPeriodes(id);
    const current = periodes.find((p) => p.id === periodeId);
    if (!current) throw new NotFoundException(`Période introuvable: ${periodeId}`);

    const metreInputs = parsed.data.metres.map((m) => {
      const unite = m.unite as Unite;
      const lignes = m.lignes.map((l) => ({
        ...l,
        partiel:
          l.partiel !== undefined
            ? l.partiel
            : calculatePartiel(unite, l as MetreLigneInput),
      }));
      const totals = computeMetreTotals(
        lignes.map((l) => l.partiel),
        0,
        0,
      );
      return {
        bordereauLigneId: m.bordereauLigneId,
        designation: m.designation,
        unite: m.unite,
        data: { lignes },
        totalQuantite: totals.totalPartiel,
      };
    });
    await this.repository.saveMetres(id, periodeId, metreInputs);
    const decompte = await this.rebuildDecompte(id, periodeId, periodes);
    new Logger('Project').log(
      `metre.saved ${id} periode=${current.numero} -> decompte ttc=${decompte?.totalTtcMad ?? 0}`,
    );
    return { ok: true, decompte };
  }

  /** Attachement provisoire — cumulative quantities per bordereau line (no prices). */
  @Roles('travaux', 'direction', 'finance', 'marches', 'admin-si')
  @Get('projects/:id/attachement')
  async attachement(@Param('id') id: string, @Query('periodeId') periodeId?: string) {
    await this.findOr404(id);
    const periodes = await this.repository.listPeriodes(id);
    const current = periodeId
      ? periodes.find((p) => p.id === periodeId)
      : periodes[periodes.length - 1];
    if (!current) return { periode: null, lignes: [] };
    const { bordereau, contributions } = await this.metreContext(id, periodes);
    return {
      periode: { id: current.id, numero: current.numero },
      lignes: generateAttachement(bordereau, contributions, current.numero),
    };
  }

  /** Bordereau lines + métré contributions shared by the generators. */
  private async metreContext(
    projectId: string,
    periodes: readonly PeriodeRecord[],
  ): Promise<{ bordereau: BordereauLine[]; contributions: MetreContribution[] }> {
    const bordereaux = await this.repository.listBordereaux(projectId);
    const bpu = (bordereaux[0]?.lignes ?? []) as Array<Record<string, unknown>>;
    const bordereau: BordereauLine[] = bpu.map((l, i) => ({
      key: String(l.prixNo ?? i + 1),
      prixNo: l.prixNo as string | number | undefined,
      designation: l.designation as string | undefined,
      unite: l.unite as string | undefined,
      quantite: Number(l.quantite) || 0,
      prixUnitaire: Number(l.prixUnitaire) || 0,
    }));
    const numByPeriode = new Map(periodes.map((p) => [p.id, p.numero]));
    const allMetres = await this.repository.listMetres(projectId);
    const contributions: MetreContribution[] = allMetres
      .filter((m) => m.periodeId && m.bordereauLigneId)
      .map((m) => ({
        bordereauLigneKey: m.bordereauLigneId as string,
        periodeNumero: numByPeriode.get(m.periodeId as string) ?? 0,
        totalPartiel: m.totalQuantite,
      }));
    return { bordereau, contributions };
  }

  /** Recompute + persist the décompte of a période from the current métrés. */
  private async rebuildDecompte(
    projectId: string,
    periodeId: string,
    periodes: readonly PeriodeRecord[],
  ) {
    const current = periodes.find((p) => p.id === periodeId);
    if (!current) return null;
    const { bordereau, contributions } = await this.metreContext(projectId, periodes);
    const decomptes = await this.repository.listDecomptes(projectId);
    const numByPeriode = new Map(periodes.map((p) => [p.id, p.numero]));
    const decomptesPrecedents = decomptes
      .filter((d) => (numByPeriode.get(d.periodeId ?? '') ?? 0) < current.numero)
      .reduce((s, d) => s + d.netAPayerMad, 0);
    const gen = generateDecompteFromMetres({
      bordereau,
      metres: contributions,
      currentPeriodeNumero: current.numero,
      tauxTva: current.tauxTva,
      isDernier: current.isDecompteDernier,
      depensesExercicesAnterieurs: current.depensesExercicesAnterieurs,
      decomptesPrecedents,
    });
    const existing = decomptes.find((d) => d.periodeId === current.id);
    return this.repository.upsertDecompteForPeriode({
      projectId,
      periodeId: current.id,
      numero: existing?.numero ?? current.numero,
      lignes: gen.lignes,
      totalHtMad: gen.totalHtMad,
      montantTvaMad: gen.montantTvaMad,
      totalTtcMad: gen.totalTtcMad,
      totalGeneralTtcMad: gen.totalTtcMad,
      montantCumuleMad: gen.totalTtcMad,
      montantPrecedentMad: decomptesPrecedents,
      montantActuelMad: gen.netAPayerMad,
      retenueGarantieMad: gen.retenueGarantieMad,
      netAPayerMad: gen.netAPayerMad,
      isDernier: current.isDecompteDernier,
      statut: existing?.statut ?? 'draft',
    });
  }

  /** Add a tâche de chantier (physical work-breakdown item). */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post('projects/:id/tasks')
  async createTask(@Param('id') id: string, @Body() body: unknown) {
    const parsed = taskInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(id);
    return this.repository.createTask({ projectId: id, ...parsed.data });
  }

  /** Tâches with the physical avancement rollup (separate from financial). */
  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('projects/:id/tasks')
  async listTasks(@Param('id') id: string) {
    await this.findOr404(id);
    const tasks = await this.repository.listTasksByProject(id);
    return {
      tasks,
      physicalProgressPct: computeProjectPhysicalProgress(tasks),
      statusSummary: summarizeTaskStatuses(tasks),
    };
  }

  /** Update a tâche — label, progress, status, dates, order. */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Patch('projects/:projectId/tasks/:taskId')
  async updateTask(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const parsed = taskPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.findOr404(projectId);
    const task = await this.repository.findTaskById(taskId);
    // Scope the patch to the project: a task may only be mutated through the
    // project it belongs to, so cross-project access is rejected as not found.
    if (!task || task.projectId !== projectId) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    const updated = await this.repository.updateTask(taskId, parsed.data);
    if (!updated) throw new NotFoundException(`Task not found: ${taskId}`);
    return updated;
  }

  /** Décompte workflow — legal order enforced (brouillon→soumis→valide→paye). */
  @Roles('travaux', 'direction', 'finance')
  @Post('situations/:id/transition')
  async transitionSituation(@Param('id') id: string, @Body() body: unknown) {
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.repository.findSituationById(id);
    if (!existing) throw new NotFoundException(`Situation not found: ${id}`);
    const to = parsed.data.to as SituationStatus;
    const allowed = SITUATION_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictException(
        `Illegal transition: ${existing.status} -> ${to}`,
      );
    }
    return this.repository.updateSituationStatus(id, to);
  }

  private async findOr404(id: string): Promise<ProjectRecord> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundException(`Project not found: ${id}`);
    return record;
  }

  /** Financial position: cumulés, retenue, net payé, avancement. Fetches the
   *  project's situations then delegates to the pure rollup (detail path). */
  private async present(record: ProjectRecord) {
    const situations = await this.repository.listSituations(record.id);
    return this.financialPosition(record, situations);
  }

  /** Pure financial rollup from a project + its situations (no I/O) — shared by
   *  the batched portfolio list and the single-project detail view, so the two
   *  paths can never drift. */
  private financialPosition(
    record: ProjectRecord,
    situations: readonly SituationRecord[],
  ) {
    const last = situations[situations.length - 1];
    return {
      ...record,
      situationsCount: situations.length,
      montantCumuleMad: last?.montantCumuleMad ?? 0,
      avancementPct: last?.avancementPct ?? 0,
      retenueCumuleeMad: situations.reduce(
        (sum, s) => sum + s.retenueGarantieMad,
        0,
      ),
    };
  }
}

@Module({
  // Acyclic, one-way imports — no forwardRef. The PROJECT_REPOSITORY token now
  // lives in the leaf ProjectRepositoryModule, so People/Finance no longer need
  // to import ProjectModule for it (that back-edge was the cycle). Here:
  //   - ProjectRepositoryModule: the controller injects PROJECT_REPOSITORY.
  //   - Stock/People/Finance: ProjectCostService injects STOCK_REPOSITORY,
  //     PEOPLE_REPOSITORY and FINANCE_LEDGER_REPOSITORY for the cost rollup.
  // ProjectRepositoryModule is re-exported so existing importers of ProjectModule
  // (field, digest, app) keep resolving PROJECT_REPOSITORY transitively.
  imports: [ProjectRepositoryModule, StockModule, PeopleModule, FinanceModule],
  controllers: [ProjectController],
  providers: [ProjectCostService],
  exports: [ProjectRepositoryModule],
})
export class ProjectModule {}
