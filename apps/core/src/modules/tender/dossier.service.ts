import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  classifyDceFile,
  mimeForDceFile,
  type DceFileKind,
} from '@atlas/contracts';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';
import { normalizeArchiveToZip } from './dossier-archive';
import { buildFullDossierMarkdown } from './dossier-fulltext';
import { pdfParseExtract } from './pdf-ocr';
import { defaultBinaryExtractor } from './dossier-binary';
import {
  assertDossierArchiveSize,
  assertDossierEntrySize,
  assertSelectedDossierEntry,
  createDossierMetadataBudget,
  DossierArchiveAccessGate,
  readBoundedResponse,
  trackDossierEntryMetadata,
} from './dossier-archive-safety';

export interface DossierFileResult {
  filename: string;
  bytes: Buffer;
  mime: string;
}

export interface LeasedDossierFile {
  file: DossierFileResult;
  /** Idempotent; must be held until the HTTP response finishes or closes. */
  release: () => void;
}

export interface DossierFileInfo {
  /** Full path inside the ZIP (e.g. "AO 09 DR4 2026/Bordereau.xlsx"). */
  name: string;
  /** Display label = bare leaf without the parent folder. */
  label: string;
  /** Coarse kind for the UI viewer (pdf/excel/word/image/other). */
  kind: DceFileKind;
  sizeBytes: number;
}

/** Ordering hint for the file list — most-useful first. Bordereau leads
 *  because the BPU tab is where users came from; RC carries the headline
 *  conditions; CPS the prescriptions; everything else trails. */
function filePriority(label: string): number {
  const l = label.toLowerCase();
  if (/(^|[^a-z])(bordereau|bpu|estimatif)/.test(l)) return 0;
  if (/(^|[^a-z])(rc|reglement|règlement)/.test(l)) return 1;
  if (/(^|[^a-z])(cps|cct|ccap|cctp)/.test(l)) return 2;
  if (/(^|[^a-z])avis/.test(l)) return 3;
  if (/(^|[^a-z])(model|modèle|template)/.test(l)) return 5;
  return 4;
}

import {
  dceIdentityFromEnv,
  downloadDce,
  parsePortalRef,
} from '../watch/dossier.crawler';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from './tender.repository';

/** Cached-dossier metadata stored under tender.raw.dossier. */
export interface DossierMeta {
  objectKey: string;
  filename: string;
  sizeBytes: number;
  downloadedAt: string;
}

export interface DossierResult {
  url: string;
  filename: string;
  sizeBytes: number;
  cached: boolean;
}

function readDossierMeta(raw: Record<string, unknown> | null): DossierMeta | null {
  if (!raw) return null;
  const d = raw.dossier as Partial<DossierMeta> | undefined;
  if (
    d &&
    typeof d.objectKey === 'string' &&
    typeof d.filename === 'string' &&
    typeof d.sizeBytes === 'number'
  ) {
    return {
      objectKey: d.objectKey,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      downloadedAt: typeof d.downloadedAt === 'string' ? d.downloadedAt : '',
    };
  }
  return null;
}

/**
 * The dossier (DCE ZIP) cache: downloads each tender's full dossier from the
 * portal on first request (autonomous 4-step retrait, no login) and serves it
 * from MinIO thereafter — datao's "Télécharger" extra. Lazy + idempotent.
 */
@Injectable()
export class DossierService {
  private readonly logger = new Logger('Dossier');
  private readonly archiveAccess = new DossierArchiveAccessGate();
  private readonly payloadAccess = new DossierArchiveAccessGate();

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Presigned URL to the tender's DCE ZIP; downloads + caches on first call. */
  async ensureDossier(tenderId: string, signal?: AbortSignal): Promise<DossierResult> {
    return this.archiveAccess.run(() => this.ensureDossierUnlocked(tenderId), signal);
  }

