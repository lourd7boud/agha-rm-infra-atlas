import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  pipelineStateSchema,
  submissionOutcomeInputSchema,
  tenderInputSchema,
  tenderProcedureSchema,
} from '@atlas/contracts';
import type { AuthenticatedUser } from '../auth/auth.domain';
import { Roles } from '../auth/auth.module';
import { getDb } from '../../db/client';
import { daysUntil } from '../../lib/dates';
import { BrainModule } from '../brain/brain.module';
import { VaultModule } from '../vault/vault.module';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import { IntelModule } from '../intel/intel.module';
import { buildComplianceChecklist } from './compliance.domain';
import { DossierService } from './dossier.service';
import { DossierExtractionService } from './dossier-extraction.service';
import { EnrichmentService } from './enrichment.service';
import { TenderChatService } from './tender-chat.service';
import { TenderListsService } from './tender-lists.service';
import { TenderAssistantService } from './tender-assistant.service';

const assistantBodySchema = z.object({
  question: z.string().trim().min(1).max(500),
});

const listBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  visibility: z.enum(['private', 'shared']).default('private'),
});
const addTenderBodySchema = z.object({
  tenderId: z.string().uuid(),
});
const savedSearchBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: z.unknown(),
  visibility: z.enum(['private', 'shared']).default('private'),
});

const chatBodySchema = z.object({
  question: z.string().trim().min(1).max(1500),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional(),
});
import { buildInventory } from './inventory.domain';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';

const lifecycleStatusSchema = z.enum([
  'en_cours',
  'cloture',
  'attribue',
  'infructueux',
]);
import { nextActions } from './orchestrator.domain';
import { PricingService } from './pricing.service';
import { QualifierService } from './qualifier.service';
import { buildBackPlan, canTransition } from './tender.domain';
import {
  DrizzleTenderRepository,
  DuplicateTenderError,
  InMemoryTenderRepository,
  TENDER_REPOSITORY,
  type TenderRecord,
  type TenderRepository,
} from './tender.repository';
import {
  deriveOutcome,
  pipelineStateForResult,
  recoveredRebatePct,
} from './outcome.domain';
import {
  DrizzleEventRepository,
  DrizzleOutcomeRepository,
  InMemoryEventRepository,
  InMemoryOutcomeRepository,
  OUTCOME_REPOSITORY,
  TENDER_EVENT_REPOSITORY,
  type EventRepository,
  type OutcomeRecord,
  type OutcomeRepository,
} from './ledger.repository';
import {
  buildBuyerProfile,
  buildBuyerProfiles,
} from './buyer-observatory.domain';

