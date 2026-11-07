import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { extname } from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { isDcePreviewExtension } from '@atlas/contracts';
import { MAX_DOSSIER_ENTRY_BYTES } from './dossier-archive-safety';

const WORKER_SOCKET =
  process.env.PREVIEW_WORKER_SOCKET ?? '/run/atlas-preview/worker.sock';
const WORKER_TIMEOUT_MS = 100_000;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 16;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

export class UnsupportedOfficePreviewError extends Error {}
export class OfficePreviewConversionError extends Error {}
export class OfficePreviewUnavailableError extends Error {}

export function officePreviewExtension(filename: string): string | null {
  const extension = extname(filename).slice(1).toLowerCase();
  return isDcePreviewExtension(extension) ? extension : null;
}

export type PreviewWorkerTransport = (
  bytes: Uint8Array,
  filename: string,
  signal?: AbortSignal,
) => Promise<Buffer>;
export const PREVIEW_WORKER_TRANSPORT = Symbol('PREVIEW_WORKER_TRANSPORT');

/** Calls the isolated converter through a Unix socket. The worker has no
 * network, application source, database credentials, or writable rootfs. */
export const requestPreviewWorker: PreviewWorkerTransport = async (
  bytes,
  filename,
  signal,
) => {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOSSIER_ENTRY_BYTES) {
    throw new OfficePreviewConversionError('Fichier vide ou trop volumineux');
  }
  if (!officePreviewExtension(filename)) {
    throw new UnsupportedOfficePreviewError('Format d’aperçu non pris en charge');
  }

  return new Promise<Buffer>((resolve, reject) => {
    const req = request(
      {
        socketPath: WORKER_SOCKET,
        path: `/convert?filename=${encodeURIComponent(filename)}`,
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.byteLength),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_PDF_BYTES) {
            res.destroy(new Error('preview worker output exceeded limit'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks, total);
          if (res.statusCode === 415) {
            reject(new UnsupportedOfficePreviewError('Format d’aperçu non pris en charge'));
            return;
          }
          if (res.statusCode === 503) {
            reject(new OfficePreviewUnavailableError('Service d’aperçu temporairement saturé'));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new OfficePreviewConversionError('Conversion locale indisponible'));
            return;
          }
          if (body.length < 5 || body.subarray(0, 5).toString('ascii') !== '%PDF-') {
            reject(new OfficePreviewConversionError('Réponse de conversion invalide'));
            return;
          }
          resolve(body);
        });
      },
    );
    req.setTimeout(WORKER_TIMEOUT_MS, () => {
      req.destroy(new Error('preview worker timeout'));
    });
    req.on('error', (error) => {
      reject(
        new OfficePreviewUnavailableError('Service d’aperçu local indisponible', {
          cause: error,
        }),
      );
    });
    req.end(Buffer.from(bytes));
  });
};

/** Bounded cache avoids reconverting the same DCE file. Conversion itself is
 * isolated and globally concurrency-limited by the preview worker. */
@Injectable()
export class OfficePreviewService {
  private readonly logger = new Logger(OfficePreviewService.name);
  private readonly cache = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private cacheBytes = 0;
  private readonly transport: PreviewWorkerTransport;

  constructor(
    @Optional()
    @Inject(PREVIEW_WORKER_TRANSPORT)
    transport?: PreviewWorkerTransport,
  ) {
    this.transport = transport ?? requestPreviewWorker;
  }

  async render(
    bytes: Uint8Array,
    filename: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (!officePreviewExtension(filename)) {
      throw new UnsupportedOfficePreviewError('Format d’aperçu non pris en charge');
    }
    const key = createHash('sha256')
      .update(filename.toLowerCase())
      .update(bytes)
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    if (!signal) {
      const active = this.pending.get(key);
      if (active) return active;
    }

    const conversion = this.transport(bytes, filename, signal)
      .then((pdf) => {
        this.putCache(key, pdf);
        return pdf;
      })
      .catch((error: unknown) => {
        if (
          error instanceof UnsupportedOfficePreviewError ||
          error instanceof OfficePreviewConversionError ||
          error instanceof OfficePreviewUnavailableError
        ) {
          this.logger.warn(`Office preview failed (${error.constructor.name})`);
          throw error;
        }
        this.logger.error('Office preview worker failed unexpectedly', error);
        throw new OfficePreviewConversionError('Conversion locale indisponible');
      })
      .finally(() => {
        if (!signal) this.pending.delete(key);
      });
    if (!signal) this.pending.set(key, conversion);
    return conversion;
  }

  private putCache(key: string, pdf: Buffer): void {
    while (
      this.cache.size >= MAX_CACHE_ENTRIES ||
      (this.cacheBytes + pdf.length > MAX_CACHE_BYTES && this.cache.size > 0)
    ) {
      const oldest = this.cache.entries().next().value as [string, Buffer] | undefined;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheBytes -= oldest[1].length;
    }
    if (pdf.length <= MAX_CACHE_BYTES) {
      this.cache.set(key, pdf);
      this.cacheBytes += pdf.length;
    }
  }
}
