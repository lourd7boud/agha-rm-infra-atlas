import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';
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
}
