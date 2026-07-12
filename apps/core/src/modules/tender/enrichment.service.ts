import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { generateBidDraft, type DraftOutcome } from '../brain/bidwriter';
import {
  generateEstimateSkeleton,
  type EstimateOutcome,
} from '../brain/estimator';
import { extractAvis, type AvisExtraction } from '../brain/extractor';
import { assessRisks, type RiskOutcome } from '../brain/riskassessor';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import { generateBrief, type BriefOutcome } from '../brain/strategist';
import { AGHA_PROFILE } from './company-profile';
import { qualify } from './qualifier.domain';
import { buildBackPlan } from './tender.domain';
import {
  TENDER_REPOSITORY,
  type TenderRecord,
  type TenderRepository,
} from './tender.repository';
import { buildMarketContext } from './buyer-observatory.domain';
import { aiEnrich, runPool, type AiEnrichment } from './ai-enrichment';
import { PROCEDURE_LABELS, inferCategory } from './inventory.domain';

export interface EnrichmentSummary {
  tenderId: string;
  filled: string[];
  extraction: { ok: boolean; issues?: string[] };
  requalified: boolean;
}

/** Tokenise a snippet for Jaccard comparison — lowercase, accent-fold, strip
 *  punctuation/digits, drop tokens shorter than 4 chars and a small stoplist
 *  of structural filler words. Punctuation needs to die before we tokenise
 *  because "boudnib," and "boudnib" must collapse to the same token. */
