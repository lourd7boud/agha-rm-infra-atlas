import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { runBacktest, type PricingBacktestCase } from "./bdc-pricing-backtest";
import {
  BDC_PRICING_REPOSITORY,
  type BdcPricingRepository,
  type PricingFeedbackRecord,
} from "./bdc-pricing.repository";
import type {
  PriceObservation,
  PriceSourceType,
  PricingCalibration,
  PricingCategory,
  PricingFeedbackKind,
} from "./bdc-pricing.types";

export interface PricingLearningSample {
  id: string;
  category: PricingCategory;
  unit: string;
  region: string | null;
  sourceTypes: PriceSourceType[];
  predictedCostHt: number;
  proposedUnitPriceHt: number;
  actualCostHt: number;
  kind: PricingFeedbackKind;
  verified: boolean;
  observedAt: Date;
  winningAmountHtMad?: number | null;
  oldMatcherHadProposal?: boolean;
  manualOriginalPriceHt?: number | null;
  manualAppliedPriceHt?: number | null;
}

export interface PricingLearningOptions {
  minSegmentSamples: number;
  historyDays: number;
  loadSamples?: (since: Date) => Promise<PricingLearningSample[]>;
}

export interface RecalibrationResult {
  published: boolean;
  reason: string;
  calibration: PricingCalibration;
}

export function feedbackLearningWeight(
  kind: PricingFeedbackKind,
  verified: boolean,
  winningAmountHtMad: number | null = null,
): number {
  if (!verified) return 0;
  if (kind === "actual_cost") return 1;
  if (kind === "supplier_quote") return 0.85;
  if (kind === "corrected") return 0.7;
  if (kind === "approved") return 0.4;
  if ((kind === "won" || kind === "lost") && winningAmountHtMad == null) {
    return 0;
  }
  return 0;
}

export function buildCalibrationCandidate(
  current: PricingCalibration,
  input: readonly PricingLearningSample[],
  now: Date,
  minSegmentSamples: number,
): PricingCalibration {
  const samples = input
    .map((sample) => ({
      ...sample,
      learningWeight:
        feedbackLearningWeight(
          sample.kind,
          sample.verified,
          sample.winningAmountHtMad ?? null,
        ) * freshnessWeight(sample.observedAt, now, current.freshnessHalfLifeDays),
    }))
    .filter(
      (sample) =>
        sample.learningWeight > 0 &&
        sample.predictedCostHt > 0 &&
        sample.actualCostHt > 0,
    );
  const categoryFactors = { ...current.categoryFactors };
  const regionFactors = { ...current.regionFactors };
  const unitFactors = { ...current.unitFactors };

  for (const category of ["travaux", "fournitures", "services"] as const) {
    updateSegmentFactor(
      categoryFactors,
      category,
      samples.filter((item) => item.category === category),
      minSegmentSamples,
    );
  }
  for (const key of unique(samples.map((item) => item.region).filter(isString))) {
    updateSegmentFactor(
      regionFactors,
      fold(key),
      samples.filter((item) => item.region && fold(item.region) === fold(key)),
      minSegmentSamples,
    );
  }
  for (const key of unique(samples.map((item) => fold(item.unit)))) {
    updateSegmentFactor(
      unitFactors,
      key,
      samples.filter((item) => fold(item.unit) === key),
      minSegmentSamples,
    );
  }

  const sourceReliability = { ...current.sourceReliability };
  for (const source of unique(samples.flatMap((item) => item.sourceTypes))) {
    const sourceSamples = samples.filter((item) => item.sourceTypes.includes(source));
    if (sourceSamples.length < minSegmentSamples) continue;
    const weightedError = weightedAverage(
      sourceSamples.map((item) => ({
        value:
          Math.abs(item.predictedCostHt - item.actualCostHt) /
          item.actualCostHt,
        weight: item.learningWeight,
      })),
    );
    const currentValue = current.sourceReliability[source] ?? 0.6;
    sourceReliability[source] = clamp(
      currentValue * (1 - Math.min(0.5, weightedError * 0.5)),
      0.2,
      1,
    );
  }

  const mape = samples.length
    ? weightedAverage(
        samples.map((item) => ({
          value:
            (Math.abs(item.predictedCostHt - item.actualCostHt) /
              item.actualCostHt) *
            100,
          weight: item.learningWeight,
        })),
      )
    : null;
  const realizedMarkupPct = samples.length
    ? weightedAverage(
        samples.map((item) => ({
          value: ((item.proposedUnitPriceHt / item.actualCostHt) - 1) * 100,
          weight: item.learningWeight,
        })),
      )
    : null;
  const outcomes = input.filter(
    (item) => item.verified && (item.kind === "won" || item.kind === "lost"),
  );
  const winRatePct = outcomes.length
    ? (outcomes.filter((item) => item.kind === "won").length / outcomes.length) *
      100
    : current.winRatePct;
  const payload = {
    parent: current.version,
    at: now.toISOString(),
    sampleIds: samples.map((item) => item.id).sort(),
  };
  const version = `cal-${now.toISOString().slice(0, 10)}-${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 10)}`;

  return {
    version,
    createdAt: now.toISOString(),
    sourceReliability,
    categoryFactors,
    regionFactors,
    unitFactors,
    freshnessHalfLifeDays: current.freshnessHalfLifeDays,
    sampleCount: samples.length,
    mape: nullableRound(mape),
    coveragePct: current.coveragePct,
    realizedMarkupPct: nullableRound(realizedMarkupPct),
    winRatePct: nullableRound(winRatePct),
  };
}

