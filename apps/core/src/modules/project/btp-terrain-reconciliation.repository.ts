import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';

export const BTP_TERRAIN_RECONCILIATION_REPOSITORY = Symbol(
  'BTP_TERRAIN_RECONCILIATION_REPOSITORY',
);

export const terrainExpenseReconciliationSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    treatment: z.enum(['standalone', 'linked_resource', 'non_cost']),
    resourceKind: z.enum(['main_oeuvre', 'materiel', 'consommation']).optional(),
    resourceId: z.string().uuid().optional(),
    note: z.string().trim().min(3).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.treatment === 'linked_resource'
        ? !value.resourceKind || !value.resourceId
        : value.resourceKind || value.resourceId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Une ressource est requise uniquement pour une dépense liée',
      });
    }
  });
export type TerrainExpenseReconciliationInput = z.infer<typeof terrainExpenseReconciliationSchema>;
export interface TerrainExpenseReconciliation {
  version: number;
  expenseId: string;
  projectId: string;
  treatment: TerrainExpenseReconciliationInput['treatment'];
  resourceKind: TerrainExpenseReconciliationInput['resourceKind'] | null;
  resourceId: string | null;
  expenseAmountMad: number;
  resourceAmountMad: number | null;
  note: string;
  actor: string;
  updatedAt: string;
  history: Array<Omit<TerrainExpenseReconciliation, 'history'>>;
}
export class TerrainReconciliationError extends Error {}
export class TerrainReconciliationConflict extends TerrainReconciliationError {}
export interface BtpTerrainReconciliationRepository {
  list(projectId: string): Promise<TerrainExpenseReconciliation[]>;
  reconcile(
    projectId: string,
    expenseId: string,
    input: TerrainExpenseReconciliationInput,
    actor: string,
  ): Promise<TerrainExpenseReconciliation>;
}

function map(row: Record<string, unknown>): TerrainExpenseReconciliation {
  return {
    version: Number(row.version),
    expenseId: String(row.expense_id),
    projectId: String(row.project_id),
    treatment: row.treatment as TerrainExpenseReconciliation['treatment'],
    resourceKind: row.resource_kind as TerrainExpenseReconciliation['resourceKind'],
    resourceId: row.resource_id as string | null,
    expenseAmountMad: Number(row.expense_amount_mad),
    resourceAmountMad: row.resource_amount_mad == null ? null : Number(row.resource_amount_mad),
    note: String(row.note),
    actor: String(row.actor),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    history: (row.history ?? []) as TerrainExpenseReconciliation['history'],
  };
}

export class DrizzleBtpTerrainReconciliationRepository
  implements BtpTerrainReconciliationRepository
{
  constructor(private readonly db: Db) {}
  async list(projectId: string): Promise<TerrainExpenseReconciliation[]> {
    const result = await this.db
      .execute(sql`select r.* from project.terrain_expense_reconciliation r
      join finance.expense e on e.id=r.expense_id and e.project_id=r.project_id
      where r.project_id=${projectId} order by r.updated_at desc, r.expense_id`);
    return (result.rows as Record<string, unknown>[]).map(map);
  }

  async reconcile(
    projectId: string,
    expenseId: string,
    raw: TerrainExpenseReconciliationInput,
    actor: string,
  ): Promise<TerrainExpenseReconciliation> {
    const parsed = terrainExpenseReconciliationSchema.safeParse(raw);
    if (!parsed.success) throw new TerrainReconciliationError('Classification de dépense invalide');
    const input = parsed.data;
    return this.db.transaction(async (tx) => {
      // All classifiers lock the economic event first, serializing first insert and subsequent changes.
      const expense = (
        await tx.execute(sql`select amount_mad from finance.expense
        where id=${expenseId} and project_id=${projectId} for update`)
      ).rows[0] as { amount_mad: string } | undefined;
      if (!expense) throw new TerrainReconciliationError('Dépense introuvable pour ce projet');
      const previous = (
        await tx.execute(sql`select * from project.terrain_expense_reconciliation
        where expense_id=${expenseId} for update`)
      ).rows[0] as Record<string, unknown> | undefined;
      const version = previous ? Number(previous.version) : 0;
      if (input.expectedVersion !== version) {
        throw new TerrainReconciliationConflict(
          'Le rapprochement a été modifié — rechargez la décision actuelle',
        );
      }
      let resourceAmount: number | null = null;
      if (input.treatment === 'linked_resource') {
        let result;
        if (input.resourceKind === 'main_oeuvre') {
          result =
            await tx.execute(sql`select round(wd.days_worked * wd.cost_snapshot_mad,2) as amount
            from people.work_day wd join people.assignment a on a.id=wd.assignment_id
            where wd.id=${input.resourceId} and a.project_id=${projectId} for share of wd, a`);
        } else if (input.resourceKind === 'materiel') {
          result = await tx.execute(sql`select cout_carburant_mad + cout_location_mad as amount
            from project.chantier_materiel where id=${input.resourceId} and project_id=${projectId} for share`);
        } else {
          result = await tx.execute(sql`select cout_mad as amount from project.chantier_consommation
            where id=${input.resourceId} and project_id=${projectId} for share`);
        }
        const resource = result.rows[0] as { amount: string | null } | undefined;
        if (!resource || resource.amount == null)
          throw new TerrainReconciliationError(
            'Ressource introuvable ou coût non valorisé pour ce projet',
          );
        resourceAmount = Number(resource.amount);
        if (
          Math.abs(resourceAmount - Number(expense.amount_mad)) > 0.005 &&
          input.note.length < 20
        ) {
          throw new TerrainReconciliationError(
            'Expliquez l’écart de montant dans une note de 20 caractères minimum',
          );
        }
      }
      const history = previous
        ? [...map(previous).history, (({ history: _, ...entry }) => entry)(map(previous))]
        : [];
      const result = await tx.execute(sql`insert into project.terrain_expense_reconciliation
        (expense_id,project_id,treatment,resource_kind,resource_id,expense_amount_mad,resource_amount_mad,note,actor,history)
        values (${expenseId},${projectId},${input.treatment},${input.resourceKind ?? null},${input.resourceId ?? null},
          ${expense.amount_mad},${resourceAmount},${input.note},${actor},${JSON.stringify(history)}::jsonb)
        on conflict (expense_id) do update set treatment=excluded.treatment, resource_kind=excluded.resource_kind,
          resource_id=excluded.resource_id, expense_amount_mad=excluded.expense_amount_mad,
          resource_amount_mad=excluded.resource_amount_mad, note=excluded.note, actor=excluded.actor,
          updated_at=now(),history=excluded.history,version=project.terrain_expense_reconciliation.version+1 returning *`);
      return map(result.rows[0] as Record<string, unknown>);
    });
  }
}
