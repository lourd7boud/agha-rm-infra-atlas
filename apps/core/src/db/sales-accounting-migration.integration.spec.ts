import { Pool } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const url = process.env.SALES_MIGRATION_DATABASE_URL;

describe.skipIf(!url)('sales migration on a dedicated empty PostgreSQL database', () => {
  let pool: Pool;
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/atlas_sales_migration_test') {
      throw new Error('Dedicated empty migration test database required.');
    }
    pool = new Pool({ connectionString: url });
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    for (const migration of migrations.slice(0, -1)) {
      for (const statement of migration.sql) await pool.query(statement);
    }
    await pool.query(`
      INSERT INTO sales.doc_sequence(company_id,doc_type,exercice,last_number)
      VALUES ('agha-rm-infra','devis',2026,42),
        ('agha-rm-infra','facture',2026,15),
        ('agha-rm-infra','bl',2026,12),
        ('agha-rm-infra','avoir',2026,3);
    `);
    await pool.query(`
      INSERT INTO sales.client(id,name)
      VALUES ('10000000-0000-4000-8000-000000000001','Legacy migration client');
      INSERT INTO sales.invoice(client_id,reference,invoice_date,status,total_ht_mad,tva_pct,total_ttc_mad)
      VALUES ('10000000-0000-4000-8000-000000000001','FAC-2026-0009','2026-01-01','brouillon',100,20,120),
        ('10000000-0000-4000-8000-000000000001','FAC-2026-0077','2026-01-01','envoyee',100,20,120);
    `);
    await pool.query('BEGIN');
    try {
      for (const statement of migrations.at(-1)!.sql) await pool.query(statement);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }, 60_000);
  afterAll(async () => { await pool?.end(); });

  test('preserves every legacy counter and maps all four document types', async () => {
    const { rows } = await pool.query(
      'SELECT doc_type, last_value FROM sales.doc_sequence ORDER BY doc_type',
    );
    expect(rows).toEqual([
      { doc_type: 'AV', last_value: 3 },
      { doc_type: 'BL', last_value: 12 },
      { doc_type: 'DEV', last_value: 42 },
      { doc_type: 'FAC', last_value: 77 },
    ]);
    expect((await pool.query('SELECT count(*)::int count FROM sales.doc_sequence_legacy_0051')).rows[0].count).toBe(4);
  });

  test('keeps issued four-digit references and archives the old draft reference', async () => {
    const { rows } = await pool.query(
      'SELECT reference, legacy_reference, status FROM sales.invoice ORDER BY legacy_reference',
    );
    expect(rows).toEqual([
      { reference: null, legacy_reference: 'FAC-2026-0009', status: 'brouillon' },
      { reference: 'FAC-2026-0077', legacy_reference: 'FAC-2026-0077', status: 'emise' },
    ]);
  });
});
