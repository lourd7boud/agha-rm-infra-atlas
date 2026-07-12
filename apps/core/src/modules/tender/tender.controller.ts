import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
/** Minimal SSE-write surface needed for the streaming chat route — kept inline
 *  to avoid pulling @types/express into the @atlas/core dependencies. Matches
 *  the Express Response shape that NestJS injects via @Res(). */
interface SseResponse {
  setHeader(name: string, value: string): void;
  flushHeaders?(): void;
  write(chunk: string): boolean;
  end(): void;
}
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  pipelineStateSchema,
  submissionOutcomeInputSchema,
  tenderInputSchema,
  tenderProcedureSchema,
} from '@atlas/contracts';
import { Roles } from '../auth/auth.module';
import type { RequestWithUser } from './tender-http';
import { daysUntil } from '../../lib/dates';
import { TtlCache } from '../../lib/ttl-cache';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import {
  LiveParticipantsCrawlerService,
  parsePmmpRefs,
} from '../portal/live-participants.crawler';
import { buildComplianceChecklist } from './compliance.domain';
import { buildTenderCompetitorIntel } from './competitor-intel.domain';
import { DossierService } from './dossier.service';
import { DossierExtractionService } from './dossier-extraction.service';
import { EnrichmentService } from './enrichment.service';
import { TenderChatService } from './tender-chat.service';
import { TenderAssistantService } from './tender-assistant.service';

const assistantBodySchema = z.object({
  question: z.string().trim().min(1).max(500),
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
import {
  type Inventory,
  type InventoryFilters,
} from './inventory.domain';
import { readPortalDetail } from './portal-detail';
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
  DuplicateTenderError,
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

/** Parses a comma-separated multi-select param into a trimmed, non-empty
 *  string[]. Accepts a single value or repeated values (which zod coerces to an
 *  array); commas split each entry so `?procedures=AOO,concours` and
 *  `?procedures=AOO&procedures=concours` both yield ['AOO','concours']. Returns
 *  undefined when nothing usable remains (treated as "no constraint"). */
const csvParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): string[] | undefined => {
    if (value === undefined) return undefined;
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts : undefined;
  });

/** Parses a boolean flag from the 'true'/'false' string a query string carries. */
const boolParam = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

const inventorySortSchema = z
  .enum(['publication', 'deadline', 'estimation', 'buyer', 'daysLeft'])
  .default('publication');
const inventoryDirSchema = z.enum(['asc', 'desc']).default('desc');

