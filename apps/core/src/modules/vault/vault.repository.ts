import { randomUUID } from 'node:crypto';
import { desc, eq, isNull } from 'drizzle-orm';
import type { DocumentKind } from '@atlas/contracts';
import type { Db } from '../../db/client';
import { vaultDocuments } from '../../db/schema';

export interface CreateVaultDocument {
  kind: DocumentKind;
  label: string;
  reference?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  notes?: string;
}

export interface VaultFileInfo {
  bucket: string;
  objectKey: string;
  sha256: string;
  mime: string;
}

export interface VaultDocumentRecord extends CreateVaultDocument {
  id: string;
  createdAt: Date;
  bucket?: string;
  objectKey?: string;
  sha256?: string;
  mime?: string;
}

export const VAULT_REPOSITORY = Symbol('VAULT_REPOSITORY');

export interface VaultRepository {
  create(input: CreateVaultDocument): Promise<VaultDocumentRecord>;
  findAll(): Promise<VaultDocumentRecord[]>;
  findById(id: string): Promise<VaultDocumentRecord | null>;
  updateFile(id: string, file: VaultFileInfo): Promise<VaultDocumentRecord | null>;
}

/** Dev/test fallback used when DATABASE_URL is not configured. */
export class InMemoryVaultRepository implements VaultRepository {
  private documents: readonly VaultDocumentRecord[] = [];

  async create(input: CreateVaultDocument): Promise<VaultDocumentRecord> {
    const record: VaultDocumentRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.documents = [...this.documents, record];
    return record;
  }

  async findAll(): Promise<VaultDocumentRecord[]> {
    return [...this.documents];
  }

  async findById(id: string): Promise<VaultDocumentRecord | null> {
    return this.documents.find((doc) => doc.id === id) ?? null;
  }

  async updateFile(id: string, file: VaultFileInfo): Promise<VaultDocumentRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: VaultDocumentRecord = { ...existing, ...file };
    this.documents = this.documents.map((doc) => (doc.id === id ? updated : doc));
    return updated;
  }
}

export class DrizzleVaultRepository implements VaultRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateVaultDocument): Promise<VaultDocumentRecord> {
    const [row] = await this.db
      .insert(vaultDocuments)
      .values({
        kind: input.kind,
        label: input.label,
        reference: input.reference,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        notes: input.notes,
      })
      .returning();
    if (!row) throw new Error('Vault insert returned no row');
    return toRecord(row);
  }

  async findAll(): Promise<VaultDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(vaultDocuments)
      .where(isNull(vaultDocuments.archivedAt))
      .orderBy(desc(vaultDocuments.createdAt));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<VaultDocumentRecord | null> {
    const [row] = await this.db
      .select()
      .from(vaultDocuments)
      .where(eq(vaultDocuments.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async updateFile(id: string, file: VaultFileInfo): Promise<VaultDocumentRecord | null> {
    const [row] = await this.db
      .update(vaultDocuments)
      .set({
        bucket: file.bucket,
        objectKey: file.objectKey,
        sha256: file.sha256,
        mime: file.mime,
        updatedAt: new Date(),
      })
      .where(eq(vaultDocuments.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }
}

type VaultRow = typeof vaultDocuments.$inferSelect;

function toRecord(row: VaultRow): VaultDocumentRecord {
  return {
    id: row.id,
    kind: row.kind as DocumentKind,
    label: row.label,
    reference: row.reference ?? undefined,
    issuedAt: row.issuedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    notes: row.notes ?? undefined,
    bucket: row.bucket ?? undefined,
    objectKey: row.objectKey ?? undefined,
    sha256: row.sha256 ?? undefined,
    mime: row.mime ?? undefined,
    createdAt: row.createdAt,
  };
}
