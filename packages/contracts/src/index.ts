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