@Injectable()
export class BdcPricingLearning {
  constructor(
    @Inject(BDC_PRICING_REPOSITORY)
    private readonly repository: BdcPricingRepository,
    private readonly options: PricingLearningOptions = {
      minSegmentSamples: 20,
      historyDays: 1_095,
    },
  ) {}

  async recalibrate(now = new Date()): Promise<RecalibrationResult> {
    const since = new Date(
      now.getTime() - this.options.historyDays * 24 * 60 * 60 * 1_000,
    );
    const current = await this.repository.getActiveCalibration();
    const samples = this.options.loadSamples
      ? await this.options.loadSamples(since)
      : await this.loadVerifiedSamples(since);
    const learnable = samples.filter(
      (item) =>
        feedbackLearningWeight(
          item.kind,
          item.verified,
          item.winningAmountHtMad ?? null,
        ) > 0,
    );
    if (learnable.length < this.options.minSegmentSamples) {
      return {
        published: false,
        reason: "insufficient_verified_samples",
        calibration: current,
      };
    }
    let candidate = buildCalibrationCandidate(
      current,
      samples,
      now,
      this.options.minSegmentSamples,
    );
    const replay = runBacktest(samples.map(toBacktestCase), candidate);
    candidate = {
      ...candidate,
      coveragePct: replay.agentCoveragePct,
      mape: replay.mape,
      realizedMarkupPct: replay.realizedMarkupPct,
    };
    if (!replay.passesProtectedInvariants) {
      return {
        published: false,
        reason: "protected_invariant_failed",
        calibration: current,
      };
    }
    await this.repository.publishCalibration(candidate);
    return { published: true, reason: "published", calibration: candidate };
  }