  private async ensureDossierUnlocked(tenderId: string): Promise<DossierResult> {
    const tender = await this.tenders.findById(tenderId);
    if (!tender) throw new NotFoundException(`Tender not found: ${tenderId}`);

    const cachedMeta = readDossierMeta(tender.raw);
    if (cachedMeta) {
      return {
        url: await this.storage.presignedGetUrl(cachedMeta.objectKey),
        filename: cachedMeta.filename,
        sizeBytes: cachedMeta.sizeBytes,
        cached: true,
      };
    }

    const ref = parsePortalRef(tender.sourceUrl);
    if (!ref) {
      throw new BadRequestException(
        'Aucun lien portail exploitable pour ce marché (sourceUrl manquant)',
      );
    }

    const dossier = await downloadDce(ref, dceIdentityFromEnv());
    const objectKey = `dossiers/${tenderId}.zip`;
    await this.storage.put(objectKey, dossier.bytes, dossier.mime);
    const meta: DossierMeta = {
      objectKey,
      filename: dossier.filename,
      sizeBytes: dossier.sizeBytes,
      downloadedAt: new Date().toISOString(),
    };
    await this.tenders.updateEnrichment(tenderId, {}, { dossier: meta });
    this.logger.log(
      `dossier ${tender.reference} → ${dossier.filename} (${dossier.sizeBytes} bytes)`,
    );

    return {
      url: await this.storage.presignedGetUrl(objectKey),
      filename: dossier.filename,
      sizeBytes: dossier.sizeBytes,
      cached: false,
    };
  }

  /** Lists every file inside the cached DCE ZIP — powers the left rail of the
   *  "Voir le fichier source" overlay (mirrors datao's split-pane preview).
   *  Inflation is SKIPPED (filter returns false): we read only the central
   *  directory entries to get names + uncompressed sizes, no memory cost. */
  async listDossierFiles(
    tenderId: string,
    signal?: AbortSignal,
  ): Promise<DossierFileInfo[]> {
    return this.archiveAccess.run(
      () => this.listDossierFilesUnlocked(tenderId, signal),
      signal,
    );
  }

