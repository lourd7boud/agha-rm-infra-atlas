import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Allowed upload types for the vault (administrative documents only). */
export const ALLOWED_MIMES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface UploadValidation {
  ok: boolean;
  reason?: string;
}

export function validateUpload(mime: string, sizeBytes: number): UploadValidation {
  if (!ALLOWED_MIMES.includes(mime)) {
    return { ok: false, reason: `Type de fichier non autorisé: ${mime}` };
  }
  if (sizeBytes <= 0) {
    return { ok: false, reason: 'Fichier vide' };
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `Fichier trop volumineux (max ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo)`,
    };
  }
  return { ok: true };
}

/** Keeps object keys portable across S3 implementations and filesystems. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_');
  // A name made only of separators carries no information — degenerate case.
  if (/^[_.-]*$/.test(cleaned)) return 'document';
  return cleaned.slice(0, 180);
}

export interface StoredObject {
  bucket: string;
  key: string;
  sha256: string;
  mime: string;
  sizeBytes: number;
}

export interface ObjectStorage {
  ensureBucket(): Promise<void>;
  put(key: string, body: Buffer, mime: string): Promise<StoredObject>;
  presignedGetUrl(key: string, expiresSeconds?: number): Promise<string>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface S3Options {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    options: S3Options,
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region ?? 'us-east-1',
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
      // MinIO and most self-hosted S3 implementations require path-style URLs.
      forcePathStyle: true,
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, mime: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
    return {
      bucket: this.bucket,
      key,
      sha256: sha256Hex(body),
      mime,
      sizeBytes: body.length,
    };
  }

  async presignedGetUrl(key: string, expiresSeconds = 600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }
}

/** Test double keeping objects in memory. */
export class InMemoryObjectStorage implements ObjectStorage {
  private objects = new Map<string, { body: Buffer; mime: string }>();

  constructor(private readonly bucket = 'test-bucket') {}

  async ensureBucket(): Promise<void> {
    // nothing to provision in memory
  }

  async put(key: string, body: Buffer, mime: string): Promise<StoredObject> {
    this.objects.set(key, { body, mime });
    return {
      bucket: this.bucket,
      key,
      sha256: sha256Hex(body),
      mime,
      sizeBytes: body.length,
    };
  }

  async presignedGetUrl(key: string): Promise<string> {
    if (!this.objects.has(key)) throw new Error(`No object: ${key}`);
    return `memory://${this.bucket}/${key}`;
  }

  get(key: string): { body: Buffer; mime: string } | undefined {
    return this.objects.get(key);
  }
}