const STOPWORDS = new Set([
  'cet', 'cette', 'ces', 'pour', 'avec', 'dans', 'lors', 'leur', 'leurs',
  'appel', 'offres', 'offre', 'marche', 'marches', 'travaux', 'lance', 'lancee',
  'present', 'presente', 'concerne', 'porte', 'sur', 'les', 'des', 'aux',
  'sera', 'sont', 'etre', 'fait', 'faite', 'mise', 'mises', 'place',
  'comprend', 'inclut', 'inclus', 'projet',
]);
function tokenise(text: string): Set<string> {
  const folded = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ');
  const tokens = folded.split(/\s+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return new Set(tokens);
}
function jaccardOverlap(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  // Asymmetric "how much of `b` is mentioned in `a`": the résumé doesn't have
  // to cover every word of the objet+buyer (it's a paraphrase) but it MUST
  // mention enough of them. Pure Jaccard would penalise long résumés unfairly.
  let hits = 0;
  for (const t of tb) if (ta.has(t)) hits += 1;
  return hits / tb.size;
}
/** Minimum fraction of objet+buyer tokens that must appear in the résumé. The
 *  BOUDNIB-vs-CHR-Errachidia false résumé scored 0.05 in dry-runs (basically
 *  zero shared content words); the legitimate matches score ≥ 0.3. */
const MIN_RESUME_OVERLAP = 0.2;

export interface AiEnrichBatchResult {
  candidates: number;
  processed: number;
  succeeded: number;
  failed: number;
  /** IDs of tenders whose enrichment failed this run (visibility for retry). */
  failedIds: string[];
}

/** Concurrent LLM enrichments in flight during a batch — fast but polite. */
const AI_ENRICH_CONCURRENCY = 6;

/**
 * Closes the read→think→act loop: Extractor output updates the tender
 * (published portal data always wins — only missing fields are filled),
 * then the Qualifier re-runs where the state machine allows it.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger('Enrichment');
  /** Single-flight guard: only one bulk enrichment runs at a time (cost bound). */
  private aiBatchRunning = false;

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
  ) {}

  private requireLlm(): LlmClient {
    if (!this.llm) {
      throw new ServiceUnavailableException('LLM non configuré (LLM_API_KEY manquant)');
    }
    return this.llm;
  }

  private async requireTender(id: string): Promise<TenderRecord> {
    const tender = await this.repository.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);
    return tender;
  }

  async enrichFromText(id: string, text: string): Promise<EnrichmentSummary> {
    const llm = this.requireLlm();
    const tender = await this.requireTender(id);

    const outcome = await extractAvis(llm, text);
    if (!outcome.ok || !outcome.data) {
      return {
        tenderId: id,
        filled: [],
        extraction: { ok: false, issues: outcome.issues },
        requalified: false,
      };
    }

    const filled = await this.applyExtraction(tender, outcome.data);
    const requalified = await this.requalify(id);

    this.logger.log(
      `tender.enriched ${tender.reference} (champs: ${filled.join(', ') || 'aucun'})`,
    );
    return { tenderId: id, filled, extraction: { ok: true }, requalified };
  }

  /** Fills only missing fields; stores the full extraction in raw.extraction. */
  private async applyExtraction(
    tender: TenderRecord,
    extraction: AvisExtraction,
  ): Promise<string[]> {
    const filled: string[] = [];
    const update: { estimationMad?: number; cautionProvisoireMad?: number } = {};

    if (tender.estimationMad === undefined && extraction.estimationMad != null) {
      update.estimationMad = extraction.estimationMad;
      filled.push('estimationMad');
    }
    if (
      tender.cautionProvisoireMad === undefined &&
      extraction.cautionProvisoireMad != null
    ) {
      update.cautionProvisoireMad = extraction.cautionProvisoireMad;
      filled.push('cautionProvisoireMad');
    }

    await this.repository.updateEnrichment(tender.id, update, {
      extraction: { ...extraction, extractedAt: new Date().toISOString() },
    });
    return filled;
  }

  /** Re-runs the Qualifier where the state machine allows automation. */
  private async requalify(id: string): Promise<boolean> {
    const tender = await this.requireTender(id);
    if (tender.pipelineState !== 'parsed' && tender.pipelineState !== 'rejected') {
      return false;
    }
    const result = qualify(tender, AGHA_PROFILE, new Date());
    const nextState = result.verdict === 'qualified' ? 'qualified' : 'rejected';
    await this.repository.updateQualification(id, nextState, result);
    return true;
  }

  /** Strategist (A4): generates and persists the G1 Go/No-Go brief. */
  async generateG1Brief(id: string): Promise<BriefOutcome> {
    const llm = this.requireLlm();
    const tender = await this.requireTender(id);
    // Market context so the Strategist stops deciding blind: the ouvrage
    // segment + this buyer's demand profile, derived from observed history.
    // SCALABLE READ: buildMarketContext only needs the lean 6-column observation
    // projection (it is typed for BuyerObservationRow[]), so this rides
    // findBuyerObservationRows() — NOT findAll(), which would detoast every
    // tender's `raw` jsonb (~97k rows) and OOM-crash the 792 MB core per request.
    const observations = await this.repository.findBuyerObservationRows();

    const dossier = {
      fiche: {
        reference: tender.reference,
        acheteur: tender.buyerName,
        procedure: tender.procedure,
        objet: tender.objet,
        estimationMad: tender.estimationMad ?? null,
        cautionProvisoireMad: tender.cautionProvisoireMad ?? null,
        dateLimite: tender.deadlineAt.toISOString(),
        etatPipeline: tender.pipelineState,
      },
      qualificationAutomatique: tender.qualification,
      marcheIntel: buildMarketContext(tender, observations),
      retroPlanning: buildBackPlan(tender.deadlineAt, new Date()),
      profilEntreprise: {
        plafondEstimationMad: AGHA_PROFILE.maxEstimationMad,
        plafondCautionMad: AGHA_PROFILE.maxCautionMad,
        procedures: AGHA_PROFILE.procedures,
        metiers: AGHA_PROFILE.domainKeywords,
      },
      extractionDce:
        (tender.raw as Record<string, unknown> | null)?.['extraction'] ?? null,
    };

    const outcome = await generateBrief(llm, dossier);
    if (outcome.ok && outcome.brief) {
      await this.repository.updateEnrichment(id, {}, {
        g1Brief: {
          ...outcome.brief,
          model: outcome.model,
          generatedAt: new Date().toISOString(),
        },
      });
      this.logger.log(
        `gate.G1.brief ${tender.reference} → ${outcome.brief.recommandation} (confiance ${outcome.brief.confiance})`,
      );
    }
    return outcome;
  }

  /** Shared dossier serialization for the drafting/analysis agents. */
  private buildAgentDossier(tender: TenderRecord): Record<string, unknown> {
    const raw = tender.raw as Record<string, unknown> | null;
    return {
      fiche: {
        reference: tender.reference,
        acheteur: tender.buyerName,
        procedure: tender.procedure,
        objet: tender.objet,
        estimationMad: tender.estimationMad ?? null,
        cautionProvisoireMad: tender.cautionProvisoireMad ?? null,
        dateLimite: tender.deadlineAt.toISOString(),
        etatPipeline: tender.pipelineState,
      },
      profilEntreprise: {
        metiers: AGHA_PROFILE.domainKeywords,
        procedures: AGHA_PROFILE.procedures,
        plafondEstimationMad: AGHA_PROFILE.maxEstimationMad,
        plafondCautionMad: AGHA_PROFILE.maxCautionMad,
      },
      extractionDce: raw?.['extraction'] ?? null,
      noteGoNoGo: raw?.['g1Brief'] ?? null,
      retroPlanning: buildBackPlan(tender.deadlineAt, new Date()),
    };
  }

  /** Risk Assessor (C3): structured risk matrix from qualified onward. */
  async generateRiskAssessmentFor(id: string): Promise<RiskOutcome> {
    const llm = this.requireLlm();
    const tender = await this.requireTender(id);
    const allowed = ['qualified', 'go_decided', 'preparing'];
    if (!allowed.includes(tender.pipelineState)) {
      throw new ConflictException(
        `Analyse des risques après qualification (état actuel: ${tender.pipelineState})`,
      );
    }

    const outcome = await assessRisks(llm, this.buildAgentDossier(tender));
    if (outcome.ok && outcome.assessment) {
      await this.repository.updateEnrichment(id, {}, {
        riskAssessment: {
          ...outcome.assessment,
          model: outcome.model,
          generatedAt: new Date().toISOString(),
        },
      });
      this.logger.log(
        `risk.assessment ${tender.reference} → ${outcome.assessment.niveauGlobal} (${outcome.assessment.risques.length} risques)`,
      );
    }
    return outcome;
  }

  /** Estimator (B3): détail estimatif skeleton — no prices, ever. */
  async generateEstimateSkeletonFor(id: string): Promise<EstimateOutcome> {
    const llm = this.requireLlm();
    const tender = await this.requireTender(id);
    const allowed = ['qualified', 'go_decided', 'preparing'];
    if (!allowed.includes(tender.pipelineState)) {
      throw new ConflictException(
        `Le métré démarre après qualification (état actuel: ${tender.pipelineState})`,
      );
    }

    const outcome = await generateEstimateSkeleton(
      llm,
      this.buildAgentDossier(tender),
    );
    if (outcome.ok && outcome.skeleton) {
      await this.repository.updateEnrichment(id, {}, {
        estimateSkeleton: {
          ...outcome.skeleton,
          model: outcome.model,
          generatedAt: new Date().toISOString(),
        },
      });
      this.logger.log(
        `estimate.skeleton ${tender.reference} → ${outcome.skeleton.postes.length} postes`,
      );
    }
    return outcome;
  }

  /** Bid Writer (B2): note méthodologique skeleton — only after a GO. */
  async generateBidDraftFor(id: string): Promise<DraftOutcome> {
    const llm = this.requireLlm();
    const tender = await this.requireTender(id);
    if (
      tender.pipelineState !== 'go_decided' &&
      tender.pipelineState !== 'preparing'
    ) {
      throw new ConflictException(
        `La rédaction démarre après le GO (état actuel: ${tender.pipelineState})`,
      );
    }

    const raw = tender.raw as Record<string, unknown> | null;
    const dossier = {
      fiche: {
        reference: tender.reference,
        acheteur: tender.buyerName,
        procedure: tender.procedure,
        objet: tender.objet,
        estimationMad: tender.estimationMad ?? null,
        dateLimite: tender.deadlineAt.toISOString(),
      },
      profilEntreprise: {
        metiers: AGHA_PROFILE.domainKeywords,
        procedures: AGHA_PROFILE.procedures,
      },
      extractionDce: raw?.['extraction'] ?? null,
      noteGoNoGo: raw?.['g1Brief'] ?? null,
      retroPlanning: buildBackPlan(tender.deadlineAt, new Date()),
    };

    const outcome = await generateBidDraft(llm, dossier);
    if (outcome.ok && outcome.draft) {
      await this.repository.updateEnrichment(id, {}, {
        bidDraft: {
          ...outcome.draft,
          model: outcome.model,
          generatedAt: new Date().toISOString(),
        },
      });
      this.logger.log(
        `bid.draft ${tender.reference} → ${outcome.draft.sections.length} sections`,
      );
    }
    return outcome;
  }

  /**
   * AI enrichment (fast OpenRouter model): fills the structural/qualitative
   * blanks for one tender — secteur, résumé, FAQ, lots, conditions — from what
   * we already know. No financial figure is ever fabricated.
   */
  async aiEnrichTender(id: string): Promise<AiEnrichment> {
    const llm = this.requireLlm();
    const tender = await this.requireTender(id);
    const raw = tender.raw as Record<string, unknown> | null;
    const detail = (raw?.detail ?? null) as {
      categorie?: string | null;
      qualificationsRequises?: string[];
    } | null;

    const enrichment = await aiEnrich(llm, {
      objet: tender.objet,
      buyerName: tender.buyerName,
      procedureLabel: PROCEDURE_LABELS[tender.procedure] ?? tender.procedure,
      category: inferCategory(tender.objet),
      categorieDetail: detail?.categorie ?? null,
      qualificationsRequises: detail?.qualificationsRequises ?? null,
      cautionProvisoireMad: tender.cautionProvisoireMad ?? null,
    });

    // Semantic safety net: the model occasionally returns a résumé describing
    // a DIFFERENT tender (we saw BOUDNIB football fields enriched with a CHR
    // Errachidia medical résumé pre-2026-06-24 cleanup). A token Jaccard
    // overlap below the floor means the résumé doesn't talk about this row's
    // actual subject → reject and persist nothing. Better an empty enrichment
    // (eligible for retry on the next batch) than confidently wrong data.
    const overlap = jaccardOverlap(
      enrichment.resume,
      `${tender.objet} ${tender.buyerName}`,
    );
    if (overlap < MIN_RESUME_OVERLAP) {
      this.logger.warn(
        `ai.enrich ${tender.reference} REJECTED — résumé overlap ${overlap.toFixed(2)} < ${MIN_RESUME_OVERLAP} (likely hallucinated about a different tender)`,
      );
      throw new Error(`Résumé IA non corroboré (overlap=${overlap.toFixed(2)})`);
    }

    await this.repository.updateEnrichment(id, {}, { aiEnrichment: enrichment });
    this.logger.log(
      `ai.enrich ${tender.reference} → ${enrichment.secteur} (${enrichment.faq.length} FAQ, ${enrichment.lots.length} lots, overlap=${overlap.toFixed(2)})`,
    );
    return enrichment;
  }

  /**
   * Bulk AI enrichment of the catalogue — enriches tenders not yet enriched
   * (active/future deadline by default), with bounded concurrency. Per-tender
   * failures are logged and skipped, never aborting the batch.
   */
  async aiEnrichBatch(
    limit: number,
    opts: { onlyActive?: boolean } = {},
  ): Promise<AiEnrichBatchResult> {
    this.requireLlm();
    // Reject overlapping batches so a single user can't fan out the cost.
    if (this.aiBatchRunning) {
      throw new ConflictException('Un enrichissement par lot est déjà en cours');
    }
    this.aiBatchRunning = true;
    try {
      const onlyActive = opts.onlyActive ?? true;
      // Lean candidate read — the "not-yet-enriched + active, newest-first, capped
      // at limit" selection now lives in the repository (pushed to SQL on the
      // Drizzle path), so a single batch never folds the whole `raw` catalogue into
      // JS (the findAll() OOM class that crashed the 792 MB core).
      const pending = await this.repository.findAiEnrichmentCandidates(
        Math.max(0, Math.floor(limit)),
        { onlyActive },
        new Date(),
      );

      let succeeded = 0;
      const failedIds: string[] = [];
      await runPool(pending, AI_ENRICH_CONCURRENCY, async (t) => {
        try {
          await this.aiEnrichTender(t.id);
          succeeded += 1;
        } catch (error) {
          failedIds.push(t.id);
          this.logger.warn(
            `ai.enrich failed ${t.reference}: ${(error as Error).message}`,
          );
        }
      });

      this.logger.log(
        `ai.enrich.batch candidates=${pending.length} ok=${succeeded} ko=${failedIds.length}`,
      );
      return {
        candidates: pending.length,
        processed: pending.length,
        succeeded,
        failed: failedIds.length,
        failedIds,
      };
    } finally {
      this.aiBatchRunning = false;
    }
  }
}
