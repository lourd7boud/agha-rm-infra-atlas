import { z } from 'zod';

const uuid = z.string().uuid();
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Date civile invalide');

export const TERRAIN_JOURNEE_STATUSES = [
  'draft',
  'submitted',
  'returned',
  'reviewed',
] as const;
export const terrainJourneeStatusSchema = z.enum(TERRAIN_JOURNEE_STATUSES);
export type TerrainJourneeStatus = z.infer<typeof terrainJourneeStatusSchema>;

const attendanceSchema = z
  .object({
    id: uuid,
    assignmentId: uuid.nullable(),
    temporaryName: nullableText(160),
    daysWorked: z.number().finite().min(0).max(2),
    note: nullableText(1000),
  })
  .superRefine((value, context) => {
    if (!value.assignmentId && !value.temporaryName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['temporaryName'],
        message: 'Une affectation ou un nom temporaire est requis',
      });
    }
  });

const productionSchema = z.object({
  id: uuid,
  bpuLigneId: z.string().trim().min(1).max(160).nullable(),
  zone: nullableText(200).default(null),
  designation: z.string().trim().min(1).max(500),
  unite: z.string().trim().min(1).max(40),
  quantite: z.number().finite().positive(),
  note: nullableText(1000),
});

const equipmentSchema = z.object({
  id: uuid,
  engin: z.string().trim().min(1).max(200),
  regime: z.enum(['propre', 'location']),
  heuresUtilisation: z.number().finite().nonnegative().nullable(),
  carburantL: z.number().finite().nonnegative().nullable(),
  coutCarburantMad: z.number().finite().nonnegative().nullable(),
  coutLocationMad: z.number().finite().nonnegative().nullable(),
  note: nullableText(1000),
});

const materialSchema = z.object({
  id: uuid,
  kind: z.enum(['receipt', 'consumption']),
  article: z.string().trim().min(1).max(300),
  unite: z.string().trim().min(1).max(40),
  quantite: z.number().finite().positive(),
  prixUnitaireMad: z.number().finite().nonnegative().nullable(),
  fournisseur: nullableText(300),
  bonLivraison: nullableText(160),
  note: nullableText(1000),
});

const expenseSchema = z.object({
  id: uuid,
  category: z.enum(['transport', 'sous_traitance', 'administratif', 'taxes', 'autre']),
  label: z.string().trim().min(1).max(300),
  amountMad: z.number().finite().positive(),
  note: nullableText(1000),
  photoId: uuid.nullable(),
});

const blockerSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(500),
  severity: z.enum(['info', 'warning', 'critical']),
  owner: z.string().trim().min(1).max(200),
  dueDate: isoDateSchema.nullable(),
  status: z.enum(['open', 'resolved']),
});

export const terrainJourneePayloadSchema = z.object({
  date: isoDateSchema,
  zone: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  attendance: z.array(attendanceSchema).max(500).default([]),
  production: z.array(productionSchema).max(500).default([]),
  equipment: z.array(equipmentSchema).max(500).default([]),
  materials: z.array(materialSchema).max(1000).default([]),
  expenses: z.array(expenseSchema).max(500).default([]),
  blockers: z.array(blockerSchema).max(500).default([]),
  photoIds: z.array(uuid).max(500).default([]),
});
export type TerrainJourneePayload = z.infer<typeof terrainJourneePayloadSchema>;

const expectedVersionSchema = z.number().int().nonnegative();

export const terrainJourneeSaveSchema = z.object({
  expectedVersion: expectedVersionSchema,
  payload: terrainJourneePayloadSchema,
});

export const terrainJourneeTransitionSchema = z.object({
  expectedVersion: expectedVersionSchema,
});

export const terrainJourneeReturnSchema = terrainJourneeTransitionSchema.extend({
  reason: z.string().trim().min(3).max(2000),
});

export const terrainJourneeSettlementSchema = terrainJourneeTransitionSchema.extend({
  attendanceMapping: z
    .array(z.object({ lineId: uuid, assignmentId: uuid }))
    .max(500),
  productionMapping: z
    .array(
      z.object({
        lineId: uuid,
        bpuLigneId: z.string().trim().min(1).max(160),
      }),
    )
    .max(500),
  reason: z.string().trim().min(3).max(2000),
});
export type TerrainJourneeSettlement = Omit<
  z.infer<typeof terrainJourneeSettlementSchema>,
  'expectedVersion'
>;

export interface TerrainJourneeMaterializedRef {
  kind: string;
  id: string;
}

export interface TerrainJourneeHistoryEntry {
  action: string;
  actor: string;
  at: string;
  version: number;
  reason?: string;
  blockerId?: string;
  priorPayload?: TerrainJourneePayload;
  priorMaterializedRefs?: TerrainJourneeMaterializedRef[];
  [key: string]: unknown;
}

export interface TerrainJourneeRecord {
  id: string;
  projectId: string;
  status: TerrainJourneeStatus;
  version: number;
  payload: TerrainJourneePayload;
  returnReason: string | null;
  materializedRefs: TerrainJourneeMaterializedRef[];
  history: TerrainJourneeHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}
