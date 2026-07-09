// Photothèque / PV / documents repository — DB rows only; the file bytes live
// in object storage (MinIO) and are streamed by the controller through the
// vault module's OBJECT_STORAGE contract (presigned GET URLs, never proxied).
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { photoAlbums, projectAssets } from '../../db/schema';

export type AssetType = 'photo' | 'pv' | 'document';

export interface AlbumRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  sortOrder: number;
  periodeId: string | null;
  photosCount: number;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  type: AssetType;
  fileName: string | null;
  originalName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storageKey: string | null;
  albumId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
}

export const BTP_ASSETS_REPOSITORY = Symbol('BTP_ASSETS_REPOSITORY');

export interface BtpAssetsRepository {
  listAlbums(projectId: string): Promise<AlbumRecord[]>;
  createAlbum(
    projectId: string,
    input: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      periodeId?: string;
    },
    createdBy: string,
  ): Promise<AlbumRecord>;
  updateAlbum(
    projectId: string,
    albumId: string,
    patch: Partial<{
      name: string;
      description: string;
      color: string;
      icon: string;
      sortOrder: number;
    }>,
  ): Promise<AlbumRecord | null>;
  deleteAlbum(projectId: string, albumId: string): Promise<boolean>;

  listAssets(projectId: string, type?: AssetType): Promise<AssetRecord[]>;
  countAssets(projectId: string): Promise<Record<AssetType, number>>;
  createAsset(input: {
    projectId: string;
    type: AssetType;
    fileName?: string;
    originalName?: string;
    mimeType?: string;
    fileSize?: number;
    storageKey?: string;
    sha256?: string;
    albumId?: string;
    metadata?: Record<string, unknown>;
    createdBy: string;
  }): Promise<AssetRecord>;
  updateAssetMetadata(
    projectId: string,
    assetId: string,
    patch: { albumId?: string | null; metadata?: Record<string, unknown> },
  ): Promise<AssetRecord | null>;
  getAsset(assetId: string): Promise<AssetRecord | null>;
  deleteAsset(projectId: string, assetId: string): Promise<boolean>;
}

function mapAlbum(row: typeof photoAlbums.$inferSelect, photosCount = 0): AlbumRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? null,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sortOrder,
    periodeId: row.periodeId ?? null,
    photosCount,
  };
}

