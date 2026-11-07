import { PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import type { UnzipFileInfo } from 'fflate';

export const MAX_DOSSIER_ARCHIVE_BYTES = 96 * 1024 * 1024;
export const MAX_DOSSIER_ENTRY_BYTES = 25 * 1024 * 1024;
export const MAX_DOSSIER_ENTRIES = 4_000;
export const MAX_DOSSIER_ENTRY_NAME_BYTES = 1_024;
export const MAX_DOSSIER_METADATA_BYTES = 2 * 1024 * 1024;

export interface DossierMetadataBudget {
  entries: number;
  nameBytes: number;
}

interface ArchiveWaiter {
  activate: () => void;
}

/**
 * Serializes the memory-heavy part of DCE handling. The Core container has a
 * finite heap, while one accepted archive can be close to 100 MiB before the
 * selected entry is inflated. A bounded queue provides back-pressure instead
 * of allowing request-rate throttles to turn into concurrent allocations.
 */
export class DossierArchiveAccessGate {
  private active = 0;
  private readonly waiters: ArchiveWaiter[] = [];

  constructor(
    private readonly maxActive = 1,
    private readonly maxWaiting = 8,
  ) {}

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.lease(signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async lease(signal?: AbortSignal): Promise<() => void> {
    await this.acquire(signal);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new ServiceUnavailableException('Requête DCE annulée'));
    }
    if (this.active < this.maxActive) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxWaiting) {
      return Promise.reject(
        new ServiceUnavailableException('Service DCE occupé, veuillez réessayer'),
      );
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const waiter: ArchiveWaiter = {
        activate: () => {
          if (settled) return;
          settled = true;
          cleanup();
          this.active += 1;
          resolve();
        },
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        cleanup();
        reject(new ServiceUnavailableException('Requête DCE annulée'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.activate();
  }
}

export function createDossierMetadataBudget(): DossierMetadataBudget {
  return { entries: 0, nameBytes: 0 };
}

export function trackDossierEntryMetadata(
  file: UnzipFileInfo,
  budget: DossierMetadataBudget,
): void {
  budget.entries += 1;
  if (budget.entries > MAX_DOSSIER_ENTRIES) {
    throw new PayloadTooLargeException('Archive DCE avec trop d’entrées');
  }
  const nameBytes = Buffer.byteLength(file.name, 'utf8');
  if (nameBytes === 0 || nameBytes > MAX_DOSSIER_ENTRY_NAME_BYTES) {
    throw new PayloadTooLargeException('Nom de fichier DCE trop long');
  }
  budget.nameBytes += nameBytes;
  if (budget.nameBytes > MAX_DOSSIER_METADATA_BYTES) {
    throw new PayloadTooLargeException('Métadonnées DCE trop volumineuses');
  }
  if (
    !Number.isSafeInteger(file.size) ||
    !Number.isSafeInteger(file.originalSize) ||
    file.size < 0 ||
    file.originalSize < 0 ||
    file.size > MAX_DOSSIER_ARCHIVE_BYTES
  ) {
    throw new PayloadTooLargeException('Métadonnées de fichier DCE invalides');
  }
}

export function assertDossierArchiveSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOSSIER_ARCHIVE_BYTES) {
    throw new PayloadTooLargeException('Archive DCE trop volumineuse');
  }
}

export function assertDossierEntrySize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOSSIER_ENTRY_BYTES) {
    throw new PayloadTooLargeException('Fichier DCE trop volumineux pour l’aperçu');
  }
}

export function assertSelectedDossierEntry(file: UnzipFileInfo): void {
  assertDossierEntrySize(file.size);
  assertDossierEntrySize(file.originalSize);
  if (file.compression === 0 && file.size !== file.originalSize) {
    throw new PayloadTooLargeException('Taille incohérente pour un fichier ZIP stocké');
  }
}

/** Reads a fetch response without ever buffering more than the configured cap. */
export async function readBoundedResponse(
  response: Response,
  maxBytes = MAX_DOSSIER_ARCHIVE_BYTES,
): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (declared) {
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new PayloadTooLargeException('Archive DCE trop volumineuse');
    }
    declaredBytes = parsed;
  }
  if (!response.body) throw new ServiceUnavailableException('Archive DCE vide');
  const reader = response.body.getReader();
  const declaredBuffer = declaredBytes === null ? null : Buffer.allocUnsafe(declaredBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeException('Archive DCE trop volumineuse');
      }
      if (declaredBuffer) {
        if (total > declaredBuffer.length) {
          await reader.cancel();
          throw new ServiceUnavailableException('Taille du dossier DCE incohérente');
        }
        Buffer.from(value.buffer, value.byteOffset, value.byteLength).copy(
          declaredBuffer,
          total - value.byteLength,
        );
      } else {
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (declaredBuffer) {
    if (total !== declaredBuffer.length) {
      throw new ServiceUnavailableException('Dossier DCE tronqué');
    }
    return declaredBuffer;
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    total,
  );
}
