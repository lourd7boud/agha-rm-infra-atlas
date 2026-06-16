import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Vault — company document vault (10-architecture/03-data-architecture.md §3-4)
// Domain language stays French per data-architecture §2.
// ─────────────────────────────────────────────────────────────────────────────

export const DOCUMENT_KINDS = [
  'attestation_fiscale',
  'attestation_cnss',
  'qualification_classification',
  'registre_commerce',
  'statuts',
  'pouvoirs_signataire',
  'assurance_rc',
  'assurance_decennale',
  'assurance_at',
  'reference_bonne_execution',
  'cv_diplome',
  'materiel_justificatif',
  'autre',
] as const;

export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const VALIDITY_STATUSES = ['valid', 'expiring', 'expired', 'no_expiry'] as const;
export const validityStatusSchema = z.enum(VALIDITY_STATUSES);
export type ValidityStatus = z.infer<typeof validityStatusSchema>;

export const vaultDocumentInputSchema = z.object({
  kind: documentKindSchema,
  label: z.string().min(3).max(200),
  reference: z.string().max(100).optional(),
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});
export type VaultDocumentInput = z.infer<typeof vaultDocumentInputSchema>;

export const vaultDocumentSchema = vaultDocumentInputSchema.extend({
  id: z.string().uuid(),
  status: validityStatusSchema,
  createdAt: z.coerce.date(),
});
export type VaultDocument = z.infer<typeof vaultDocumentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Tender — pipeline (20-tender-division/02-tender-lifecycle.md)
// ─────────────────────────────────────────────────────────────────────────────

export const TENDER_PROCEDURES = [
  'AOO',
  'AOR',
  'concours',
  'negocie',
  'bons_de_commande',
] as const;
export const tenderProcedureSchema = z.enum(TENDER_PROCEDURES);
export type TenderProcedure = z.infer<typeof tenderProcedureSchema>;

export const PIPELINE_STATES = [
  'detected',
  'parsed',
  'qualified',
  'rejected',
  'go_decided',
  'no_go',
  'preparing',
  'submitted',
  'opened',
  'won',
  'lost',
  'cancelled',
] as const;
export const pipelineStateSchema = z.enum(PIPELINE_STATES);
export type PipelineState = z.infer<typeof pipelineStateSchema>;

export const tenderInputSchema = z.object({
  reference: z.string().min(3).max(120),
  buyerName: z.string().min(2).max(200),
  procedure: tenderProcedureSchema,
  objet: z.string().min(5).max(1000),
  estimationMad: z.number().nonnegative().optional(),
  cautionProvisoireMad: z.number().nonnegative().optional(),
  deadlineAt: z.coerce.date(),
  sourceUrl: z.string().url().optional(),
});
export type TenderInput = z.infer<typeof tenderInputSchema>;

export const tenderSchema = tenderInputSchema.extend({
  id: z.string().uuid(),
  pipelineState: pipelineStateSchema,
  createdAt: z.coerce.date(),
});
export type Tender = z.infer<typeof tenderSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Submission outcome — the reward signal (Phase 0, "socle de vérité").
// Capturing the real result of OUR bids is the precondition of every learning
// loop: without the predicted↔real couple, no calibration is possible.
// ─────────────────────────────────────────────────────────────────────────────

export const SUBMISSION_RESULTS = ['won', 'lost', 'ecarte'] as const;
export const submissionResultSchema = z.enum(SUBMISSION_RESULTS);
export type SubmissionResult = z.infer<typeof submissionResultSchema>;

export const PRICE_SCENARIOS = ['prudent', 'equilibre', 'agressif'] as const;
export const priceScenarioSchema = z.enum(PRICE_SCENARIOS);
export type PriceScenario = z.infer<typeof priceScenarioSchema>;

export const submissionOutcomeInputSchema = z.object({
  result: submissionResultSchema,
  /** What WE submitted — the prediction half of the couple. */
  montantSoumisMad: z.number().nonnegative().optional(),
  rabaisRetenuPct: z.number().min(0).max(100).optional(),
  scenarioChoisi: priceScenarioSchema.optional(),
  /** The reality half — filled after the plis are opened. */
  ourRank: z.number().int().positive().optional(),
  winnerAmountMad: z.number().nonnegative().optional(),
  motifRejet: z.string().max(2000).optional(),
  lessons: z.array(z.string().max(500)).max(20).optional(),
  decidedAt: z.coerce.date().optional(),
});
export type SubmissionOutcomeInput = z.infer<typeof submissionOutcomeInputSchema>;

export const submissionOutcomeSchema = submissionOutcomeInputSchema.extend({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  /** Derived: how far above the winner we landed, in %. */
  gapToFirstPct: z.number().nullable(),
  /** Derived: the founding metric — (estimation − winner)/estimation, in %. */
  recoveredRebatePct: z.number().nullable(),
  createdAt: z.coerce.date(),
});
export type SubmissionOutcome = z.infer<typeof submissionOutcomeSchema>;