function mapAsset(row: typeof projectAssets.$inferSelect): AssetRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as AssetType,
    fileName: row.fileName ?? null,
    originalName: row.originalName ?? null,
    mimeType: row.mimeType ?? null,
    fileSize: row.fileSize ?? null,
    storageKey: row.storageKey ?? null,
    albumId: row.albumId ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleBtpAssetsRepository implements BtpAssetsRepository {
  constructor(private readonly db: Db) {}

  async listAlbums(projectId: string): Promise<AlbumRecord[]> {
    const rows = await this.db
      .select({
        album: photoAlbums,
        photosCount: sql<number>`(select count(*) from ${projectAssets} a where a.album_id = ${photoAlbums.id} and a.deleted_at is null)::int`,
      })
      .from(photoAlbums)
      .where(and(eq(photoAlbums.projectId, projectId), isNull(photoAlbums.deletedAt)))
      .orderBy(asc(photoAlbums.sortOrder), asc(photoAlbums.createdAt));
    return rows.map((r) => mapAlbum(r.album, r.photosCount));
  }

  async createAlbum(
    projectId: string,
    input: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      periodeId?: string;
    },
    createdBy: string,
  ): Promise<AlbumRecord> {
    const [row] = await this.db
      .insert(photoAlbums)
      .values({
        projectId,
        name: input.name,
        description: input.description,
        color: input.color ?? '#22d3ee',
        icon: input.icon ?? 'folder',
        periodeId: input.periodeId,
        createdBy,
      })
      .returning();
    if (!row) throw new Error("Création de l'album échouée");
    return mapAlbum(row);
  }

  async updateAlbum(
    projectId: string,
    albumId: string,
    patch: Partial<{
      name: string;
      description: string;
      color: string;
      icon: string;
      sortOrder: number;
    }>,
  ): Promise<AlbumRecord | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
    if (Object.keys(set).length === 0) {
      const [existing] = await this.db
        .select()
        .from(photoAlbums)
        .where(and(eq(photoAlbums.id, albumId), eq(photoAlbums.projectId, projectId)))
        .limit(1);
      return existing ? mapAlbum(existing) : null;
    }
    const [row] = await this.db
      .update(photoAlbums)
      .set(set)
      .where(
        and(
          eq(photoAlbums.id, albumId),
          eq(photoAlbums.projectId, projectId),
          isNull(photoAlbums.deletedAt),
        ),
      )
      .returning();
    return row ? mapAlbum(row) : null;
  }

  async deleteAlbum(projectId: string, albumId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(photoAlbums)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(photoAlbums.id, albumId),
            eq(photoAlbums.projectId, projectId),
            isNull(photoAlbums.deletedAt),
          ),
        )
        .returning({ id: photoAlbums.id });
      if (rows.length === 0) return false;
      // Photos fall back to "sans album" — never delete the files with the box.
      await tx
        .update(projectAssets)
        .set({ albumId: null, updatedAt: new Date() })
        .where(eq(projectAssets.albumId, albumId));
      return true;
    });
  }

  async listAssets(projectId: string, type?: AssetType): Promise<AssetRecord[]> {
    const conditions = [eq(projectAssets.projectId, projectId), isNull(projectAssets.deletedAt)];
    if (type) conditions.push(eq(projectAssets.type, type));
    const rows = await this.db
      .select()
      .from(projectAssets)
      .where(and(...conditions))
      .orderBy(desc(projectAssets.createdAt));
    return rows.map(mapAsset);
  }

  async countAssets(projectId: string): Promise<Record<AssetType, number>> {
    const [row] = await this.db
      .select({
        photo: sql<number>`count(*) filter (where ${projectAssets.type} = 'photo')::int`,
        pv: sql<number>`count(*) filter (where ${projectAssets.type} = 'pv')::int`,
        document: sql<number>`count(*) filter (where ${projectAssets.type} = 'document')::int`,
      })
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, projectId), isNull(projectAssets.deletedAt)));
    return { photo: row?.photo ?? 0, pv: row?.pv ?? 0, document: row?.document ?? 0 };
  }

  async createAsset(input: {
    projectId: string;
    type: AssetType;
    fileName?: string;
    originalName?: string;
    mimeType?: string;
    fileSize?: number;
    storageKey?: string;
    sha256?: string;
    albumId?: string;
    metadata?: Record<string, unknown>;
    createdBy: string;
  }): Promise<AssetRecord> {
    const [row] = await this.db
      .insert(projectAssets)
      .values({
        projectId: input.projectId,
        type: input.type,
        fileName: input.fileName,
        originalName: input.originalName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        storageKey: input.storageKey,
        sha256: input.sha256,
        albumId: input.albumId,
        metadata: input.metadata ?? {},
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error('Création du fichier échouée');
    return mapAsset(row);
  }

  async updateAssetMetadata(
    projectId: string,
    assetId: string,
    patch: { albumId?: string | null; metadata?: Record<string, unknown> },
  ): Promise<AssetRecord | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.albumId !== undefined) set.albumId = patch.albumId;
    if (patch.metadata !== undefined) set.metadata = patch.metadata;
    const [row] = await this.db
      .update(projectAssets)
      .set(set)
      .where(
        and(
          eq(projectAssets.id, assetId),
          eq(projectAssets.projectId, projectId),
          isNull(projectAssets.deletedAt),
        ),
      )
      .returning();
    return row ? mapAsset(row) : null;
  }

  async getAsset(assetId: string): Promise<AssetRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.id, assetId), isNull(projectAssets.deletedAt)))
      .limit(1);
    return row ? mapAsset(row) : null;
  }

  async deleteAsset(projectId: string, assetId: string): Promise<boolean> {
    const rows = await this.db
      .update(projectAssets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(projectAssets.id, assetId),
          eq(projectAssets.projectId, projectId),
          isNull(projectAssets.deletedAt),
        ),
      )
      .returning({ id: projectAssets.id });
    return rows.length > 0;
  }
}
