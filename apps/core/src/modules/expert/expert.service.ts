import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import { parseModelJson } from '../brain/extractor';
import {
  INTEL_REPOSITORY,
  type CompetitorBidRecord,
  type IntelRepository,
} from '../intel/intel.repository';
import { canonicalBuyerKey, type RebateBenchmarks } from '../intel/rebate.domain';
import {
  selectRebateBenchmark,
  type SelectedRebate,
} from '../intel/rebate-selector.domain';
import {
  TENDER_REPOSITORY,
  type TenderRecord,
  type TenderRepository,
} from '../tender/tender.repository';
import {
  buildPricingScenarios,
  type PricingScenarios,
} from '../tender/pricing.domain';
import {
  buildMarketContext,
  type MarketContext,
} from '../tender/buyer-observatory.domain';
import { inferSegment } from '../tender/inventory.domain';
import { readDossierExtraction } from '../tender/dossier-extraction';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import { BID_REQUIRED_KINDS, computeReadiness } from '../vault/validity';
import {
  buildExpertKnowledge,
  summarizeParticipation,
  type ExpertKnowledge,
  type ParticipationSummary,
} from './expert-knowledge.domain';
import {
  buildBpuProposal,
  type BpuProposal,
} from './bpu-pricing.domain';
import {
  buildAdminFinancialDossier,
  type AdminFinancialDossier,
} from './dossier-admin.domain';

/**
 * Agent AGHA-RM-INFRA — the company's in-house public-procurement expert.
 * One brain over everything the platform has learned (catalogue, DCE
 * extractions, PV participation, rebate calibration, vault readiness):
 *   - knowledge: what the agent knows today (recomputed, cached briefly)
 *   - analyze:   full expert read of one consultation (numbers are computed
 *                deterministically; the LLM only writes the reasoned opinion)
 *   - bpu:       fills the bordereau des prix, calibrated on the target amount
 *   - dossier:   administrative + financial submission checklist
 */

const KNOWLEDGE_TTL_MS = 5 * 60_000;
/** Default expected competitors when no participation data exists yet. */
const DEFAULT_COMPETITOR_ASSUMPTION = 5;
/** Hard cap on BPU lines sent to the LLM for unit-price suggestions. */
const MAX_LLM_BPU_LINES = 200;

const AVIS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    synthese: { type: 'string' },
    atouts: { type: 'array', items: { type: 'string' } },
    risques: { type: 'array', items: { type: 'string' } },
    pointsVigilance: { type: 'array', items: { type: 'string' } },
    goNoGo: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['go', 'no_go', 'a_verifier'] },
        confiancePct: { type: 'number' },
        raisons: { type: 'array', items: { type: 'string' } },
      },
      required: ['verdict', 'confiancePct', 'raisons'],
    },
  },
  required: ['synthese', 'atouts', 'risques', 'pointsVigilance', 'goNoGo'],
};

const avisSchema = z.object({
  synthese: z.string().min(1),
  atouts: z.array(z.string()).default([]),
  risques: z.array(z.string()).default([]),
  pointsVigilance: z.array(z.string()).default([]),
  goNoGo: z.object({
    verdict: z.enum(['go', 'no_go', 'a_verifier']),
    confiancePct: z.number().min(0).max(100),
    raisons: z.array(z.string()).default([]),
  }),
});

const BPU_PRICES_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    prix: { type: 'array', items: { type: 'number', nullable: true } },
  },
  required: ['prix'],
};

const bpuPricesSchema = z.object({
  prix: z.array(z.number().nullable()),
});

export interface ExpertAvis {
  synthese: string;
  atouts: string[];
  risques: string[];
  pointsVigilance: string[];
  goNoGo: { verdict: 'go' | 'no_go' | 'a_verifier'; confiancePct: number; raisons: string[] };
  model: string;
}

export interface ExpertAnalysis {
  tenderId: string;
  reference: string;
  buyerName: string;
  objet: string;
  segment: string;
  generatedAt: string;
  estimationMad: number | null;
  competition: {
    concurrentsAttendus: number;
    base: 'acheteur' | 'marche' | 'hypothese';
    detail: string;
  };
  rabais: {
    recommandePct: number | null;
    fourchette: { minPct: number; maxPct: number } | null;
    source: string;
  };
  scenarios: PricingScenarios | null;
  marche: MarketContext;
  benchmark: SelectedRebate | null;
  avisExpert: ExpertAvis | null;
  avertissements: string[];
}