const transitionBodySchema = z.object({ to: pipelineStateSchema });
const inventoryQuerySchema = z.object({
  procedure: tenderProcedureSchema.optional(),
  buyer: z.string().max(200).optional(),
  region: z.string().max(100).optional(),
  state: pipelineStateSchema.optional(),
  lifecycle: lifecycleStatusSchema.optional(),
  q: z.string().max(200).optional(),
  /** Delta cutoff for live silent refresh — only rows updated after this instant
   *  are returned (facets/total stay catalogue-wide). Accepts an ISO timestamp. */
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(5000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
const enrichBodySchema = z.object({
  text: z
    .string()
    .min(20, 'Texte trop court pour une extraction')
    .max(50_000, 'Texte trop long (50 000 caractères max)'),
});
const enrichBatchBodySchema = z.object({
  // Cost-bounded: one batch fans out up to `limit` LLM calls. A higher volume
  // is achieved by re-running (each run skips already-enriched tenders).
  limit: z.coerce.number().int().positive().max(200).default(100),
  onlyActive: z.boolean().default(true),
});

const extractDossierBatchBodySchema = z.object({
  // Each item downloads a ~MB dossier + an LLM call — keep the per-request fan
  // bounded; re-run to cover more (already-extracted tenders are skipped).
  limit: z.coerce.number().int().positive().max(100).default(25),
  onlyActive: z.boolean().default(true),
  force: z.boolean().default(false),
});

function present(record: TenderRecord) {
  return { ...record, daysLeft: daysUntil(record.deadlineAt, new Date()) };
}

interface RequestWithUser {
  user?: AuthenticatedUser;
}

function presentOutcome(outcome: OutcomeRecord, estimationMad?: number) {
  return {
    ...outcome,
    recoveredRebatePct: recoveredRebatePct(estimationMad, outcome.winnerAmountMad),
  };
}

@Controller('tender')
export class TenderController {
  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
    @Inject(QualifierService) private readonly qualifier: QualifierService,
    @Inject(EnrichmentService) private readonly enrichment: EnrichmentService,
    @Inject(DossierService) private readonly dossierService: DossierService,
    @Inject(DossierExtractionService)
    private readonly dossierExtraction: DossierExtractionService,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
    @Inject(TenderChatService) private readonly chat: TenderChatService,
    @Inject(TenderListsService) private readonly lists: TenderListsService,
    @Inject(TenderAssistantService) private readonly assistant: TenderAssistantService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
    @Inject(OUTCOME_REPOSITORY) private readonly outcomes: OutcomeRepository,
    @Inject(TENDER_EVENT_REPOSITORY) private readonly events: EventRepository,
  ) {}

  /** Financial Modeler (B4): G2 pricing scenarios grounded in C1 intel. */
  @Roles('marches', 'direction')
  @Post('tenders/:id/scenarios')
  async scenarios(@Param('id') id: string) {
    return this.pricing.generateScenarios(id);
  }

  /** Compliance Officer (B1): administrative checklist for this tender. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/checklist')
  async checklist(@Param('id') id: string) {
    const record = await this.findOr404(id);
    const documents = await this.vault.findAll();
    return buildComplianceChecklist(record, documents, new Date());
  }

  /** Extractor (A2) over avis/DCE text → fill missing fields → re-qualify. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('tenders/:id/enrich')
  async enrich(@Param('id') id: string, @Body() body: unknown) {
    const parsed = enrichBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.enrichment.enrichFromText(id, parsed.data.text);
  }

  /** Strategist (A4): G1 Go/No-Go brief on the T3 model, persisted. */
  @Roles('marches', 'direction')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('tenders/:id/brief')
  async brief(@Param('id') id: string) {
    return this.enrichment.generateG1Brief(id);
  }

  /** Bid Writer (B2): note méthodologique skeleton on T2, after GO. */
  @Roles('marches', 'direction')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('tenders/:id/bid-draft')
  async bidDraft(@Param('id') id: string) {
    return this.enrichment.generateBidDraftFor(id);
  }

  /** Risk Assessor (C3): structured risk matrix on T2. */
  @Roles('marches', 'direction')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('tenders/:id/risks')
  async risks(@Param('id') id: string) {
    return this.enrichment.generateRiskAssessmentFor(id);
  }

  /** Estimator (B3): détail estimatif skeleton on T2 — structure only. */
  @Roles('marches', 'direction')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('tenders/:id/estimate')
  async estimate(@Param('id') id: string) {
    return this.enrichment.generateEstimateSkeletonFor(id);
  }

  /** AI enrichment (fast model): secteur/résumé/FAQ/lots for one tender. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('tenders/:id/ai-enrich')
  async aiEnrich(@Param('id') id: string) {
    return this.enrichment.aiEnrichTender(id);
  }

  /** Bulk AI enrichment of the active catalogue (datao-style fill). */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @Post('enrich-batch')
  async enrichBatch(@Body() body: unknown) {
    const parsed = enrichBatchBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.enrichment.aiEnrichBatch(parsed.data.limit, {
      onlyActive: parsed.data.onlyActive,
    });
  }

  /** DCE dossier: downloads the full ZIP from the portal on first call, then
   *  serves it from MinIO. Returns a short-lived presigned URL. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('tenders/:id/dossier')
  async dossier(@Param('id') id: string) {
    return this.dossierService.ensureDossier(id);
  }

  /** Lists every file inside the cached DCE — powers the left rail of the
   *  "Voir le fichier source" overlay (mirrors datao's split-pane preview). */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('tenders/:id/files')
  async dossierFilesList(
    @Param('id') id: string,
  ): Promise<{ files: Awaited<ReturnType<DossierService['listDossierFiles']>> }> {
    const files = await this.dossierService.listDossierFiles(id);
    return { files };
  }

  /** "Voir le fichier source" — extracts ONE file from the cached DCE ZIP and
   *  returns it base64-encoded (Bordereau.xlsx behind the BPU, CPS pdf…). The
   *  web BFF decodes + streams binary with the right Content-Type so the
   *  browser opens or downloads as expected. Lookup accepts either bare leaf
   *  ("Bordereau.xlsx") or full ZIP path. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('tenders/:id/dossier/file')
  async dossierFile(
    @Param('id') id: string,
    @Query('name') name: string,
  ): Promise<{ filename: string; mime: string; bytesBase64: string }> {
    if (!name) throw new BadRequestException('Paramètre "name" requis');
    const file = await this.dossierService.getDossierFile(id, name);
    return {
      filename: file.filename,
      mime: file.mime,
      bytesBase64: file.bytes.toString('base64'),
    };
  }

  /** Extracts the REAL budget/caution/qualifications/BPU from the DCE dossier. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('tenders/:id/extract-dossier')
  async extractDossier(@Param('id') id: string) {
    return this.dossierExtraction.extractTender(id);
  }

  /** Per-tender AI chat (datao "agent IA va parcourir le dossier"). Stateless:
   *  the client sends the bounded history each turn. */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('tenders/:id/chat')
  async chatOnTender(@Param('id') id: string, @Body() body: unknown) {
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.chat.ask(id, parsed.data.question, parsed.data.history ?? []);
  }

  /** Assistant IA — natural-language search → {filters, narrative, matches}. */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('assistant')
  async assistantAsk(@Body() body: unknown) {
    const parsed = assistantBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.assistant.ask(parsed.data.question);
  }

  // ────────────────── Listes (tender folders) ──────────────────

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('lists')
  async listLists(@Req() req: RequestWithUser) {
    return this.lists.listVisibleLists(req.user!.sub);
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Post('lists')
  async createList(@Req() req: RequestWithUser, @Body() body: unknown) {
    const parsed = listBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.lists.createList(req.user!.sub, parsed.data.name, parsed.data.visibility);
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Delete('lists/:id')
  async deleteList(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.lists.deleteList(req.user!.sub, id);
    return { deleted: true };
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('lists/:id/tenders')
  async listMembers(@Req() req: RequestWithUser, @Param('id') id: string) {
    return { tenderIds: await this.lists.listTenderIds(req.user!.sub, id) };
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Post('lists/:id/tenders')
  async addToList(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = addTenderBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.lists.addTenderToList(req.user!.sub, id, parsed.data.tenderId);
    return { added: true };
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Delete('lists/:id/tenders/:tenderId')
  async removeFromList(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tenderId') tenderId: string,
  ) {
    await this.lists.removeTenderFromList(req.user!.sub, id, tenderId);
    return { removed: true };
  }

  // ────────────── Recherches sauvegardées ──────────────

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('saved-searches')
  async listSearches(@Req() req: RequestWithUser) {
    return this.lists.listSavedSearches(req.user!.sub);
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Post('saved-searches')
  async createSearch(@Req() req: RequestWithUser, @Body() body: unknown) {
    const parsed = savedSearchBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.lists.createSavedSearch(
      req.user!.sub,
      parsed.data.name,
      parsed.data.filters,
      parsed.data.visibility,
    );
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Delete('saved-searches/:id')
  async deleteSearch(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.lists.deleteSavedSearch(req.user!.sub, id);
    return { deleted: true };
  }

  /** Bulk dossier extraction over the active catalogue (datao-grade fill). */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('extract-dossier-batch')
  async extractDossierBatch(@Body() body: unknown) {
    const parsed = extractDossierBatchBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.dossierExtraction.extractBatch(parsed.data.limit, {
      onlyActive: parsed.data.onlyActive,
      force: parsed.data.force,
    });
  }

  /** Run the Qualifier (A3) over all detected/parsed tenders. */
  @Roles('marches', 'direction', 'admin-si')
  @Post('tenders/qualify')
  async qualifyAll() {
    return this.qualifier.runOnce();
  }

  /** Register a detected tender (Sentinel agent or manual entry). */
  @Roles('marches', 'direction', 'admin-si')
  @Post('tenders')
  async create(@Body() body: unknown) {
    const parsed = tenderInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const created = await this.repository.create(parsed.data);
      return present(created);
    } catch (error) {
      if (error instanceof DuplicateTenderError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /** Chef d'Orchestre: the next concrete step for every active tender. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('orchestrator')
  async orchestrator() {
    const now = new Date();
    const [records, documents] = await Promise.all([
      this.repository.findAll(),
      this.vault.findAll(),
    ]);
    return records
      .map((record) => {
        const checklist = buildComplianceChecklist(record, documents, now);
        return {
          tenderId: record.id,
          reference: record.reference,
          etat: record.pipelineState,
          daysLeft: daysUntil(record.deadlineAt, now),
          actions: nextActions(
            { ...record, checklistReady: checklist.ready },
            now,
          ),
        };
      })
      .filter((entry) => entry.actions.length > 0)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /** Deadline wall: every tender ordered by urgency. */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('tenders')
  async list() {
    const records = await this.repository.findAll();
    return [...records]
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime())
      .map(present);
  }

  /**
   * Inventory (جرد): faceted catalogue of every detected tender — counts by
   * procedure, buyer (jhat) and region — plus the filtered result rows.
   */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('inventory')
  async inventory(@Query() query: unknown) {
    const parsed = inventoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { limit, offset, ...filters } = parsed.data;
    // One scan of competitor_bid joined to every tender by canonical reference
    // — powers the lifecycle status (en_cours / cloture / attribue / infructueux)
    // and the "Résultat de l'appel d'offre" surface in the drawer.
    const [records, bids] = await Promise.all([
      this.repository.findAll(),
      this.intel.listAllBids(),
    ]);
    return buildInventory(records, filters, new Date(), { limit, offset }, bids);
  }

  /** Buyer Observatory: aggregated demand-side profile of every acheteur. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('buyers')
  async buyers() {
    const records = await this.repository.findAll();
    return buildBuyerProfiles(records);
  }

  /** One buyer's profile (exact name, URL-encoded). */
  @Roles('marches', 'direction', 'admin-si')
  @Get('buyers/:name')
  async buyer(@Param('name') name: string) {
    const records = await this.repository.findAll();
    const profile = buildBuyerProfile(records, name);
    if (!profile) throw new NotFoundException(`Buyer not found: ${name}`);
    return profile;
  }

  /** Full dossier (incl. G1 brief) — restricted to the decision circle. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id')
  async detail(@Param('id') id: string) {
    const record = await this.findOr404(id);
    return {
      ...present(record),
      plan: buildBackPlan(record.deadlineAt, new Date()),
    };
  }

  /** J-X preparation back-plan for one tender (orchestrator view). */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/plan')
  async plan(@Param('id') id: string) {
    const record = await this.findOr404(id);
    return {
      tenderId: record.id,
      reference: record.reference,
      ...buildBackPlan(record.deadlineAt, new Date()),
    };
  }

  /** Pipeline gate transition (G0–G3 actions land here). */
  @Roles('direction', 'marches')
  @Post('tenders/:id/transition')
  async transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser,
  ) {
    const parsed = transitionBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);
    if (!canTransition(record.pipelineState, parsed.data.to)) {
      throw new ConflictException(
        `Illegal transition: ${record.pipelineState} -> ${parsed.data.to}`,
      );
    }
    const updated = await this.repository.updateState(id, parsed.data.to);
    if (!updated) throw new NotFoundException(`Tender not found: ${id}`);
    // Append-only history — every transition becomes a queryable event.
    await this.events.append({
      tenderId: id,
      fromState: record.pipelineState,
      toState: parsed.data.to,
      actor: request.user?.username ?? 'dev-mode',
      reason: 'transition',
    });
    return present(updated);
  }

  /**
   * Record the real outcome of OUR bid — Phase 0 "saisir_resultat" made real.
   * Persists the reward signal, lands the tender in its terminal state, and
   * appends the event. This is the data every learning loop depends on.
   */
  @Roles('marches', 'direction')
  @Post('tenders/:id/outcome')
  async recordOutcome(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser,
  ) {
    const parsed = submissionOutcomeInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const record = await this.findOr404(id);

    const now = new Date();
    const derived = deriveOutcome(parsed.data, now);
    const outcome = await this.outcomes.record({ tenderId: id, ...derived });

    const toState = pipelineStateForResult(derived.result);
    if (record.pipelineState !== toState) {
      await this.repository.updateState(id, toState);
      await this.events.append({
        tenderId: id,
        fromState: record.pipelineState,
        toState,
        actor: request.user?.username ?? 'dev-mode',
        reason: `outcome:${derived.result}`,
      });
    }
    return presentOutcome(outcome, record.estimationMad);
  }

  /** The recorded outcome (with the recovered-rebate metric), if any. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/outcome')
  async outcome(@Param('id') id: string) {
    const record = await this.findOr404(id);
    const found = await this.outcomes.findByTender(id);
    return found ? presentOutcome(found, record.estimationMad) : null;
  }

  /** The append-only transition history of one tender. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/events')
  async listEvents(@Param('id') id: string) {
    await this.findOr404(id);
    return this.events.listByTender(id);
  }

  private async findOr404(id: string): Promise<TenderRecord> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundException(`Tender not found: ${id}`);
    return record;
  }
}

const tenderRepositoryProvider = {
  provide: TENDER_REPOSITORY,
  useFactory: (): TenderRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleTenderRepository(getDb(url));
    new Logger('TenderModule').warn(
      'DATABASE_URL not set — tender uses a non-persistent in-memory repository',
    );
    return new InMemoryTenderRepository();
  },
};

const outcomeRepositoryProvider = {
  provide: OUTCOME_REPOSITORY,
  useFactory: (): OutcomeRepository => {
    const url = process.env.DATABASE_URL;
    return url
      ? new DrizzleOutcomeRepository(getDb(url))
      : new InMemoryOutcomeRepository();
  },
};

const eventRepositoryProvider = {
  provide: TENDER_EVENT_REPOSITORY,
  useFactory: (): EventRepository => {
    const url = process.env.DATABASE_URL;
    return url
      ? new DrizzleEventRepository(getDb(url))
      : new InMemoryEventRepository();
  },
};

// Listes + Recherches sauvegardées — DB-backed only (no in-memory fallback;
// nothing to organize without a real DB).
const tenderListsServiceProvider = {
  provide: TenderListsService,
  useFactory: (): TenderListsService => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      new Logger('TenderModule').warn(
        'DATABASE_URL not set — Listes + Recherches sauvegardées disabled',
      );
      // Throws on every method call until the DB is configured — better than
      // silently dropping user data into an in-memory store.
      return new TenderListsService(null as unknown as ReturnType<typeof getDb>);
    }
    return new TenderListsService(getDb(url));
  },
};

@Module({
  imports: [BrainModule, IntelModule, VaultModule],
  controllers: [TenderController],
  providers: [
    tenderRepositoryProvider,
    outcomeRepositoryProvider,
    eventRepositoryProvider,
    tenderListsServiceProvider,
    QualifierService,
    EnrichmentService,
    DossierService,
    DossierExtractionService,
    TenderChatService,
    TenderAssistantService,
    PricingService,
  ],
  // EnrichmentService + DossierExtractionService are exported so the Sentinel
  // (watch module) can chain a bounded enrich+extract after each crawl — making
  // every newly-detected consultation analysed automatically.
  exports: [tenderRepositoryProvider, EnrichmentService, DossierExtractionService],
})
export class TenderModule {}
