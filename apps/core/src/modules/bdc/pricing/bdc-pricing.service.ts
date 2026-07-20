import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import type { BdcRepository } from "../bdc.repository";
import { BDC_REPOSITORY } from "../bdc.repository";
import type { LigneReponseInput } from "../bdc-pricing.domain";
import { designationSimilarity, type PricingRateCard } from "./bdc-estimator.shared";
import type { PriceEvidenceAdapter } from "./bdc-evidence.types";
import { BdcLineAnalyzer } from "./bdc-line-analyzer";
import {
  normalizeObservation,
  type NormalizationPolicy,
  type NormalizedObservation,
} from "./bdc-price-normalizer";
import {
  decideLinePrice,
  optimizeOffer,
  type ScoredPriceEvidence,
} from "./bdc-price-decision";
import {
  BDC_PRICING_REPOSITORY,
  type BdcPricingRepository,
  type PricingRunRecord,
} from "./bdc-pricing.repository";
import { estimateServiceCost } from "./bdc-services.estimator";
import { estimateSupplyCost } from "./bdc-supplies.estimator";
import type {
  CostEstimate,
  NormalizedLine,
  PriceObservation,
  PricingFeedbackInput,
  PricingEvidenceSummary,
  PricingRunView,
  PricingStage,
} from "./bdc-pricing.types";
import { estimateWorksCost } from "./bdc-works.estimator";

export const BDC_PRICING_QUEUE = Symbol("BDC_PRICING_QUEUE");
export const BDC_INTERNAL_EVIDENCE = Symbol("BDC_INTERNAL_EVIDENCE");
export const BDC_WEB_EVIDENCE = Symbol("BDC_WEB_EVIDENCE");
export const BDC_PRICING_NORMALIZATION_POLICY = Symbol(
  "BDC_PRICING_NORMALIZATION_POLICY",
);

export interface CreatePricingRunRequest {
  idempotencyKey: string;
  requestedMarkupPct: number;
  actorId: string;
}

const ESTIMATOR_DEFAULTS = {
  wastePct: 5,
  siteOverheadPct: 10,
  deliveryPct: 4,
  installationPct: 8,
  warrantyRiskPct: 3,
  toolsPct: 4,
  serviceOverheadPct: 10,
  contingencyPct: 5,
} as const;

@Injectable()
export class BdcPricingService {
  constructor(
    @Inject(BDC_REPOSITORY)
    private readonly bdcRepository: BdcRepository,
    @Inject(BDC_PRICING_REPOSITORY)
    private readonly pricingRepository: BdcPricingRepository,
    @Inject(BdcLineAnalyzer)
    private readonly analyzer: BdcLineAnalyzer,
    @Inject(BDC_INTERNAL_EVIDENCE)
    private readonly internalEvidence: PriceEvidenceAdapter,
    @Inject(BDC_WEB_EVIDENCE)
    private readonly webEvidence: PriceEvidenceAdapter,
    @Inject(BDC_PRICING_QUEUE)
    private readonly queue: Queue,
    @Inject(BDC_PRICING_NORMALIZATION_POLICY)
    private readonly normalizationPolicy: NormalizationPolicy,
  ) {}