  private async listDossierFilesUnlocked(
    tenderId: string,
    signal?: AbortSignal,
  ): Promise<DossierFileInfo[]> {
    const dossier = await this.ensureDossierUnlocked(tenderId);
    assertDossierArchiveSize(dossier.sizeBytes);
    const r = await fetch(dossier.url, { signal });
    if (!r.ok) {
      throw new ServiceUnavailableException(`Lecture du dossier impossible (HTTP ${r.status})`);
    }
    const zipBuf = await readBoundedResponse(r);

    const files: DossierFileInfo[] = [];
    const budget = createDossierMetadataBudget();
    try {
      unzipSync(zipBuf, {
        filter: (file) => {
          trackDossierEntryMetadata(file, budget);
          if (!file.name.endsWith('/') && file.originalSize > 0) {
            if (files.length >= 2_000) {
              throw new BadRequestException('Archive DCE avec trop de fichiers affichables');
            }
            const leaf = file.name.split('/').pop() ?? file.name;
            files.push({
              name: file.name,
              label: leaf,
              kind: classifyDceFile(file.name),
              sizeBytes: file.originalSize,
            });
          }
          return false; // never inflate; we only need metadata
        },
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        `Archive DCE illisible: ${(err as Error).message}`,
      );
    }
    // Stable order: bordereau/RC/CPS first, then alphabetical.
    files.sort((a, b) => {
      const pa = filePriority(a.label);
      const pb = filePriority(b.label);
      return pa - pb || a.label.localeCompare(b.label);
    });
    return files;
  }

  /**
   * Extracts a single file from the cached DCE ZIP and returns its bytes —
   * powers the "Voir le fichier source" buttons on the BPU/Résumé tabs that
   * mirror datao's same-name link. Idempotent: if the dossier ZIP isn't cached
   * yet it is fetched first via ensureDossier. The lookup is by filename and
   * accepts either the bare leaf ("Bordereau.xlsx") or the full path inside
   * the ZIP ("AO 09 DR4 2026/Bordereau.xlsx") — buyers ship both shapes.
   */
  async acquireDossierFile(
    tenderId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<LeasedDossierFile> {
    const release = await this.payloadAccess.lease(signal);
    try {
      return {
        file: await this.getDossierFile(tenderId, name, signal),
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  private async getDossierFile(
    tenderId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<DossierFileResult> {
    if (!name || name.includes('..') || name.includes('\0')) {
      throw new BadRequestException('Nom de fichier invalide');
    }
    return this.archiveAccess.run(
      () => this.getDossierFileUnlocked(tenderId, name, signal),
      signal,
    );
  }

  private async getDossierFileUnlocked(
    tenderId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<DossierFileResult> {
    // Ensure the ZIP is cached + grab a fresh presigned URL.
    const dossier = await this.ensureDossierUnlocked(tenderId);
    assertDossierArchiveSize(dossier.sizeBytes);
    const r = await fetch(dossier.url, { signal });
    if (!r.ok) {
      throw new ServiceUnavailableException(`Lecture du dossier impossible (HTTP ${r.status})`);
    }
    const zipBuf = await readBoundedResponse(r);

    // First pass reads central-directory metadata only. Size is rejected before
    // the selected entry can allocate its uncompressed buffer.
    const leaf = name.split('/').pop()!.toLowerCase();
    const matches: UnzipFileInfo[] = [];
    const budget = createDossierMetadataBudget();
    try {
      unzipSync(zipBuf, {
        filter: (file) => {
          trackDossierEntryMetadata(file, budget);
          const fileLeaf = file.name.split('/').pop()?.toLowerCase() ?? '';
          if (!file.name.endsWith('/') && (file.name === name || fileLeaf === leaf)) {
            if (matches.length >= 20) {
              throw new BadRequestException('Nom de fichier DCE ambigu');
            }
            matches.push({ ...file });
          }
          return false;
        },
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        `Archive DCE illisible: ${(err as Error).message}`,
      );
    }
    const selected = matches.find((entry) => entry.name === name) ?? matches[0];
    if (!selected) {
      throw new NotFoundException(`Fichier "${name}" introuvable dans le dossier`);
    }
    assertSelectedDossierEntry(selected);

    // Second pass inflates only the already-bounded selected entry.
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(zipBuf, {
        filter: (file) => file.name === selected.name,
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        `Archive DCE illisible: ${(err as Error).message}`,
      );
    }
    const found = entries[selected.name];
    if (!found) {
      throw new NotFoundException(`Fichier "${name}" introuvable dans le dossier`);
    }
    assertDossierEntrySize(found.byteLength);
    return {
      filename: name.split('/').pop()!,
      bytes: Buffer.from(found.buffer, found.byteOffset, found.byteLength),
      mime: mimeForDceFile(selected.name),
    };
  }

  /** Collects a stored-object stream into a UTF-8 string. */
  private async streamToString(
    body: AsyncIterable<Buffer | Uint8Array>,
  ): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * Full-dossier Markdown for the chat agent — the ACTUAL file contents (RC/CPS/
   * BPU article by article, the full bordereau), NOT the budgeted extraction
   * summary. Built once from the DCE archive (the cached zip, or a one-time
   * portal download via ensureDossier) — normalizing RAR→ZIP and reading every
   * data-bearing file's full text with the CHEAP path (pdf-parse + OOXML, no OCR)
   * — then cached in MinIO (dossiers/{id}.md) so later chats are a fast fetch.
   * This is what lets the agent read the real files, even for OLD tenders that
   * were only ever summarized. Returns null on any failure so the chat falls back
   * to the stored excerpt.
   */
  async getDossierMarkdown(tenderId: string): Promise<string | null> {
    const mdKey = `dossiers/${tenderId}.md`;
    // 1) Serve the cached Markdown if we already built it.
    try {
      const obj = await this.storage.getObject(mdKey);
      const md = await this.streamToString(obj.body as AsyncIterable<Buffer | Uint8Array>);
      if (md.trim().length > 0) return md;
    } catch {
      // Not cached yet — build it below.
    }
    // 2) Build from the archive (cached zip, or a one-time portal download).
    try {
      return await this.archiveAccess.run(async () => {
        const dossier = await this.ensureDossierUnlocked(tenderId);
        assertDossierArchiveSize(dossier.sizeBytes);
        const r = await fetch(dossier.url);
        if (!r.ok) return null;
        const archive = await readBoundedResponse(r);
        const zip = await normalizeArchiveToZip(
          new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength),
        );
        const { markdown } = await buildFullDossierMarkdown(
          zip,
          pdfParseExtract,
          defaultBinaryExtractor,
        );
        if (!markdown.trim()) return null;
        await this.storage.put(
          mdKey,
          Buffer.from(markdown, 'utf8'),
          'text/markdown; charset=utf-8',
        );
        this.logger.log(
          `dossier markdown built ${tenderId} → ${markdown.length} chars`,
        );
        return markdown;
      });
    } catch (err) {
      this.logger.warn(
        `getDossierMarkdown failed (${tenderId}): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
