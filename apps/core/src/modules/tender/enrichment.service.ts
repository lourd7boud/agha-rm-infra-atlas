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
import { extractAvis, type AvisExtraction } from '../brain/extractor';
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

export interface EnrichmentSummary {
  tenderId: string;
  filled: string[];
  extraction: { ok: boolean; issues?: string[] };
  requalified: boolean;
}

/**
 * Closes the read→think→act loop: Extractor output updates the tender
 * (published portal data always wins — only missing fields are filled),
 * then the Qualifier re-runs where the state machine allows it.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger('Enrichment');

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
}
