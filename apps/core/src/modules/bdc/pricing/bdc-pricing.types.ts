export type PricingCategory = "travaux" | "fournitures" | "services";

export type PricingConfidence = "elevee" | "moyenne" | "faible";

export type PricingMethod =
  | "reference_directe"
  | "marche_pondere"
  | "decomposition"
  | "ia_conservative";

export type PricingRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PricingStage =
  | "analyse"
  | "recherche_interne"
  | "recherche_marche"
  | "normalisation"
  | "estimation"
  | "optimisation"
  | "brouillon_enregistre";

export type PriceSourceType =
  | "bpu"
  | "devis"
  | "bdc"
  | "fournisseur"
  | "facture"
  | "web"
  | "resultat";

export interface NormalizedLineComponent {
  designation: string;
  quantityFactor: number;
  unit: string;
}

export interface NormalizedLine {
  idx: number;
  category: PricingCategory;
  subcategory: string;
  designation: string;
  specification: string;
  quantity: number;
  unit: string;
  region: string | null;
  components: NormalizedLineComponent[];
  assumptions: string[];
  blockers: string[];
  attributes?: Record<string, string | number | boolean>;
}

export interface PriceObservation {
  id?: string;
  designation: string;
  category: PricingCategory;
  unit: string;
  unitPriceHtMad: number;
  region: string | null;
  observedAt: string;
  sourceType: PriceSourceType;
  sourceRef: string;
  sourceUrl: string | null;
  snapshotHash: string;
  verified: boolean;
  reliability: number;
  metadata: Record<string, unknown>;
}

export interface CostEstimateComponent {
  label: string;
  costHtMad: number;
  sourceIds: string[];
}

export interface CostEstimate {
  category: PricingCategory;
  unitCostHtMad: number;
  lowHtMad: number;
  highHtMad: number;
  assumptions: string[];
  components: CostEstimateComponent[];
}

export interface LinePricingDecision {
  idx: number;
  estimatedCostHt: number;
  proposedUnitPriceHt: number;
  rangeLowHt: number;
  rangeHighHt: number;
  markupPct: number;
  confidence: PricingConfidence;
  method: PricingMethod;
  sourceIds: string[];
  explanation: string;
  warnings: string[];
  manualPriceLocked: boolean;
}

export interface PricingRunView {
  id: string;
  avisId: string;
  status: PricingRunStatus;
  stage: PricingStage;
  progressPct: number;
  requestedMarkupPct: number;
  calibrationVersion: string;
  decisions: LinePricingDecision[];
  evidence: PricingEvidenceSummary[];
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingEvidenceSummary {
  id: string;
  designation: string;
  sourceType: PriceSourceType;
  sourceRef: string;
  sourceUrl: string | null;
  observedAt: string;
  unit: string;
  unitPriceHtMad: number;
  verified: boolean;
  reliability: number;
}

export type PricingFeedbackKind =
  | "approved"
  | "corrected"
  | "actual_cost"
  | "supplier_quote"
  | "submitted"
  | "won"
  | "lost";

export interface PricingFeedbackInput {
  runId: string;
  lineIdx: number | null;
  kind: PricingFeedbackKind;
  unitPriceHtMad: number | null;
  actualCostHtMad: number | null;
  winningAmountHtMad: number | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  verified: boolean;
  note: string | null;
}

export interface PricingCalibration {
  version: string;
  createdAt: string;
  sourceReliability: Partial<Record<PriceSourceType, number>>;
  categoryFactors: Partial<Record<PricingCategory, number>>;
  regionFactors: Record<string, number>;
  unitFactors: Record<string, number>;
  freshnessHalfLifeDays: number;
  sampleCount: number;
  mape: number | null;
  coveragePct: number | null;
  realizedMarkupPct: number | null;
  winRatePct: number | null;
}

export interface PricingGuard {
  lowerHt: number | null;
  upperHt: number | null;
  legalBasis: "decret-2-22-431-art-44" | null;
}
