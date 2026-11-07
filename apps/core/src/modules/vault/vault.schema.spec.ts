import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { vaultDocuments } from '../../db/schema/vault';

describe('vault file metadata schema', () => {
  it('persists original filename and exact byte length with the object hash', () => {
    expect(getTableConfig(vaultDocuments).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['filename', 'size_bytes', 'sha256', 'object_key']),
    );
  });
});