  async createRun(
    avisId: string,
    request: CreatePricingRunRequest,
  ): Promise<PricingRunView> {
    const avis = await this.bdcRepository.getAvis(avisId);
    if (!avis) throw new NotFoundException("Avis introuvable");
    const response = await this.bdcRepository.ensureReponse(avisId);
    const calibration = await this.pricingRepository.getActiveCalibration();
    const contentHash = createHash("sha256")
      .update(
        JSON.stringify({
          articles: avis.articles,
          category: avis.categorie,
          nature: avis.naturePrestation,
          location: avis.lieu,
          lines: response.lignes.map((line) => ({
            idx: line.idx,
            price: line.prixUnitaireHt,
          })),
        }),
      )
      .digest("hex");
    const run = await this.pricingRepository.createRun({
      avisId,
      idempotencyKey: request.idempotencyKey,
      contentHash,
      actorId: request.actorId,
      requestedMarkupPct: Math.max(15, request.requestedMarkupPct),
      calibrationVersion: calibration.version,
    });
    await this.queue.add(
      "price",
      { runId: run.id },
      {
        jobId: `price-${run.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    return this.toView(run, await this.pricingRepository.listDecisions(run.id));
  }

  async run(runId: string): Promise<PricingRunView> {
    const initial = await this.requireRun(runId);
    if (initial.status === "cancelled" || initial.status === "completed") {
      return this.getRun(runId);
    }
    const warnings = [...initial.warnings];

    try {
      const avis = await this.bdcRepository.getAvis(initial.avisId);
      if (!avis) throw new NotFoundException("Avis introuvable");
      const response = await this.bdcRepository.ensureReponse(initial.avisId);

      await this.stage(runId, "analyse", 5, warnings, "running");
      const lines = await this.analyzer.analyzeLines({
        articles: avis.articles,
        bdcCategory: avis.categorie,
        nature: avis.naturePrestation,
        location: avis.lieu,
      });
      if (await this.isCancelled(runId)) return this.getRun(runId);

      await this.stage(runId, "recherche_interne", 20, warnings);
      const internal = await this.searchAdapter(
        this.internalEvidence,
        lines,
        initial.avisId,
        "source_interne_indisponible",
        warnings,
      );
      if (await this.isCancelled(runId)) return this.getRun(runId);

      await this.stage(runId, "recherche_marche", 40, warnings);
      const web = await this.searchAdapter(
        this.webEvidence,
        lines,
        initial.avisId,
        "recherche_marche_indisponible",
        warnings,
      );
      const observations = await this.pricingRepository.upsertObservations([
        ...internal,
        ...web,
      ]);
      if (await this.isCancelled(runId)) return this.getRun(runId);

      await this.stage(runId, "normalisation", 55, warnings);
      const normalizedByLine = new Map<number, NormalizedObservation[]>();
      for (const line of lines) {
        const normalized = observations
          .map((item) =>
            normalizeObservation(item, line, this.normalizationPolicy),
          )
          .filter((item): item is NormalizedObservation => item !== null);
        normalizedByLine.set(line.idx, normalized);
      }

      await this.stage(runId, "estimation", 70, warnings);
      const decisions = lines.map((line) => {
        const observationsForLine = normalizedByLine.get(line.idx) ?? [];
        const rateCard = this.buildRateCard(
          initial.calibrationVersion,
          observationsForLine,
        );
        const estimate = this.estimate(line, observationsForLine, rateCard);
        const responseLine = response.lignes.find((item) => item.idx === line.idx);
        return decideLinePrice({
          line,
          estimate,
          evidence: this.scoreEvidence(line, observationsForLine),
          requestedMarkupPct: initial.requestedMarkupPct,
          manualPriceHt:
            responseLine && responseLine.prixUnitaireHt > 0
              ? responseLine.prixUnitaireHt
              : null,
        });
      });

      await this.stage(runId, "optimisation", 85, warnings);
      const optimized = optimizeOffer({
        principalCategory: dominantCategory(lines),
        estimationHt: null,
        requestedMarkupPct: initial.requestedMarkupPct,
        lines: lines.map((line) => ({
          category: line.category,
          quantity: line.quantity,
          decision: decisions.find((item) => item.idx === line.idx)!,
        })),
      });
      warnings.push(...optimized.warnings);
      await this.pricingRepository.replaceDecisions(runId, optimized.decisions);
      const completed = await this.stage(
        runId,
        "brouillon_enregistre",
        100,
        warnings,
        "completed",
      );
      return this.toView(
        completed,
        optimized.decisions,
        summarizeEvidence(observations, optimized.decisions),
      );
    } catch (error) {
      const current = await this.pricingRepository.getRun(runId);
      if (current?.status !== "cancelled") {
        await this.pricingRepository.updateRun(runId, {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown pricing failure",
          warnings: [...new Set(warnings)],
        });
      }
      throw error;
    }
  }

  async getRun(runId: string): Promise<PricingRunView> {
    const run = await this.requireRun(runId);
    const decisions = await this.pricingRepository.listDecisions(runId);
    const evidence = await this.pricingRepository.findObservationsByIds(
      unique(decisions.flatMap((item) => item.sourceIds)),
    );
    return this.toView(run, decisions, summarizeEvidence(evidence, decisions));
  }

  async getLatestRun(avisId: string): Promise<PricingRunView | null> {
    const run = await this.pricingRepository.getLatestRun(avisId);
    return run ? this.getRun(run.id) : null;
  }

  async cancelRun(runId: string): Promise<PricingRunView> {
    const run = await this.requireRun(runId);
    if (run.status === "completed" || run.status === "failed") {
      throw new ConflictException("Ce chiffrage est déjà terminé");
    }
    const cancelled = await this.pricingRepository.updateRun(runId, {
      status: "cancelled",
      error: null,
    });
    return this.toView(
      cancelled,
      await this.pricingRepository.listDecisions(runId),
    );
  }

  async applyRun(runId: string) {
    const run = await this.requireRun(runId);
    if (run.status !== "completed") {
      throw new ConflictException("Le chiffrage doit être terminé avant application");
    }
    const response = await this.bdcRepository.ensureReponse(run.avisId);
    if (response.statut !== "brouillon") {
      throw new ConflictException("Seul un brouillon peut recevoir les prix de l'agent");
    }
    const decisions = await this.pricingRepository.listDecisions(runId);
    const byIndex = new Map(decisions.map((item) => [item.idx, item]));
    const lines: LigneReponseInput[] = response.lignes.map((line) => {
      if (line.prixUnitaireHt > 0) return line;
      const decision = byIndex.get(line.idx);
      if (!decision || decision.proposedUnitPriceHt <= 0) return line;
      return {
        ...line,
        prixUnitaireHt: decision.proposedUnitPriceHt,
        source: "agent",
        sourceRef: `Agent ${run.id}`,
        margeAppliquee: false,
        note: `${decision.confidence} · ${decision.method}`,
      };
    });
    const saved = await this.bdcRepository.saveReponse(run.avisId, {
      lignes: lines,
      statut: "brouillon",
    });
    if (!saved) throw new NotFoundException("Avis introuvable");
    return saved;
  }

  async recordFeedback(runId: string, input: Omit<PricingFeedbackInput, "runId">) {
    await this.requireRun(runId);
    await this.pricingRepository.recordFeedback({ ...input, runId });
  }

  private async requireRun(runId: string): Promise<PricingRunRecord> {
    const run = await this.pricingRepository.getRun(runId);
    if (!run) throw new NotFoundException("Chiffrage introuvable");
    return run;
  }

  private async stage(
    runId: string,
    stage: PricingStage,
    progressPct: number,
    warnings: string[],
    status: "running" | "completed" = "running",
  ): Promise<PricingRunRecord> {
    return this.pricingRepository.updateRun(runId, {
      status,
      stage,
      progressPct,
      warnings: [...new Set(warnings)],
      error: null,
    });
  }

  private async isCancelled(runId: string): Promise<boolean> {
    return (await this.pricingRepository.getRun(runId))?.status === "cancelled";
  }

  private async searchAdapter(
    adapter: PriceEvidenceAdapter,
    lines: NormalizedLine[],
    excludeAvisId: string,
    warning: string,
    warnings: string[],
  ): Promise<PriceObservation[]> {
    const output: PriceObservation[] = [];
    let failed = false;
    for (const line of lines) {
      try {
        output.push(
          ...(await adapter.search({ line, excludeAvisId, limit: 30 })),
        );
      } catch {
        failed = true;
      }
    }
    if (failed) warnings.push(warning);
    return output;
  }

  private buildRateCard(
    version: string,
    observations: NormalizedObservation[],
  ): PricingRateCard {
    return {
      version,
      entries: observations.map((item) => ({
        designation: item.designation,
        unit: item.unit,
        unitCostHtMad: item.comparableUnitPriceHtMad,
        sourceIds: item.id ? [item.id] : [],
      })),
      ...ESTIMATOR_DEFAULTS,
    };
  }

  private estimate(
    line: NormalizedLine,
    observations: NormalizedObservation[],
    rateCard: PricingRateCard,
  ): CostEstimate {
    if (line.category === "travaux") {
      return estimateWorksCost(line, observations, rateCard);
    }
    if (line.category === "services") {
      return estimateServiceCost(line, observations, rateCard);
    }
    return estimateSupplyCost(line, observations, rateCard);
  }

  private scoreEvidence(
    line: NormalizedLine,
    observations: NormalizedObservation[],
  ): ScoredPriceEvidence[] {
    return observations.map((observation) => ({
      observation,
      semanticFit: designationSimilarity(line.designation, observation.designation),
      specificationCoverage: designationSimilarity(
        `${line.designation} ${line.specification}`,
        observation.designation,
      ),
      geographyFit:
        !line.region || !observation.region
          ? 0.7
          : fold(line.region) === fold(observation.region)
            ? 1
            : 0.5,
    }));
  }

  private toView(
    run: PricingRunRecord,
    decisions: PricingRunView["decisions"],
    evidence: PricingEvidenceSummary[] = [],
  ): PricingRunView {
    return {
      id: run.id,
      avisId: run.avisId,
      status: run.status,
      stage: run.stage,
      progressPct: run.progressPct,
      requestedMarkupPct: run.requestedMarkupPct,
      calibrationVersion: run.calibrationVersion,
      decisions,
      evidence,
      warnings: run.warnings,
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }
}

function summarizeEvidence(
  observations: PriceObservation[],
  decisions: PricingRunView["decisions"],
): PricingEvidenceSummary[] {
  const used = new Set(decisions.flatMap((item) => item.sourceIds));
  return observations.flatMap((item) =>
    item.id && used.has(item.id)
      ? [
          {
            id: item.id,
            designation: item.designation,
            sourceType: item.sourceType,
            sourceRef: item.sourceRef,
            sourceUrl: item.sourceUrl,
            observedAt: item.observedAt,
            unit: item.unit,
            unitPriceHtMad: item.unitPriceHtMad,
            verified: item.verified,
            reliability: item.reliability,
          },
        ]
      : [],
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dominantCategory(lines: NormalizedLine[]): NormalizedLine["category"] {
  const counts = new Map<NormalizedLine["category"], number>();
  for (const line of lines) {
    counts.set(line.category, (counts.get(line.category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "fournitures";
}