const inventoryQuerySchema = z.object({
  // ── Existing single-value params (SSR/preload + ?since= delta rely on them). ──
  procedure: tenderProcedureSchema.optional(),
  buyer: z.string().max(200).optional(),
  region: z.string().max(100).optional(),
  state: pipelineStateSchema.optional(),
  lifecycle: lifecycleStatusSchema.optional(),
  q: z.string().max(200).optional(),
  /** Delta cutoff for live silent refresh — only rows updated after this instant
   *  are returned (facets/total stay catalogue-wide). Accepts an ISO timestamp. */
  since: z.coerce.date().optional(),
  // ── New multi-select params (comma-separated), merged with the single ones. ──
  procedures: csvParam,
  categories: csvParam,
  secteurs: csvParam,
  regions: csvParam,
  buyers: csvParam,
  states: csvParam,
  lifecycles: csvParam,
  // ── New boolean toggles ('true'/'false'). ──
  bpuOnly: boolParam,
  budgetOnly: boolParam,
  cautionOnly: boolParam,
  // ── Server-side sort. ──
  sort: inventorySortSchema,
  dir: inventoryDirSchema,
  // Page defaults to 24 rows (one datao-style page); 100 hard ceiling.
  limit: z.coerce.number().int().positive().max(100).default(24),
  offset: z.coerce.number().int().nonnegative().default(0),
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

// Level-2 datao-parity: hot handlers coalesced through a 30 s TTL cache.
// The home page fans out 8 SSR calls in parallel; the orchestrator + the shared
// inventory facets are the heaviest whole-catalogue reads. Under Sentinel load
// their p99 climbed past nginx's 60 s default and produced the 504 the operator
// saw. A 30 s stale window is invisible to human users (Sentinel breather is 5 s,
// dossier extraction takes hours) and drops them to sub-ms on the warm path.
const INVENTORY_CACHE_TTL_MS = 30_000;
const ORCHESTRATOR_CACHE_TTL_MS = 30_000;
// Split inventory caches (P2 scalable read). The whole-catalogue facets + total are
// filter-INDEPENDENT (they describe the catalogue, not the query), so they are
// computed ONCE per window under a single shared key and reused across EVERY
// filter/sort/page key AND the ?since= poll — instead of recomputing 6 GROUP BYs +
// a whole-catalogue lifecycle scan on every distinct request. Only the O(page)
// filtered page varies per key, so browsing filters/pages costs one indexed page
// query, never a fresh catalogue-wide facet fan-out.
type InventoryFacetsResult = Pick<Inventory, 'total' | 'facets'>;
type InventoryPageResult = Pick<
  Inventory,
  'filteredCount' | 'returnedCount' | 'items' | 'filters'
>;
const inventoryFacetsCache = new TtlCache<InventoryFacetsResult>();
const inventoryPageCache = new TtlCache<InventoryPageResult>();
const orchestratorCache = new TtlCache<unknown>();
// Live-participants cache: 60 s is the sweet spot between UX freshness
// (operator retries after adding a caution → sees the +1 within a minute)
// and portal politeness (30 clicks × 60 s throttle would still be one hit).
const LIVE_PARTICIPANTS_CACHE_TTL_MS = 60_000;
const liveParticipantsCache = new TtlCache<unknown>();
// Competitor intel reads the full competitor_bid scan; cache 60 s so a burst
// of drawer opens collapses to one scan. Keyed by tenderId.
const COMPETITOR_INTEL_CACHE_TTL_MS = 60_000;
const competitorIntelCache = new TtlCache<unknown>();
// The ?since= delta poll's PAGE must read fresher than the 30 s window; a 2 s
// single-flighted cache coalesces concurrent pollers (every open tab) into one tiny
// `updated_at > since` page query. Facets/total are shared from the 30 s cache — a
// <30 s trailing count is invisible next to the row merge the client actually applies.
const FRESH_SINCE_CACHE_TTL_MS = 2_000;
const freshSincePageCache = new TtlCache<InventoryPageResult>();

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
    @Inject(TenderAssistantService) private readonly assistant: TenderAssistantService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
    @Inject(OUTCOME_REPOSITORY) private readonly outcomes: OutcomeRepository,
    @Inject(TENDER_EVENT_REPOSITORY) private readonly events: EventRepository,
    @Inject(LiveParticipantsCrawlerService)
    private readonly liveParticipants: LiveParticipantsCrawlerService,
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

  /** Extracts the REAL budget/caution/qualifications/BPU from the DCE dossier.
   *  deep+force: the deliberate single-tender "Extraire le DCE" click (never the
   *  97k batch sweep). `force` re-runs even when a prior BPU-empty extraction is
   *  cached (else the cache short-circuit returns the stale empty result); `deep`
   *  runs the vision OCR supplement when the BPU is still empty and no XLSX
   *  bordereau exists — e.g. a bordereau embedded in a SCANNED CPS.pdf. Safe:
   *  mergeExtractions() lets a re-run only improve, never regress. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('tenders/:id/extract-dossier')
  async extractDossier(@Param('id') id: string) {
    return this.dossierExtraction.extractTender(id, { deep: true, force: true });
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

  /** Streaming variant — datao-grade token-by-token UX. Same body schema as
   *  /chat. Returns text/event-stream with `data: {type:'delta'|'finish'}` plus
   *  a closing `data: [DONE]`. Pre-flight pattern: pull the first event before
   *  flushing headers, so validation/NotFound/ServiceUnavailable still surface
   *  as clean HTTP error codes instead of mid-stream noise.
   *  Web BFF proxy: apps/web/src/app/api/tenders/[id]/chat/stream/route.ts */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('tenders/:id/chat/stream')
  async chatStreamOnTender(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: SseResponse,
  ): Promise<void> {
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const gen = this.chat.streamAsk(id, parsed.data.question, parsed.data.history ?? []);
    // Pre-flight: any throw here propagates as HTTP (NestJS exception filter).
    const first = await gen.next();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx — don't buffer SSE
    res.flushHeaders?.();

    try {
      if (!first.done && first.value) {
        res.write(`data: ${JSON.stringify(first.value)}\n\n`);
      }
      if (!first.done) {
        for (let step = await gen.next(); !step.done; step = await gen.next()) {
          res.write(`data: ${JSON.stringify(step.value)}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (error) {
      const msg = (error as Error).message;
      res.write(
        `data: ${JSON.stringify({ type: 'error', errorText: msg })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
    } finally {
      res.end();
    }
  }

  /**
   * Datao-parity dual-lane FTS search. Runs `websearch_to_tsquery('french', q)`
   * against the trigger-maintained `fts_search` and `fts_bdp_search` columns
   * (migration 0027_tender_dual_fts.sql). Every hit is enriched with the
   * calling tender's headline fields + `hitBdp` so the frontend can badge
   * bordereau-only matches ("Trouvé dans le BPU"), the search dimension ATLAS
   * previously lacked and datao's users rely on.
   */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('tenders/search')
  async searchTenders(
    @Query('q') q: string,
    @Query('limit') limitRaw?: string,
  ) {
    const query = typeof q === 'string' ? q.trim() : '';
    if (query.length < 2) return { query, hits: [] };
    const limit = Math.min(50, Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20));
    const idHits = await this.repository.searchIdsByFts(query, limit);
    if (idHits.length === 0) return { query, hits: [] };

    // One batched SELECT (no N+1), then re-ordered by FTS rank since the
    // db returns rows in arbitrary order.
    const records = await this.repository.findByIds(idHits.map((h) => h.id));
    const recordById = new Map(records.map((r) => [r.id, r] as const));
    const hits = idHits.flatMap((match) => {
      const r = recordById.get(match.id);
      if (!r) {
        // FTS index knew an id the table no longer has (row deleted between
        // the two queries) — dropped from results, but never silently.
        new Logger('TenderModule').warn(
          `searchTenders: FTS hit ${match.id} missing from batch lookup`,
        );
        return [];
      }
      return [
        {
          id: r.id,
          reference: r.reference,
          objet: r.objet,
          buyerName: r.buyerName,
          deadlineAt: r.deadlineAt,
          hitBdp: match.hitBdp,
          rank: match.rank,
        },
      ];
    });
    return { query, hits };
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
    return orchestratorCache.getOrCompute('all', ORCHESTRATOR_CACHE_TTL_MS, async () => {
      const now = new Date();
      // Projected read (findForOrchestrator): terminal tenders are excluded in SQL
      // and the heavy `raw` never ships — only a presence-probe for g1Brief/
      // g2Scenarios/bidDraft + the small `extraction` sub-object are reconstructed
      // here so buildComplianceChecklist + nextActions see exactly what they read.
      const [rows, documents] = await Promise.all([
        this.repository.findForOrchestrator(),
        this.vault.findAll(),
      ]);
      return rows
        .map((row) => {
          const raw: Record<string, unknown> = {
            ...(row.hasG1Brief ? { g1Brief: true } : {}),
            ...(row.hasG2Scenarios ? { g2Scenarios: true } : {}),
            ...(row.hasBidDraft ? { bidDraft: true } : {}),
            ...(row.extraction != null ? { extraction: row.extraction } : {}),
          };
          const checklist = buildComplianceChecklist(
            {
              reference: row.reference,
              ...(row.cautionProvisoireMad !== undefined
                ? { cautionProvisoireMad: row.cautionProvisoireMad }
                : {}),
              raw,
            },
            documents,
            now,
          );
          return {
            tenderId: row.id,
            reference: row.reference,
            etat: row.pipelineState,
            daysLeft: daysUntil(row.deadlineAt, now),
            actions: nextActions(
              {
                pipelineState: row.pipelineState,
                ...(row.estimationMad !== undefined
                  ? { estimationMad: row.estimationMad }
                  : {}),
                deadlineAt: row.deadlineAt,
                raw,
                checklistReady: checklist.ready,
              },
              now,
            ),
          };
        })
        .filter((entry) => entry.actions.length > 0)
        .sort((a, b) => a.daysLeft - b.daysLeft);
    });
  }

  /** Deadline wall: every tender ordered by urgency. */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('tenders')
  async list() {
    // Lean projection ONLY — findAllInventoryRows() omits the heavy `raw`/`detail`
    // jsonb, so Postgres never detoasts the whole ~97k-row catalogue for this read.
    // The old findAll() shipped every toasted blob and folding that into JS
    // OOM-crashed the 792 MB core (same class as the Assistant IA endpoint bug).
    // The deadline wall needs only the base columns + daysLeft, ordered by urgency.
    const now = new Date();
    const rows = await this.repository.findAllInventoryRows();
    return [...rows]
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime())
      .map((row) => ({ ...row, daysLeft: daysUntil(row.deadlineAt, now) }));
  }

  /**
   * Inventory (جرد): faceted catalogue of every detected tender — counts by
   * procedure, buyer (jhat) and region — plus the filtered result rows.
   */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('inventory')
  async inventory(@Query() query: unknown): Promise<Inventory> {
    const parsed = inventoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { limit, offset, ...filters } = parsed.data;
    const now = new Date();

    // Whole-catalogue facets + total are filter-INDEPENDENT, so compute them ONCE
    // per window (shared 30 s cache) and reuse across every filter/sort/page key AND
    // the ?since= poll. Stage 2: the lifecycle facet is a SQL FILTER-count over the
    // denormalized result columns (deadline_at + result_state) — no competitor_bid
    // data is loaded here at all, so per-request cost stays O(page) as data grows.
    const facetsPromise = this.loadInventoryFacets(now);

    const key = JSON.stringify({ ...filters, limit, offset });
    // The ?since= delta powers live silent refresh: its page rides a 2 s single-flight
    // cache (coalescing concurrent pollers into one tiny `updated_at > :since` query);
    // a normal page rides the 30 s window. Either way the page is O(page) — one indexed
    // WHERE…ORDER BY…LIMIT/OFFSET + one count — for EVERY lifecycle tab too (Stage 2
    // made them pure column predicates, so there is no heavy JS fold to shield anymore).
    const useFreshSince = filters.since !== undefined;
    const pageCache = useFreshSince ? freshSincePageCache : inventoryPageCache;
    const pageTtl = useFreshSince ? FRESH_SINCE_CACHE_TTL_MS : INVENTORY_CACHE_TTL_MS;
    const pagePromise = pageCache.getOrCompute(key, pageTtl, () =>
      this.repository.findInventoryPageRows(filters, { limit, offset }, now, []),
    );

    const [{ total, facets }, page] = await Promise.all([facetsPromise, pagePromise]);
    return { ...page, total, facets };
  }

  /** Buyer Observatory: aggregated demand-side profile of every acheteur. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('buyers')
  async buyers() {
    // Base-column projection (NO raw jsonb, NO competitor_bid): the observatory reads
    // only buyerName/objet/procedure/estimation/deadline/state, so it must never
    // detoast the whole raw catalogue or load the 550k-row bid table (the old
    // loadInventoryLight did both). findBuyerObservationRows is a light seq-scan.
    const rows = await this.repository.findBuyerObservationRows();
    return buildBuyerProfiles(rows);
  }

  /** One buyer's profile (exact name, URL-encoded). */
  @Roles('marches', 'direction', 'admin-si')
  @Get('buyers/:name')
  async buyer(@Param('name') name: string) {
    const rows = await this.repository.findBuyerObservationRows();
    const profile = buildBuyerProfile(rows, name);
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
      // Portal-first "fiche du portail" — the published detail block harvested
      // into raw.detail, typed for the drawer (rendered with a "Portail" badge).
      portalDetail: readPortalDetail(record.raw) ?? undefined,
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

  /**
   * Live PMMP intelligence — the feature datao does not have. On any open
   * consultation, hit the portal AUTHENTICATED (AGHID CONSTRUCTION session)
   * and return the four public counters PMMP hides from anonymous callers:
   *   - retraits (companies that pulled the DCE — the "how many competitors")
   *   - questions (public Q&A posted by other bidders — with buyer's answers)
   *   - cautions (companies that filed a caution provisoire — SERIOUS bidders)
   *   - messagerie (secured messages exchanged)
   * plus the portal's current deadline (used to detect extensions vs our DB).
   *
   * Cached 60 s server-side so a stampede of clicks stays polite to PMMP.
   * Returns 503 with an operator hint when PORTAL_AUTH_LOGIN/PASSWORD are
   * missing — the UI reads that to render a "configure PMMP account" state.
   */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('tenders/:id/live-participants')
  async liveParticipantsForTender(@Param('id') id: string) {
    const tender = await this.findOr404(id);
    if (!tender.sourceUrl) {
      throw new BadRequestException(
        "Cette consultation n'a pas d'URL PMMP — impossible de lancer le live.",
      );
    }
    const refs = parsePmmpRefs(tender.sourceUrl);
    if (!refs) {
      throw new BadRequestException("URL PMMP invalide sur cette consultation.");
    }
    const cacheKey = `${refs.refConsultation}/${refs.orgAcronyme}`;
    return liveParticipantsCache.getOrCompute(
      cacheKey,
      LIVE_PARTICIPANTS_CACHE_TTL_MS,
      () => this.liveParticipants.fetch(refs.refConsultation, refs.orgAcronyme),
    );
  }

  /**
   * Competitor Intelligence — the datao-beating surface. Reads the harvested
   * PV/result history (intel.competitor_bid) and returns, for THIS tender:
   *   - CLOSED (result harvested): the REAL participants + amounts + winner,
   *     same-day from the PV notice — ahead of datao's daily snapshot.
   *   - OPEN (no result yet): PREDICTIVE intel from this buyer's history —
   *     the firms that most often bid this buyer, their win counts, and the
   *     typical winning-rebate level. Real data, honestly framed as historique.
   * Cached 60 s (keyed by tenderId) so a burst of drawer opens is one scan.
   */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('tenders/:id/competitor-intel')
  async competitorIntel(@Param('id') id: string) {
    const tender = await this.findOr404(id);
    return competitorIntelCache.getOrCompute(
      id,
      COMPETITOR_INTEL_CACHE_TTL_MS,
      async () => {
        // Scoped read: only THIS buyer's bids, filtered in Postgres — never the
        // whole 550k-row competitor_bid table (loadCatalogSnapshot's listAllBids,
        // which OOM-crashed the core). The drawer needs one buyer's history, and
        // buildTenderCompetitorIntel re-folds precisely (closed by ref+buyer, open
        // by buyer); findBidsForBuyer returns the correct superset for both.
        const bids = await this.intel.findBidsForBuyer(tender.buyerName);
        return buildTenderCompetitorIntel(
          {
            reference: tender.reference,
            buyerName: tender.buyerName,
            deadlineAt: tender.deadlineAt,
          },
          bids,
          new Date(),
        );
      },
    );
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

  /** Whole-catalogue facets + total (filter-INDEPENDENT), computed ONCE per 30 s
   *  window under a single shared key and reused across every filter/sort/page key
   *  and the ?since= poll. Stage 2: the lifecycle facet is a SQL FILTER-count over
   *  the denormalized result columns, so this touches ONLY tender.tender (no
   *  competitor_bid) — a handful of indexed aggregates, amortized to once per window.
   *  The `[]` bids arg is vestigial for the Drizzle path (kept for the interface /
   *  the InMemory JS fold). */
  private loadInventoryFacets(now: Date): Promise<InventoryFacetsResult> {
    return inventoryFacetsCache.getOrCompute('facets', INVENTORY_CACHE_TTL_MS, () =>
      this.repository.findInventoryFacets(now, []),
    );
  }
}