  async loadVerifiedSamples(
    since: Date,
  ): Promise<PricingLearningSample[]> {
    const [feedback, ...observationLists] = await Promise.all([
      this.repository.listVerifiedFeedback(since),
      ...(["travaux", "fournitures", "services"] as const).map((category) =>
        this.repository.findObservations({ category, limit: 200 }),
      ),
    ]);
    const observations = new Map(
      observationLists.flat().flatMap((item) => (item.id ? [[item.id, item]] : [])),
    );
    const output: PricingLearningSample[] = [];
    for (const item of feedback) {
      const decisions = await this.repository.listDecisions(item.runId);
      const decision = decisions.find(
        (candidate) => item.lineIdx === null || candidate.idx === item.lineIdx,
      );
      if (!decision) continue;
      const sources = decision.sourceIds
        .map((id) => observations.get(id))
        .filter((value): value is PriceObservation => Boolean(value));
      const actualCostHt = feedbackActualCost(item);
      if (!actualCostHt) continue;
      output.push({
        id: item.id,
        category: sources[0]?.category ?? "fournitures",
        unit: sources[0]?.unit ?? "unknown",
        region: sources[0]?.region ?? null,
        sourceTypes: unique(sources.map((source) => source.sourceType)),
        predictedCostHt: decision.estimatedCostHt,
        proposedUnitPriceHt: decision.proposedUnitPriceHt,
        actualCostHt,
        kind: item.kind,
        verified: item.verified,
        observedAt: item.createdAt,
        winningAmountHtMad: item.winningAmountHtMad,
        oldMatcherHadProposal:
          decision.method === "reference_directe" ||
          decision.method === "marche_pondere",
        manualOriginalPriceHt: null,
        manualAppliedPriceHt: null,
      });
    }
    return output;
  }
}

function feedbackActualCost(item: PricingFeedbackRecord): number | null {
  if (item.actualCostHtMad && item.actualCostHtMad > 0) {
    return item.actualCostHtMad;
  }
  if (item.kind === "supplier_quote" && item.unitPriceHtMad) {
    return item.unitPriceHtMad;
  }
  if (
    (item.kind === "approved" || item.kind === "corrected") &&
    item.unitPriceHtMad
  ) {
    return item.unitPriceHtMad / 1.15;
  }
  return null;
}

function toBacktestCase(sample: PricingLearningSample): PricingBacktestCase {
  return {
    id: sample.id,
    category: sample.category,
    unit: sample.unit,
    region: sample.region,
    estimatedCostHt: sample.predictedCostHt,
    proposedUnitPriceHt: sample.proposedUnitPriceHt,
    actualCostHt: sample.actualCostHt,
    hadProposal: sample.proposedUnitPriceHt > 0,
    oldMatcherHadProposal: sample.oldMatcherHadProposal ?? false,
    manualOriginalPriceHt: sample.manualOriginalPriceHt ?? null,
    manualAppliedPriceHt: sample.manualAppliedPriceHt ?? null,
  };
}

function updateSegmentFactor(
  output: Partial<Record<string, number>>,
  key: string,
  samples: Array<PricingLearningSample & { learningWeight: number }>,
  minSamples: number,
): void {
  if (samples.length < minSamples) return;
  const ratio = weightedAverage(
    samples.map((item) => ({
      value: item.actualCostHt / item.predictedCostHt,
      weight: item.learningWeight,
    })),
  );
  const effectiveWeight = samples.reduce(
    (total, item) => total + item.learningWeight,
    0,
  );
  const alpha = Math.min(0.5, (effectiveWeight / minSamples) * 0.5);
  const current = output[key] ?? 1;
  output[key] = clamp(current * (1 - alpha) + ratio * alpha, 0.7, 1.5);
}

function freshnessWeight(observedAt: Date, now: Date, halfLifeDays: number): number {
  const ageDays = Math.max(
    0,
    (now.getTime() - observedAt.getTime()) / (24 * 60 * 60 * 1_000),
  );
  return 2 ** (-ageDays / Math.max(1, halfLifeDays));
}

function weightedAverage(items: Array<{ value: number; weight: number }>): number {
  const denominator = items.reduce((total, item) => total + item.weight, 0);
  if (denominator <= 0) return 0;
  return (
    items.reduce((total, item) => total + item.value * item.weight, 0) /
    denominator
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function nullableRound(value: number | null): number | null {
  return value === null
    ? null
    : Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
