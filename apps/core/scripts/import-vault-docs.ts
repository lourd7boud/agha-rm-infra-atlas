/**
 * Import the company's founding administrative file into the coffre-fort.
 *
 * Registers each document from COMPANY_FOUNDING_DOCS as a `vault.document`
 * row and, when object storage is configured, attaches the physical PDF to
 * MinIO. Idempotent: a document already present (matched on `reference`) is
 * left untouched, except that a missing file attachment is completed.
 *
 * Usage (run from the repo root, or anywhere with the env below):
 *   DATABASE_URL=...            (required)
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / VAULT_BUCKET   (optional)
 *
 *   tsx apps/core/scripts/import-vault-docs.ts <pdf-dir> [--dry-run]
 *
 * Without the S3_* variables the import is metadata-only — enough to answer
 * "which pieces are on hand vs. à fournir", the file bytes can be attached
 * later. With them, the PDFs are stored and become downloadable from /vault.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import {
  COMPANY_FOUNDING_DOCS,
  type FoundingDocumentSeed,
} from '../src/modules/vault/seed/company-founding-docs';

const COMPANY_ID = 'agha-rm-infra';
const PDF_MIME = 'application/pdf';

interface S3Config {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

function readS3Config(): S3Config | null {
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  return {
    endpoint: S3_ENDPOINT,
    accessKey: S3_ACCESS_KEY,
    secretKey: S3_SECRET_KEY,
    bucket: process.env.VAULT_BUCKET ?? 'atlas-vault',
  };
}

/** Mirror of vault/storage.ts sanitizeFilename — kept inline so the script is standalone. */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_');
  if (/^[_.-]*$/.test(cleaned)) return 'document';
  return cleaned.slice(0, 180);
}

function listPdfs(dir: string): string[] {
  return readdirSync(dir).filter(
    (f) => f.toLowerCase().endsWith('.pdf') && statSync(join(dir, f)).isFile(),
  );
}

function matchFile(doc: FoundingDocumentSeed, files: readonly string[]): string | null {
  const needle = doc.filePattern.toLowerCase();
  return files.find((f) => f.toLowerCase().includes(needle)) ?? null;
}

async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

interface ExistingRow {
  id: string;
  object_key: string | null;
}

async function findExisting(pool: Pool, reference: string): Promise<ExistingRow | null> {
  const { rows } = await pool.query<ExistingRow>(
    `SELECT id, object_key FROM vault.document
       WHERE company_id = $1 AND reference = $2 AND archived_at IS NULL
       LIMIT 1`,
    [COMPANY_ID, reference],
  );
  return rows[0] ?? null;
}

async function insertDocument(pool: Pool, doc: FoundingDocumentSeed): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vault.document (company_id, kind, label, reference, issued_at, expires_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
    [
      COMPANY_ID,
      doc.kind,
      doc.label,
      doc.reference,
      doc.issuedAt ?? null,
      doc.expiresAt ?? null,
      doc.notes,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`Insert returned no id for ${doc.reference}`);
  return id;
}

async function attachFile(
  pool: Pool,
  s3: S3Client,
  cfg: S3Config,
  docId: string,
  doc: FoundingDocumentSeed,
  dir: string,
  fileName: string,
): Promise<string> {
  const body = readFileSync(join(dir, fileName));
  const sha256 = createHash('sha256').update(body).digest('hex');
  const key = `${doc.kind}/${docId}/${sanitizeFilename(fileName)}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: PDF_MIME,
    }),
  );
  await pool.query(
    `UPDATE vault.document
       SET bucket = $1, object_key = $2, sha256 = $3, mime = $4, updated_at = now()
       WHERE id = $5`,
    [cfg.bucket, key, sha256, PDF_MIME, docId],
  );
  return key;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dir = args.find((a) => !a.startsWith('--'));

  if (!dir) {
    console.error('Usage: tsx apps/core/scripts/import-vault-docs.ts <pdf-dir> [--dry-run]');
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }

  const files = listPdfs(dir);
  const s3cfg = readS3Config();
  console.log(`Source dir : ${dir} (${files.length} PDF files)`);
  console.log(`Storage    : ${s3cfg ? `MinIO/S3 bucket "${s3cfg.bucket}"` : 'metadata-only (no S3_* env)'}`);
  console.log(`Mode       : ${dryRun ? 'DRY-RUN (no writes)' : 'WRITE'}\n`);

  const pool = new Pool({ connectionString: databaseUrl });
  const s3 = s3cfg
    ? new S3Client({
        endpoint: s3cfg.endpoint,
        region: process.env.S3_REGION ?? 'us-east-1',
        credentials: { accessKeyId: s3cfg.accessKey, secretAccessKey: s3cfg.secretKey },
        forcePathStyle: true,
      })
    : null;

  let created = 0;
  let skipped = 0;
  let attached = 0;
  let missingFiles = 0;

  try {
    if (s3 && s3cfg && !dryRun) await ensureBucket(s3, s3cfg.bucket);

    for (const doc of COMPANY_FOUNDING_DOCS) {
      const fileName = matchFile(doc, files);
      if (!fileName) missingFiles += 1;

      const existing = await findExisting(pool, doc.reference);

      if (existing) {
        skipped += 1;
        const needsFile = s3 && s3cfg && fileName && !existing.object_key;
        if (needsFile && !dryRun) {
          await attachFile(pool, s3, s3cfg, existing.id, doc, dir, fileName);
          attached += 1;
          console.log(`~ ${doc.reference.padEnd(34)} exists → file attached`);
        } else {
          console.log(`= ${doc.reference.padEnd(34)} already present, skipped`);
        }
        continue;
      }

      if (dryRun) {
        created += 1;
        console.log(
          `+ ${doc.reference.padEnd(34)} would create [${doc.kind}] ` +
            `${fileName ? `+ ${fileName}` : '(no matching PDF)'}`,
        );
        continue;
      }

      const id = await insertDocument(pool, doc);
      created += 1;
      if (s3 && s3cfg && fileName) {
        await attachFile(pool, s3, s3cfg, id, doc, dir, fileName);
        attached += 1;
        console.log(`+ ${doc.reference.padEnd(34)} created [${doc.kind}] + ${fileName}`);
      } else {
        console.log(
          `+ ${doc.reference.padEnd(34)} created [${doc.kind}] (metadata only)`,
        );
      }
    }
  } finally {
    await pool.end();
  }

  console.log(
    `\nDone. created=${created} skipped=${skipped} files_attached=${attached} ` +
      `pdf_not_found=${missingFiles}${dryRun ? ' (dry-run — nothing written)' : ''}`,
  );
}

main().catch((err: unknown) => {
  console.error('Import failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
