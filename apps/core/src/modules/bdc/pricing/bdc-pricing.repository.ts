import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../../db/client";
import {
  bdcPriceObservations,
  bdcPricingCalibrations,
  bdcPricingFeedback,
  bdcPricingLineDecisions,
  bdcPricingRuns,
} from "../../../db/schema";
import type {
  LinePricingDecision,
  PriceObservation,
  PricingCalibration,
  PricingFeedbackInput,
  PricingRunStatus,
  PricingStage,
} from "./bdc-pricing.types";

export const BDC_PRICING_REPOSITORY = Symbol("BDC_PRICING_REPOSITORY");

export interface CreatePricingRun {
  avisId: string;
  idempotencyKey: string;
  contentHash: string;
  actorId: string;
  requestedMarkupPct: number;
  calibrationVersion: string;
}

export interface PricingRunRecord extends CreatePricingRun {
  id: string;
  status: PricingRunStatus;
  stage: PricingStage;
  progressPct: number;
  warnings: string[];
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PricingRunPatch {
  status?: PricingRunStatus;
  stage?: PricingStage;
  progressPct?: number;
  warnings?: string[];
  error?: string | null;
}

export interface ObservationQuery {
  category?: PriceObservation["category"];
  unit?: string;
  region?: string;
  observedSince?: Date;
  verifiedOnly?: boolean;
  limit: number;
}

export interface PricingFeedbackRecord extends PricingFeedbackInput {
  id: string;
  createdAt: Date;
}

export interface BdcPricingRepository {
  createRun(input: CreatePricingRun): Promise<PricingRunRecord>;
  getRun(id: string): Promise<PricingRunRecord | null>;
  getLatestRun(avisId: string): Promise<PricingRunRecord | null>;
  updateRun(id: string, patch: PricingRunPatch): Promise<PricingRunRecord>;
  replaceDecisions(runId: string, decisions: LinePricingDecision[]): Promise<void>;
  listDecisions(runId: string): Promise<LinePricingDecision[]>;
  upsertObservations(items: PriceObservation[]): Promise<PriceObservation[]>;
  findObservations(query: ObservationQuery): Promise<PriceObservation[]>;
  recordFeedback(input: PricingFeedbackInput): Promise<void>;
  listVerifiedFeedback(since: Date): Promise<PricingFeedbackRecord[]>;
  getActiveCalibration(): Promise<PricingCalibration>;
  publishCalibration(value: PricingCalibration): Promise<void>;
}

const decisionSchema = z.object({
  idx: z.number().int().nonnegative(),
  estimatedCostHt: z.number().finite().nonnegative(),
  proposedUnitPriceHt: z.number().finite().nonnegative(),
  rangeLowHt: z.number().finite().nonnegative(),
  rangeHighHt: z.number().finite().nonnegative(),
  markupPct: z.number().finite(),
  confidence: z.enum(["elevee", "moyenne", "faible"]),
  method: z.enum([
    "reference_directe",
    "marche_pondere",
    "decomposition",
    "ia_conservative",
  ]),
  sourceIds: z.array(z.string()),
  explanation: z.string(),
  warnings: z.array(z.string()),
  manualPriceLocked: z.boolean(),
});

const calibrationSchema = z.object({
  version: z.string().min(1),
  createdAt: z.string().datetime(),
  sourceReliability: z.record(z.string(), z.number().finite()),
  categoryFactors: z.record(z.string(), z.number().finite()),
  regionFactors: z.record(z.string(), z.number().finite()),
  unitFactors: z.record(z.string(), z.number().finite()),
  freshnessHalfLifeDays: z.number().finite().positive(),
  sampleCount: z.number().int().nonnegative(),
  mape: z.number().finite().nullable(),
  coveragePct: z.number().finite().nullable(),
  realizedMarkupPct: z.number().finite().nullable(),
  winRatePct: z.number().finite().nullable(),
});

const metadataSchema = z.record(z.string(), z.unknown());
const stringArraySchema = z.array(z.string());

export const BASELINE_PRICING_CALIBRATION: PricingCalibration = {
  version: "baseline-v1",
  createdAt: "2026-07-20T00:00:00.000Z",
  sourceReliability: {
    facture: 1,
    fournisseur: 0.9,
    bpu: 0.85,
    resultat: 0.8,
    devis: 0.75,
    bdc: 0.7,
    web: 0.6,
  },
  categoryFactors: { travaux: 1, fournitures: 1, services: 1 },
  regionFactors: {},
  unitFactors: {},
  freshnessHalfLifeDays: 365,
  sampleCount: 0,
  mape: null,
  coveragePct: null,
  realizedMarkupPct: null,
  winRatePct: null,
};

interface InMemoryRepositoryOptions {
  now?: () => Date;
  id?: () => string;
}

export class InMemoryBdcPricingRepository implements BdcPricingRepository {
  private readonly now: () => Date;
  private readonly id: () => string;
  private runs: PricingRunRecord[] = [];
  private decisions = new Map<string, LinePricingDecision[]>();
  private observations: PriceObservation[] = [];
  private feedback: PricingFeedbackRecord[] = [];
  private calibrations: PricingCalibration[] = [BASELINE_PRICING_CALIBRATION];

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async createRun(input: CreatePricingRun): Promise<PricingRunRecord> {
    const existing = this.runs.find(
      (run) =>
        run.avisId === input.avisId && run.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return structuredClone(existing);

    const now = this.now();
    const record: PricingRunRecord = {
      ...input,
      id: this.id(),
      status: "queued",
      stage: "analyse",
      progressPct: 0,
      warnings: [],
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.runs = [...this.runs, record];
    return structuredClone(record);
  }

  async getRun(id: string): Promise<PricingRunRecord | null> {
    const run = this.runs.find((item) => item.id === id);
    return run ? structuredClone(run) : null;
  }

  async getLatestRun(avisId: string): Promise<PricingRunRecord | null> {
    const run = this.runs
      .filter((item) => item.avisId === avisId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    return run ? structuredClone(run) : null;
  }

  async updateRun(id: string, patch: PricingRunPatch): Promise<PricingRunRecord> {
    const index = this.runs.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Unknown pricing run: ${id}`);
    const updated = {
      ...this.runs[index]!,
      ...structuredClone(patch),
      updatedAt: this.now(),
    };
    this.runs = this.runs.map((item, itemIndex) =>
      itemIndex === index ? updated : item,
    );
    return structuredClone(updated);
  }

  async replaceDecisions(
    runId: string,
    decisions: LinePricingDecision[],
  ): Promise<void> {
    assertUniqueDecisionIndices(decisions);
    this.decisions.set(runId, decisionSchema.array().parse(decisions));
  }

  async listDecisions(runId: string): Promise<LinePricingDecision[]> {
    return structuredClone(this.decisions.get(runId) ?? []);
  }

  async upsertObservations(items: PriceObservation[]): Promise<PriceObservation[]> {
    const output: PriceObservation[] = [];
    for (const input of items) {
      metadataSchema.parse(input.metadata);
      const index = this.observations.findIndex(
        (item) => item.snapshotHash === input.snapshotHash,
      );
      const value = { ...structuredClone(input), id: this.observations[index]?.id ?? input.id ?? this.id() };
      if (index >= 0) {
        this.observations = this.observations.map((item, itemIndex) =>
          itemIndex === index ? value : item,
        );
      } else {
        this.observations = [...this.observations, value];
      }
      output.push(structuredClone(value));
    }
    return output;
  }

  async findObservations(query: ObservationQuery): Promise<PriceObservation[]> {
    const limit = Math.max(0, Math.min(200, query.limit));
    return structuredClone(
      this.observations
        .filter((item) => !query.category || item.category === query.category)
        .filter((item) => !query.unit || item.unit === query.unit)
        .filter((item) => !query.region || item.region === query.region)
        .filter((item) => !query.verifiedOnly || item.verified)
        .filter(
          (item) =>
            !query.observedSince || new Date(item.observedAt) >= query.observedSince,
        )
        .sort(
          (left, right) =>
            new Date(right.observedAt).getTime() -
            new Date(left.observedAt).getTime(),
        )
        .slice(0, limit),
    );
  }

  async recordFeedback(input: PricingFeedbackInput): Promise<void> {
    this.feedback = [
      ...this.feedback,
      { ...structuredClone(input), id: this.id(), createdAt: this.now() },
    ];
  }

  async listVerifiedFeedback(since: Date): Promise<PricingFeedbackRecord[]> {
    return structuredClone(
      this.feedback.filter(
        (item) => item.verified && item.createdAt.getTime() >= since.getTime(),
      ),
    );
  }

  async getActiveCalibration(): Promise<PricingCalibration> {
    return structuredClone(this.calibrations.at(-1) ?? BASELINE_PRICING_CALIBRATION);
  }

  async publishCalibration(value: PricingCalibration): Promise<void> {
    const parsed = calibrationSchema.parse(value) as PricingCalibration;
    if (this.calibrations.some((item) => item.version === parsed.version)) {
      throw new Error(`Calibration versions are immutable: ${parsed.version}`);
    }
    this.calibrations = [...this.calibrations, structuredClone(parsed)];
  }
}

export class DrizzleBdcPricingRepository implements BdcPricingRepository {
  constructor(private readonly db: Db) {}

  async createRun(input: CreatePricingRun): Promise<PricingRunRecord> {
    const [inserted] = await this.db
      .insert(bdcPricingRuns)
      .values({ ...input, requestedMarkupPct: String(input.requestedMarkupPct) })
      .onConflictDoNothing()
      .returning();
    if (inserted) return runRowToRecord(inserted);
    const [existing] = await this.db
      .select()
      .from(bdcPricingRuns)
      .where(
        and(
          eq(bdcPricingRuns.avisId, input.avisId),
          eq(bdcPricingRuns.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Pricing run insert returned no row");
    return runRowToRecord(existing);
  }

  async getRun(id: string): Promise<PricingRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(bdcPricingRuns)
      .where(eq(bdcPricingRuns.id, id))
      .limit(1);
    return row ? runRowToRecord(row) : null;
  }

  async getLatestRun(avisId: string): Promise<PricingRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(bdcPricingRuns)
      .where(eq(bdcPricingRuns.avisId, avisId))
      .orderBy(desc(bdcPricingRuns.createdAt))
      .limit(1);
    return row ? runRowToRecord(row) : null;
  }

  async updateRun(id: string, patch: PricingRunPatch): Promise<PricingRunRecord> {
    const [row] = await this.db
      .update(bdcPricingRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(bdcPricingRuns.id, id))
      .returning();
    if (!row) throw new Error(`Unknown pricing run: ${id}`);
    return runRowToRecord(row);
  }

  async replaceDecisions(
    runId: string,
    decisions: LinePricingDecision[],
  ): Promise<void> {
    assertUniqueDecisionIndices(decisions);
    const parsed = decisionSchema.array().parse(decisions);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(bdcPricingLineDecisions)
        .where(eq(bdcPricingLineDecisions.runId, runId));
      if (parsed.length > 0) {
        await tx.insert(bdcPricingLineDecisions).values(
          parsed.map((decision) => ({
            runId,
            lineIdx: decision.idx,
            decision,
          })),
        );
      }
    });
  }

  async listDecisions(runId: string): Promise<LinePricingDecision[]> {
    const rows = await this.db
      .select()
      .from(bdcPricingLineDecisions)
      .where(eq(bdcPricingLineDecisions.runId, runId))
      .orderBy(bdcPricingLineDecisions.lineIdx);
    return rows.map((row) => decisionSchema.parse(row.decision));
  }

  async upsertObservations(items: PriceObservation[]): Promise<PriceObservation[]> {
    return this.db.transaction(async (tx) => {
      const output: PriceObservation[] = [];
      for (const item of items) {
        metadataSchema.parse(item.metadata);
        const values = observationToValues(item);
        const [row] = await tx
          .insert(bdcPriceObservations)
          .values(values)
          .onConflictDoUpdate({
            target: bdcPriceObservations.evidenceHash,
            set: values,
          })
          .returning();
        if (!row) throw new Error("Price observation upsert returned no row");
        output.push(observationRowToRecord(row));
      }
      return output;
    });
  }

  async findObservations(query: ObservationQuery): Promise<PriceObservation[]> {
    const conditions: SQL[] = [];
    if (query.category) conditions.push(eq(bdcPriceObservations.category, query.category));
    if (query.unit) conditions.push(eq(bdcPriceObservations.unit, query.unit));
    if (query.region) conditions.push(eq(bdcPriceObservations.region, query.region));
    if (query.verifiedOnly) conditions.push(eq(bdcPriceObservations.verified, true));
    if (query.observedSince) {
      conditions.push(gte(bdcPriceObservations.observedAt, query.observedSince));
    }
    const rows = await this.db
      .select()
      .from(bdcPriceObservations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(bdcPriceObservations.observedAt))
      .limit(Math.max(0, Math.min(200, query.limit)));
    return rows.map(observationRowToRecord);
  }

  async recordFeedback(input: PricingFeedbackInput): Promise<void> {
    await this.db.insert(bdcPricingFeedback).values({
      ...input,
      unitPriceHtMad: nullableNumber(input.unitPriceHtMad),
      actualCostHtMad: nullableNumber(input.actualCostHtMad),
      winningAmountHtMad: nullableNumber(input.winningAmountHtMad),
    });
  }

  async listVerifiedFeedback(since: Date): Promise<PricingFeedbackRecord[]> {
    const rows = await this.db
      .select()
      .from(bdcPricingFeedback)
      .where(
        and(
          eq(bdcPricingFeedback.verified, true),
          gte(bdcPricingFeedback.createdAt, since),
        ),
      )
      .orderBy(bdcPricingFeedback.createdAt);
    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      lineIdx: row.lineIdx,
      kind: row.kind as PricingFeedbackInput["kind"],
      unitPriceHtMad: nullableDbNumber(row.unitPriceHtMad),
      actualCostHtMad: nullableDbNumber(row.actualCostHtMad),
      winningAmountHtMad: nullableDbNumber(row.winningAmountHtMad),
      sourceRef: row.sourceRef,
      sourceUrl: row.sourceUrl,
      verified: row.verified,
      note: row.note,
      createdAt: row.createdAt,
    }));
  }

  async getActiveCalibration(): Promise<PricingCalibration> {
    const [row] = await this.db
      .select()
      .from(bdcPricingCalibrations)
      .where(eq(bdcPricingCalibrations.active, true))
      .orderBy(desc(bdcPricingCalibrations.createdAt))
      .limit(1);
    return row
      ? (calibrationSchema.parse(row.payload) as PricingCalibration)
      : structuredClone(BASELINE_PRICING_CALIBRATION);
  }

  async publishCalibration(value: PricingCalibration): Promise<void> {
    const parsed = calibrationSchema.parse(value) as PricingCalibration;
    const [existing] = await this.db
      .select({ id: bdcPricingCalibrations.id })
      .from(bdcPricingCalibrations)
      .where(eq(bdcPricingCalibrations.version, parsed.version))
      .limit(1);
    if (existing) throw new Error(`Calibration versions are immutable: ${parsed.version}`);
    await this.db.transaction(async (tx) => {
      await tx
        .update(bdcPricingCalibrations)
        .set({ active: false })
        .where(eq(bdcPricingCalibrations.active, true));
      await tx.insert(bdcPricingCalibrations).values({
        version: parsed.version,
        payload: parsed,
        active: true,
        createdAt: new Date(parsed.createdAt),
      });
    });
  }
}

function assertUniqueDecisionIndices(decisions: LinePricingDecision[]): void {
  const indices = new Set<number>();
  for (const decision of decisions) {
    if (indices.has(decision.idx)) {
      throw new Error(`Duplicate pricing decision index: ${decision.idx}`);
    }
    indices.add(decision.idx);
  }
}

type PricingRunRow = typeof bdcPricingRuns.$inferSelect;
type PriceObservationRow = typeof bdcPriceObservations.$inferSelect;

function runRowToRecord(row: PricingRunRow): PricingRunRecord {
  return {
    id: row.id,
    avisId: row.avisId,
    idempotencyKey: row.idempotencyKey,
    contentHash: row.contentHash,
    actorId: row.actorId,
    status: row.status as PricingRunStatus,
    stage: row.stage as PricingStage,
    progressPct: row.progressPct,
    requestedMarkupPct: Number(row.requestedMarkupPct),
    calibrationVersion: row.calibrationVersion,
    warnings: stringArraySchema.parse(row.warnings),
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function observationToValues(item: PriceObservation) {
  return {
    designation: item.designation,
    category: item.category,
    unit: item.unit,
    unitPriceHtMad: String(item.unitPriceHtMad),
    region: item.region,
    observedAt: new Date(item.observedAt),
    sourceType: item.sourceType,
    sourceRef: item.sourceRef,
    sourceUrl: item.sourceUrl,
    evidenceHash: item.snapshotHash,
    verified: item.verified,
    reliability: String(item.reliability),
    metadata: metadataSchema.parse(item.metadata),
  };
}

function observationRowToRecord(row: PriceObservationRow): PriceObservation {
  return {
    id: row.id,
    designation: row.designation,
    category: row.category as PriceObservation["category"],
    unit: row.unit,
    unitPriceHtMad: Number(row.unitPriceHtMad),
    region: row.region,
    observedAt: row.observedAt.toISOString(),
    sourceType: row.sourceType as PriceObservation["sourceType"],
    sourceRef: row.sourceRef,
    sourceUrl: row.sourceUrl,
    snapshotHash: row.evidenceHash,
    verified: row.verified,
    reliability: Number(row.reliability),
    metadata: metadataSchema.parse(row.metadata),
  };
}

function nullableNumber(value: number | null): string | null {
  return value === null ? null : String(value);
}

function nullableDbNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