interface StoredBpu extends BpuProposal {
  generatedAt: string;
  model: string | null;
}

function readStoredBpu(raw: Record<string, unknown> | null): StoredBpu | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = (raw as Record<string, unknown>).aghaBpu;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as StoredBpu;
}

function readStoredAnalysis(
  raw: Record<string, unknown> | null,
): ExpertAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = (raw as Record<string, unknown>).aghaAnalysis;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as ExpertAnalysis;
}

@Injectable()
export class ExpertService {
  private readonly logger = new Logger('AghaExpert');
  private knowledgeCache: { value: ExpertKnowledge; at: number } | null = null;
  private knowledgeInflight: Promise<ExpertKnowledge> | null = null;

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null = null,
    @Optional()
    @Inject(VAULT_REPOSITORY)
    private readonly vault: VaultRepository | null = null,
  ) {}

  /** The agent's current knowledge base (cached briefly, single-flight). */
  async getKnowledge(now = new Date()): Promise<ExpertKnowledge> {
    if (
      this.knowledgeCache &&
      now.getTime() - this.knowledgeCache.at < KNOWLEDGE_TTL_MS
    ) {
      return this.knowledgeCache.value;
    }
    if (this.knowledgeInflight) return this.knowledgeInflight;
    this.knowledgeInflight = this.computeKnowledge(now)
      .then((value) => {
        // Stamp at COMPLETION, not call time — a slow findAll must not eat
        // into the TTL window it just paid for.
        this.knowledgeCache = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        this.knowledgeInflight = null;
      });
    return this.knowledgeInflight;
  }

  private async computeKnowledge(now: Date): Promise<ExpertKnowledge> {
    const [tenders, bids, benchmarks] = await Promise.all([
      this.tenders.findAll(),
      this.intel.listAllBids().catch((error: unknown) => {
        this.logger.warn(`listAllBids failed: ${(error as Error).message}`);
        return [] as CompetitorBidRecord[];
      }),
      this.intel.rebateBenchmarks().catch((error: unknown) => {
        this.logger.warn(`rebateBenchmarks failed: ${(error as Error).message}`);
        return null as RebateBenchmarks | null;
      }),
    ]);
    return buildExpertKnowledge({ tenders, bids, benchmarks, now });
  }

  /** Full expert read of one consultation. Numbers deterministic, prose LLM. */
  async analyzeTender(id: string, now = new Date()): Promise<ExpertAnalysis> {
    const tender = await this.tenders.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);

    const [all, bids, benchmarks] = await Promise.all([
      this.tenders.findAll(),
      this.intel.listAllBids().catch(() => [] as CompetitorBidRecord[]),
      this.intel.rebateBenchmarks().catch(() => null as RebateBenchmarks | null),
    ]);

    const avertissements: string[] = [];
    const extraction = readDossierExtraction(tender.raw);
    const estimation = tender.estimationMad ?? extraction?.estimationMad ?? null;
    const segment = inferSegment(tender.objet, tender.buyerName);
    const marche = buildMarketContext(tender, all);
    const participation = summarizeParticipation(bids);
    const competition = this.expectedCompetition(tender, participation);
    const benchmark = benchmarks
      ? selectRebateBenchmark(benchmarks, { buyerName: tender.buyerName, segment })
      : null;

    let scenarios: PricingScenarios | null = null;
    if (estimation !== null) {
      scenarios = buildPricingScenarios({
        estimationMad: estimation,
        competitorCount: competition.concurrentsAttendus,
        ...(benchmark ? { rebateBenchmark: benchmark } : {}),
      });
    } else {
      avertissements.push(
        "Estimation administrative inconnue — scénarios de prix et rabais recommandé indisponibles (lancer l'extraction DCE).",
      );
    }

    const rabais = this.recommendedRabais(scenarios, benchmark);
    const avisExpert = await this.generateAvis({
      tender,
      extraction,
      estimation,
      segment,
      marche,
      competition,
      benchmark,
      scenarios,
    }).catch((error: unknown) => {
      this.logger.warn(`avis expert failed: ${(error as Error).message}`);
      avertissements.push(
        "Avis rédigé indisponible (IA hors-ligne) — l'analyse chiffrée reste valable.",
      );
      return null;
    });

    const analysis: ExpertAnalysis = {
      tenderId: tender.id,
      reference: tender.reference,
      buyerName: tender.buyerName,
      objet: tender.objet,
      segment,
      generatedAt: now.toISOString(),
      estimationMad: estimation,
      competition,
      rabais,
      scenarios,
      marche,
      benchmark,
      avisExpert,
      avertissements,
    };

    await this.tenders
      .updateEnrichment(id, {}, { aghaAnalysis: analysis })
      .catch((error: unknown) =>
        this.logger.warn(`persist analysis failed: ${(error as Error).message}`),
      );
    return analysis;
  }

  async getAnalysis(id: string): Promise<ExpertAnalysis> {
    const tender = await this.tenders.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);
    const stored = readStoredAnalysis(tender.raw);
    if (!stored) {
      throw new NotFoundException(
        "Aucune analyse AGHA pour cette consultation — lancer l'analyse d'abord.",
      );
    }
    return stored;
  }

  /** Fills the bordereau des prix from the extracted DCE lines. */
  async proposeBpu(
    id: string,
    opts: { rabaisPct?: number } = {},
    now = new Date(),
  ): Promise<StoredBpu> {
    const tender = await this.tenders.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);

    const extraction = readDossierExtraction(tender.raw);
    const lines = extraction?.bpu ?? [];
    if (lines.length === 0) {
      throw new ConflictException(
        'Bordereau des prix non extrait pour cette consultation — lancer l’extraction DCE d’abord.',
      );
    }

    const estimation = tender.estimationMad ?? extraction?.estimationMad ?? null;
    const segment = inferSegment(tender.objet, tender.buyerName);

    let rabais = opts.rabaisPct ?? null;
    if (rabais === null && estimation !== null) {
      const [bids, benchmarks] = await Promise.all([
        this.intel.listAllBids().catch(() => [] as CompetitorBidRecord[]),
        this.intel.rebateBenchmarks().catch(() => null as RebateBenchmarks | null),
      ]);
      const participation = summarizeParticipation(bids);
      const competition = this.expectedCompetition(tender, participation);
      const benchmark = benchmarks
        ? selectRebateBenchmark(benchmarks, { buyerName: tender.buyerName, segment })
        : null;
      const scenarios = buildPricingScenarios({
        estimationMad: estimation,
        competitorCount: competition.concurrentsAttendus,
        ...(benchmark ? { rebateBenchmark: benchmark } : {}),
      });
      rabais = this.recommendedRabais(scenarios, benchmark).recommandePct;
    }

    const { prices, model } = await this.suggestUnitPrices(tender, lines, segment);

    let proposal: BpuProposal;
    try {
      proposal = buildBpuProposal(lines, prices, {
        estimationMad: estimation,
        rabaisPct: rabais,
      });
    } catch (error) {
      throw new ServiceUnavailableException((error as Error).message);
    }

    const stored: StoredBpu = {
      ...proposal,
      generatedAt: now.toISOString(),
      model,
    };
    await this.tenders
      .updateEnrichment(id, {}, { aghaBpu: stored })
      .catch((error: unknown) =>
        this.logger.warn(`persist bpu failed: ${(error as Error).message}`),
      );
    return stored;
  }

  async getBpu(id: string): Promise<StoredBpu> {
    const tender = await this.tenders.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);
    const stored = readStoredBpu(tender.raw);
    if (!stored) {
      throw new NotFoundException(
        'Aucune proposition de prix AGHA pour cette consultation.',
      );
    }
    return stored;
  }

  /** Administrative + financial submission checklist for one consultation. */
  async adminDossier(id: string, now = new Date()): Promise<AdminFinancialDossier> {
    const tender = await this.tenders.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);

    const docs = this.vault
      ? await this.vault.findAll().catch((error: unknown) => {
          this.logger.warn(`vault read failed: ${(error as Error).message}`);
          return [];
        })
      : [];
    const readiness = computeReadiness(
      docs.map((doc) => ({ kind: doc.kind, expiresAt: doc.expiresAt ?? null })),
      now,
    );

    const extraction = readDossierExtraction(tender.raw);
    const storedBpu = readStoredBpu(tender.raw);

    return buildAdminFinancialDossier({
      tender,
      readiness,
      requiredKinds: BID_REQUIRED_KINDS,
      qualifications: extraction?.qualifications ?? [],
      chiffreAffairesMinMad: extraction?.chiffreAffairesMinMad ?? null,
      delaiExecutionMois: extraction?.delaiExecutionMois ?? null,
      proposedTotalMad: storedBpu?.totalMad ?? null,
      now,
    });
  }

  private expectedCompetition(
    tender: TenderRecord,
    participation: ParticipationSummary,
  ): ExpertAnalysis['competition'] {
    const buyerKey = canonicalBuyerKey(tender.buyerName);
    const buyerRow = participation.byBuyer.find(
      (row) => canonicalBuyerKey(row.buyerName) === buyerKey,
    );
    if (buyerRow) {
      return {
        concurrentsAttendus: Math.max(1, Math.round(buyerRow.avgBidders)),
        base: 'acheteur',
        detail: `Moyenne observée chez ${tender.buyerName} : ${buyerRow.avgBidders} soumissionnaires sur ${buyerRow.tendersObserved} consultation(s) publiée(s).`,
      };
    }
    if (participation.avgBiddersPerTender !== null) {
      return {
        concurrentsAttendus: Math.max(
          1,
          Math.round(participation.avgBiddersPerTender),
        ),
        base: 'marche',
        detail: `Moyenne du marché observé : ${participation.avgBiddersPerTender} soumissionnaires par consultation (${participation.tendersWithResults} résultats étudiés).`,
      };
    }
    return {
      concurrentsAttendus: DEFAULT_COMPETITOR_ASSUMPTION,
      base: 'hypothese',
      detail: `Aucun résultat publié étudié pour l'instant — hypothèse de ${DEFAULT_COMPETITOR_ASSUMPTION} concurrents.`,
    };
  }

  private recommendedRabais(
    scenarios: PricingScenarios | null,
    benchmark: SelectedRebate | null,
  ): ExpertAnalysis['rabais'] {
    if (scenarios) {
      const recommended = scenarios.scenarios.find(
        (s) => s.nom === scenarios.recommandation.nom,
      );
      const rabaisValues = scenarios.scenarios.map((s) => s.rabaisPct);
      return {
        recommandePct: recommended?.rabaisPct ?? null,
        fourchette: {
          minPct: Math.min(...rabaisValues),
          maxPct: Math.max(...rabaisValues),
        },
        source: scenarios.hypotheses.methode,
      };
    }
    if (benchmark) {
      return {
        recommandePct: benchmark.medianPct,
        fourchette: { minPct: benchmark.p25Pct, maxPct: benchmark.p75Pct },
        source: `rabais gagnants observés (${benchmark.source}, N=${benchmark.count}) — estimation requise pour chiffrer`,
      };
    }
    return {
      recommandePct: null,
      fourchette: null,
      source: 'indisponible — ni estimation ni calibrage',
    };
  }

  private async generateAvis(input: {
    tender: TenderRecord;
    extraction: ReturnType<typeof readDossierExtraction>;
    estimation: number | null;
    segment: string;
    marche: MarketContext;
    competition: ExpertAnalysis['competition'];
    benchmark: SelectedRebate | null;
    scenarios: PricingScenarios | null;
  }): Promise<ExpertAvis | null> {
    if (!this.llm) return null;
    const { tender } = input;
    const dossier = {
      fiche: {
        reference: tender.reference,
        acheteur: tender.buyerName,
        objet: tender.objet,
        procedure: tender.procedure,
        dateLimite: tender.deadlineAt.toISOString(),
        estimationMad: input.estimation,
        cautionProvisoireMad: tender.cautionProvisoireMad ?? null,
        segment: input.segment,
      },
      extractionDce: input.extraction
        ? {
            qualifications: input.extraction.qualifications ?? [],
            chiffreAffairesMinMad: input.extraction.chiffreAffairesMinMad ?? null,
            delaiExecutionMois: input.extraction.delaiExecutionMois ?? null,
            nbLignesBpu: input.extraction.bpu?.length ?? 0,
          }
        : null,
      contexteMarche: input.marche,
      concurrenceAttendue: input.competition,
      calibrageRabais: input.benchmark,
      scenariosPrix: input.scenarios,
    };
    const completion = await this.llm.complete({
      tier: 'T3',
      system:
        "Tu es l'agent AGHA-RM-INFRA, l'expert interne des marchés publics marocains de l'entreprise AGHA RM INFRA (BTP, hydraulique, infrastructures agricoles). " +
        'Tu rédiges un avis d’expert Go/No-Go fondé UNIQUEMENT sur le dossier JSON fourni. ' +
        'Règles absolues : ne JAMAIS inventer un chiffre — cite uniquement les montants, rabais et effectifs présents dans le dossier ; ' +
        'signale explicitement les données manquantes ; réponds en JSON strict conforme au schéma.',
      prompt:
        `DOSSIER DE LA CONSULTATION (JSON):\n${JSON.stringify(dossier)}\n\n` +
        "Rédige l'avis d'expert : synthèse (5-8 phrases, français professionnel), atouts pour AGHA RM INFRA, risques, points de vigilance avant dépôt, et le verdict goNoGo (go/no_go/a_verifier) avec confiance (0-100) et raisons.",
      maxTokens: 2500,
      responseSchema: AVIS_RESPONSE_SCHEMA,
    });
    let parsed: unknown;
    try {
      parsed = parseModelJson(completion.text, completion.prefill);
    } catch {
      throw new Error('Réponse IA non-JSON');
    }
    const result = avisSchema.safeParse(parsed);
    if (!result.success) throw new Error('Avis IA invalide');
    return { ...result.data, model: completion.model };
  }

  private async suggestUnitPrices(
    tender: TenderRecord,
    lines: ReadonlyArray<{
      designation: string;
      quantite?: number | null;
      unite?: string | null;
    }>,
    segment: string,
  ): Promise<{ prices: Array<number | null>; model: string | null }> {
    if (!this.llm) {
      return { prices: lines.map(() => null), model: null };
    }
    const sent = lines.slice(0, MAX_LLM_BPU_LINES);
    const listing = sent
      .map(
        (line, i) =>
          `${i + 1}. ${line.designation} — quantité ${line.quantite ?? 1} ${line.unite ?? 'u'}`,
      )
      .join('\n');
    try {
      const completion = await this.llm.complete({
        tier: 'T2',
        system:
          'Tu es un métreur-économiste marocain (BTP/hydraulique). Propose des prix unitaires HT réalistes en dirhams (MAD) pour chaque ligne du bordereau. ' +
          'Ces prix servent de PONDÉRATION RELATIVE (ils seront recalés sur le montant cible) : la cohérence entre lignes prime. ' +
          'Réponds en JSON strict {"prix": [...]} — un nombre par ligne, dans le MÊME ordre, null si tu n’as aucune base.',
        prompt:
          `Consultation : ${tender.objet}\nAcheteur : ${tender.buyerName}\nSegment : ${segment}\n\nBORDEREAU (${sent.length} lignes):\n${listing}`,
        maxTokens: 8000,
        responseSchema: BPU_PRICES_RESPONSE_SCHEMA,
      });
      const parsed = bpuPricesSchema.safeParse(parseModelJson(completion.text));
      if (!parsed.success) {
        this.logger.warn('BPU price suggestion invalid — falling back');
        return { prices: lines.map(() => null), model: completion.model };
      }
      // Align to the full line list: truncate extras, pad the tail (and any
      // lines beyond MAX_LLM_BPU_LINES) with null.
      const prices = lines.map((_, i) => parsed.data.prix[i] ?? null);
      return { prices, model: completion.model };
    } catch (error) {
      this.logger.warn(
        `BPU price suggestion failed: ${(error as Error).message}`,
      );
      return { prices: lines.map(() => null), model: null };
    }
  }
}
