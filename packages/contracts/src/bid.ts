import { z } from 'zod';

const uuid = z.string().uuid();
const expectedVersion = z.number().int().nonnegative();

export const BID_WORKSPACE_STATES = [
  'evaluating',
  'go',
  'no_go',
  'assembling',
  'review',
  'frozen',
  'awaiting_signature',
  'signing',
  'signed',
  'ready_to_submit',
  'submitting',
  'submitted',
  'withdrawal_pending',
  'withdrawn',
  'opened',
  'won',
  'lost',
  'rejected',
  'cancelled',
  'guarantee_release_eligible',
  'closed',
] as const;
export const bidWorkspaceStateSchema = z.enum(BID_WORKSPACE_STATES);
export type BidWorkspaceState = z.infer<typeof bidWorkspaceStateSchema>;

export const startBidWorkspaceSchema = z.object({ tenderId: uuid }).strict();
export const transitionBidWorkspaceSchema = z
  .object({
    to: bidWorkspaceStateSchema,
    expectedVersion,
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export type TransitionBidWorkspaceInput = z.infer<
  typeof transitionBidWorkspaceSchema
>;

export const BID_PACKAGE_ENVELOPES = [
  'administrative',
  'technical',
  'financial',
  'supplementary',
] as const;
export const bidPackageEnvelopeSchema = z.enum(BID_PACKAGE_ENVELOPES);
export type BidPackageEnvelope = z.infer<typeof bidPackageEnvelopeSchema>;

export const bidPackageRequirementInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
    label: z.string().trim().min(3).max(300),
    envelope: bidPackageEnvelopeSchema,
    required: z.boolean(),
    requiresSignature: z.boolean().default(false),
  })
  .strict();
export type BidPackageRequirementInput = z.input<
  typeof bidPackageRequirementInputSchema
>;

export const defineBidPackageRequirementsSchema = z
  .object({
    requirements: z.array(bidPackageRequirementInputSchema).min(1).max(200),
    expectedVersion,
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.requirements.forEach((requirement, index) => {
      if (seen.has(requirement.code)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements', index, 'code'],
          message: 'Requirement code must be unique',
        });
      }
      seen.add(requirement.code);
    });
  });

export const attachBidPackageFileSchema = z
  .object({
    requirementId: uuid,
    vaultDocumentId: uuid,
    expectedVersion,
  })
  .strict();
export type AttachBidPackageFileInput = z.infer<
  typeof attachBidPackageFileSchema
>;

export const freezeBidPackageSchema = z
  .object({ expectedVersion })
  .strict();
export type FreezeBidPackageInput = z.infer<typeof freezeBidPackageSchema>;

export const createBidSigningTaskSchema = z
  .object({
    expectedVersion,
    signerSub: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type CreateBidSigningTaskInput = z.infer<
  typeof createBidSigningTaskSchema
>;

export const cancelBidSigningTaskSchema = z
  .object({
    expectedVersion,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export type CancelBidSigningTaskInput = z.infer<
  typeof cancelBidSigningTaskSchema
>;

export const claimBidSigningTaskSchema = z
  .object({
    taskId: uuid,
    pairingSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    deviceId: z.string().trim().min(1).max(200),
    deviceName: z.string().trim().min(1).max(200),
  })
  .strict();
export type ClaimBidSigningTaskInput = z.infer<
  typeof claimBidSigningTaskSchema
>;

export const bidSignedArtifactMetadataSchema = z
  .object({
    certificateThumbprint: z.string().trim().min(20).max(256),
    certificateSubject: z.string().trim().min(3).max(1000),
    signedAt: z.coerce.date(),
  })
  .strict();
export type BidSignedArtifactMetadata = z.infer<
  typeof bidSignedArtifactMetadataSchema
>;
