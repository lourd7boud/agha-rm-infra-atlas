import { index, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { expenses } from './finance';
import { project, projects } from './project';

export const terrainExpenseReconciliations = project.table(
  'terrain_expense_reconciliation',
  {
    expenseId: uuid('expense_id')
      .primaryKey()
      .references(() => expenses.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    treatment: text('treatment').notNull(),
    resourceKind: text('resource_kind'),
    resourceId: uuid('resource_id'),
    expenseAmountMad: numeric('expense_amount_mad', { precision: 14, scale: 2 }).notNull(),
    resourceAmountMad: numeric('resource_amount_mad', { precision: 14, scale: 2 }),
    note: text('note').notNull(),
    actor: text('actor').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    history: jsonb('history').notNull().default([]),
  },
  (t) => [index('terrain_expense_reconciliation_project_idx').on(t.projectId)],
);
