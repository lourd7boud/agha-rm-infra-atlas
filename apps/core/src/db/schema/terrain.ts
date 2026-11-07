import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { project, projects } from './project';
import type {
  TerrainJourneePayload,
  TerrainJourneeRecord,
  TerrainJourneeStatus,
} from '@atlas/contracts';
export const terrainJournees = project.table(
  'terrain_journee',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    status: text('status')
      .$type<TerrainJourneeStatus>()
      .notNull()
      .default('draft'),
    version: integer('version').notNull().default(1),
    payload: jsonb('payload').$type<TerrainJourneePayload>().notNull(),
    returnReason: text('return_reason'),
    materializedRefs: jsonb('materialized_refs')
      .$type<TerrainJourneeRecord['materializedRefs']>()
      .notNull()
      .default([]),
    history: jsonb('history')
      .$type<TerrainJourneeRecord['history']>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('terrain_journee_project_idx').on(t.projectId, t.createdAt)],
);
