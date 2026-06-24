import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  tenderListMembers,
  tenderLists,
  tenderSavedSearches,
} from '../../db/schema';

/**
 * Tender folders ("Listes") + named filter sets ("Recherches sauvegardées") —
 * the datao organizational layer above the catalogue. Owned by Keycloak `sub`
 * (multi-user team sharing builds on this when visibility=shared lands).
 */

export interface TenderListRow {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  ownerSub: string;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedSearchRow {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  ownerSub: string;
  filters: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const COMPANY_ID = 'agha-rm-infra';
const MAX_NAME_LENGTH = 120;

function ensureName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ConflictException('Nom requis');
  if (name.length > MAX_NAME_LENGTH) {
    throw new ConflictException(`Nom trop long (max ${MAX_NAME_LENGTH})`);
  }
  return name;
}

@Injectable()
export class TenderListsService {
  constructor(private readonly db: Db) {}

  // ────────────────────────── Listes ──────────────────────────

  /** All lists visible to the user — own (private + shared) + others' shared. */
  async listVisibleLists(ownerSub: string): Promise<TenderListRow[]> {
    const rows = await this.db
      .select({
        id: tenderLists.id,
        name: tenderLists.name,
        visibility: tenderLists.visibility,
        ownerSub: tenderLists.ownerSub,
        createdAt: tenderLists.createdAt,
        updatedAt: tenderLists.updatedAt,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${tenderListMembers}
          WHERE ${tenderListMembers.listId} = ${tenderLists.id}
        )`,
      })
      .from(tenderLists)
      .where(
        and(
          eq(tenderLists.companyId, COMPANY_ID),
          sql`(${tenderLists.ownerSub} = ${ownerSub} OR ${tenderLists.visibility} = 'shared')`,
        ),
      )
      .orderBy(desc(tenderLists.updatedAt));
    return rows.map((r) => ({
      ...r,
      visibility: r.visibility as 'private' | 'shared',
    }));
  }

  async createList(
    ownerSub: string,
    name: string,
    visibility: 'private' | 'shared' = 'private',
  ): Promise<TenderListRow> {
    const safeName = ensureName(name);
    try {
      const [row] = await this.db
        .insert(tenderLists)
        .values({ ownerSub, name: safeName, visibility })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return {
        id: row.id,
        name: row.name,
        visibility: row.visibility as 'private' | 'shared',
        ownerSub: row.ownerSub,
        memberCount: 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      // Unique (company, owner, name) — surface as 409, not 500.
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Une liste portant ce nom existe déjà');
      }
      throw err;
    }
  }

  async deleteList(ownerSub: string, listId: string): Promise<void> {
    const list = await this.requireOwnedList(ownerSub, listId);
    await this.db.delete(tenderLists).where(eq(tenderLists.id, list.id));
  }

  async addTenderToList(
    ownerSub: string,
    listId: string,
    tenderId: string,
  ): Promise<void> {
    await this.requireOwnedList(ownerSub, listId);
    await this.db
      .insert(tenderListMembers)
      .values({ listId, tenderId })
      .onConflictDoNothing({
        target: [tenderListMembers.listId, tenderListMembers.tenderId],
      });
  }

  async removeTenderFromList(
    ownerSub: string,
    listId: string,
    tenderId: string,
  ): Promise<void> {
    await this.requireOwnedList(ownerSub, listId);
    await this.db
      .delete(tenderListMembers)
      .where(
        and(
          eq(tenderListMembers.listId, listId),
          eq(tenderListMembers.tenderId, tenderId),
        ),
      );
  }

  /** Tender ids in a given list (caller filters/joins with the inventory). */
  async listTenderIds(ownerSub: string, listId: string): Promise<string[]> {
    await this.requireVisibleList(ownerSub, listId);
    const rows = await this.db
      .select({ tenderId: tenderListMembers.tenderId })
      .from(tenderListMembers)
      .where(eq(tenderListMembers.listId, listId))
      .orderBy(asc(tenderListMembers.addedAt));
    return rows.map((r) => r.tenderId);
  }

  /**
   * For a set of tender ids, returns the lists each belongs to (for the user) —
   * powers the "Ajouter à une liste" multiselect's checked state in the drawer.
   */
  async membershipMap(
    ownerSub: string,
    tenderIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    if (tenderIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        tenderId: tenderListMembers.tenderId,
        listId: tenderListMembers.listId,
      })
      .from(tenderListMembers)
      .innerJoin(tenderLists, eq(tenderLists.id, tenderListMembers.listId))
      .where(
        and(
          eq(tenderLists.ownerSub, ownerSub),
          inArray(tenderListMembers.tenderId, [...tenderIds]),
        ),
      );
    const out = new Map<string, string[]>();
    for (const r of rows) {
      const list = out.get(r.tenderId) ?? [];
      list.push(r.listId);
      out.set(r.tenderId, list);
    }
    return out;
  }

  // ────────────────────────── Recherches sauvegardées ──────────────────────────

  async listSavedSearches(ownerSub: string): Promise<SavedSearchRow[]> {
    const rows = await this.db
      .select()
      .from(tenderSavedSearches)
      .where(
        and(
          eq(tenderSavedSearches.companyId, COMPANY_ID),
          sql`(${tenderSavedSearches.ownerSub} = ${ownerSub} OR ${tenderSavedSearches.visibility} = 'shared')`,
        ),
      )
      .orderBy(desc(tenderSavedSearches.updatedAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      visibility: r.visibility as 'private' | 'shared',
      ownerSub: r.ownerSub,
      filters: r.filters,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createSavedSearch(
    ownerSub: string,
    name: string,
    filters: unknown,
    visibility: 'private' | 'shared' = 'private',
  ): Promise<SavedSearchRow> {
    const safeName = ensureName(name);
    try {
      const [row] = await this.db
        .insert(tenderSavedSearches)
        .values({ ownerSub, name: safeName, visibility, filters })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return {
        id: row.id,
        name: row.name,
        visibility: row.visibility as 'private' | 'shared',
        ownerSub: row.ownerSub,
        filters: row.filters,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Une recherche portant ce nom existe déjà');
      }
      throw err;
    }
  }

  async deleteSavedSearch(ownerSub: string, searchId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(tenderSavedSearches)
      .where(eq(tenderSavedSearches.id, searchId))
      .limit(1);
    if (!row) throw new NotFoundException(`Saved search not found: ${searchId}`);
    if (row.ownerSub !== ownerSub) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos recherches');
    }
    await this.db.delete(tenderSavedSearches).where(eq(tenderSavedSearches.id, searchId));
  }

  // ────────────────────────── helpers ──────────────────────────

  private async requireVisibleList(
    ownerSub: string,
    listId: string,
  ): Promise<{ id: string; ownerSub: string; visibility: string }> {
    const [row] = await this.db
      .select({
        id: tenderLists.id,
        ownerSub: tenderLists.ownerSub,
        visibility: tenderLists.visibility,
      })
      .from(tenderLists)
      .where(eq(tenderLists.id, listId))
      .limit(1);
    if (!row) throw new NotFoundException(`Liste introuvable: ${listId}`);
    if (row.ownerSub !== ownerSub && row.visibility !== 'shared') {
      throw new ForbiddenException('Liste non accessible');
    }
    return row;
  }

  private async requireOwnedList(
    ownerSub: string,
    listId: string,
  ): Promise<{ id: string; ownerSub: string; visibility: string }> {
    const row = await this.requireVisibleList(ownerSub, listId);
    if (row.ownerSub !== ownerSub) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos listes');
    }
    return row;
  }
}
