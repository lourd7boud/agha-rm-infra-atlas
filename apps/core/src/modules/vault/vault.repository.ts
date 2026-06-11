import { randomUUID } from 'node:crypto';
import { desc, isNull } from 'drizzle-orm';
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

export interface VaultDocumentRecord extends CreateVaultDocument {
  id: string;
  createdAt: Date;
}

export const VAULT_REPOSITORY = Symbol('VAULT_REPOSITORY');

export interface VaultRepository {
  create(input: CreateVaultDocument): Promise<VaultDocumentRecord>;
  findAll(): Promise<VaultDocumentRecord[]>;
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
    createdAt: row.createdAt,
  };
}
