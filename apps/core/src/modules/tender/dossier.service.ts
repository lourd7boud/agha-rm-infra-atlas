import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { unzipSync } from 'fflate';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';

/** Map a file extension to its standard MIME type. Returns octet-stream for
 *  anything unknown so the browser still downloads it safely. */
const MIME_BY_EXT: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pdf: 'application/pdf',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export interface DossierFileResult {
  filename: string;
  bytes: Buffer;
  mime: string;
}

export interface DossierFileInfo {
  /** Full path inside the ZIP (e.g. "AO 09 DR4 2026/Bordereau.xlsx"). */
  name: string;
  /** Display label = bare leaf without the parent folder. */
  label: string;
  /** Coarse kind for the UI viewer (pdf/excel/word/image/other). */
  kind: 'pdf' | 'excel' | 'word' | 'image' | 'other';
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

function kindFor(name: string): DossierFileInfo['kind'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods' || ext === 'csv') return 'excel';
  if (ext === 'docx' || ext === 'doc' || ext === 'odt' || ext === 'rtf') return 'word';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'image';
  return 'other';
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

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Presigned URL to the tender's DCE ZIP; downloads + caches on first call. */
  async ensureDossier(tenderId: string): Promise<DossierResult> {
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
  async listDossierFiles(tenderId: string): Promise<DossierFileInfo[]> {
    const dossier = await this.ensureDossier(tenderId);
    const r = await fetch(dossier.url);
    if (!r.ok) {
      throw new ServiceUnavailableException(`Lecture du dossier impossible (HTTP ${r.status})`);
    }
    const zipBuf = Buffer.from(await r.arrayBuffer());

    const files: DossierFileInfo[] = [];
    try {
      unzipSync(zipBuf, {
        filter: (file) => {
          if (!file.name.endsWith('/') && file.originalSize > 0) {
            const leaf = file.name.split('/').pop() ?? file.name;
            files.push({
              name: file.name,
              label: leaf,
              kind: kindFor(file.name),
              sizeBytes: file.originalSize,
            });
          }
          return false; // never inflate; we only need metadata
        },
      });
    } catch (err) {
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
  async getDossierFile(tenderId: string, name: string): Promise<DossierFileResult> {
    if (!name || name.includes('..') || name.includes('\0')) {
      throw new BadRequestException('Nom de fichier invalide');
    }
    // Ensure the ZIP is cached + grab a fresh presigned URL.
    const dossier = await this.ensureDossier(tenderId);
    const r = await fetch(dossier.url);
    if (!r.ok) {
      throw new ServiceUnavailableException(`Lecture du dossier impossible (HTTP ${r.status})`);
    }
    const zipBuf = Buffer.from(await r.arrayBuffer());

    // Targeted unzip: only inflate the requested file (avoids OOM on big DCEs).
    const leaf = name.split('/').pop()!.toLowerCase();
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(zipBuf, {
        filter: (file) => {
          const fileLeaf = file.name.split('/').pop()?.toLowerCase() ?? '';
          return file.name === name || fileLeaf === leaf;
        },
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Archive DCE illisible: ${(err as Error).message}`,
      );
    }
    // Prefer an exact path match; fall back to the first leaf match.
    const exact = entries[name];
    const found = exact ?? Object.entries(entries).find(([k]) =>
      (k.split('/').pop()?.toLowerCase() ?? '') === leaf,
    )?.[1];
    if (!found) {
      throw new NotFoundException(`Fichier "${name}" introuvable dans le dossier`);
    }
    return {
      filename: name.split('/').pop()!,
      bytes: Buffer.from(found),
      mime: mimeFor(name),
    };
  }
}
