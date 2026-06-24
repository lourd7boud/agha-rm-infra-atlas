import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import {
  dceIdentityFromEnv,
  downloadDce,
  parsePortalRef,
} from '../watch/dossier.crawler';
import {
  extractDossierText,
  MIN_READABLE_FILE_CHARS,
  MIN_READABLE_TOTAL_CHARS,
} from './dossier-text';
import {
  aiExtractDossier,
  readDossierExtraction,
  type DossierExtraction,
} from './dossier-extraction';
import {
  TENDER_REPOSITORY,
  type EnrichmentAmounts,
  type TenderRepository,
} from './tender.repository';
import { runPool } from './ai-enrichment';

export interface DossierExtractionResult {
  tenderId: string;
  reference: string;
  /** false when an existing extraction was reused (idempotent skip). */
  extracted: boolean;
  estimationMad: number | null;
  cautionProvisoireMad: number | null;
  bpuCount: number;
  qualifications: number;
  files: string[];
}

export interface DossierExtractionBatchResult {
  candidates: number;
  succeeded: number;
  failed: number;
  failedIds: string[];
}

/**
 * Concurrency: each item runs the 4-step portal retrait (~MBs) + a PDF parse +
 * an LLM call. Kept modest so the government portal stays polite and memory
 * stays bounded (no zip is cached to disk — extraction is in-memory only).
 * Tunable via DOSSIER_EXTRACT_CONCURRENCY (1–16) so a full-catalogue sweep can
 * be sped up or throttled without a redeploy; defaults to 4.
 */
const EXTRACT_CONCURRENCY = (() => {
  const n = Number(process.env.DOSSIER_EXTRACT_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 && n <= 16 ? Math.floor(n) : 4;
})();

/** Hard ceiling on a downloaded DCE before we even unzip (OOM guard). */
const MAX_DCE_ZIP_BYTES = 120 * 1024 * 1024;

/**
 * Merges a fresh extraction over a previous one so a forced re-run can only
 * improve, never regress: each scalar keeps the fresh value or falls back to the
 * prior, and a now-empty BPU/qualifications list never clobbers a richer stored
 * one (a transient thinner parse must not destroy real DCE line items).
 */
function mergeExtractions(
  prev: DossierExtraction,
  next: DossierExtraction,
): DossierExtraction {
  return {
    ...next,
    estimationMad: next.estimationMad ?? prev.estimationMad ?? null,
    cautionProvisoireMad: next.cautionProvisoireMad ?? prev.cautionProvisoireMad ?? null,
    cautionDefinitivePct: next.cautionDefinitivePct ?? prev.cautionDefinitivePct ?? null,
    retenueGarantiePct: next.retenueGarantiePct ?? prev.retenueGarantiePct ?? null,
    delaiGarantieMois: next.delaiGarantieMois ?? prev.delaiGarantieMois ?? null,
    delaiExecutionMois: next.delaiExecutionMois ?? prev.delaiExecutionMois ?? null,
    chiffreAffairesMinMad: next.chiffreAffairesMinMad ?? prev.chiffreAffairesMinMad ?? null,
    bpu: next.bpu.length > 0 ? next.bpu : prev.bpu,
    qualifications: next.qualifications.length > 0 ? next.qualifications : prev.qualifications,
  };
}

/**
 * The datao-grade layer: downloads a tender's DCE, reads the RC/CPS/BPU text and
 * has the LLM pull the hard facts (the maître d'ouvrage's cost estimate, the
 * cautions, qualifications and BPU). The dossier is processed in memory and
 * discarded — only the small extraction is persisted (real budget/caution onto
 * the columns, the rest into raw.dossierExtraction). Télécharger keeps its own
 * MinIO cache; extraction never bloats disk.
 */
@Injectable()
export class DossierExtractionService {
  private readonly logger = new Logger('DossierExtraction');
  private batchRunning = false;

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly repository: TenderRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
  ) {}

  private requireLlm(): LlmClient {
    if (!this.llm) {
      throw new ServiceUnavailableException('LLM non configuré (clé manquante)');
    }
    return this.llm;
  }

  async extractTender(
    id: string,
    opts: { force?: boolean } = {},
  ): Promise<DossierExtractionResult> {
    const llm = this.requireLlm();
    const tender = await this.repository.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);

    const existing = readDossierExtraction(tender.raw);
    if (existing && !opts.force) {
      return this.toResult(tender.id, tender.reference, false, existing);
    }

    const ref = parsePortalRef(tender.sourceUrl);
    if (!ref) {
      throw new BadRequestException(
        'Aucun lien portail exploitable pour ce marché (sourceUrl manquant)',
      );
    }

    // In-memory download — NOT cached to MinIO, so a full-catalogue sweep never
    // accumulates ~40 GB of zips on the shared VPS disk.
    const dossier = await downloadDce(ref, dceIdentityFromEnv());
    if (dossier.bytes.length > MAX_DCE_ZIP_BYTES) {
      throw new ServiceUnavailableException(
        `Dossier trop volumineux (${Math.round(dossier.bytes.length / 1e6)} Mo) — extraction ignorée`,
      );
    }
    const { text, files } = await extractDossierText(dossier.bytes);
    // Mass-based readability gate: anything below the total threshold OR with
    // no single file above the per-file floor is essentially a scanned dossier
    // whose text layer is empty (pdf-parse returns only the page sentinel).
    // Without this, we used to persist a "successful" all-null extraction that
    // blocked the row from ever being retried by the batch.
    const biggestFileChars = files.reduce((m, f) => Math.max(m, f.chars), 0);
    const looksReadable =
      text.length >= MIN_READABLE_TOTAL_CHARS &&
      biggestFileChars >= MIN_READABLE_FILE_CHARS;
    if (!looksReadable) {
      throw new ServiceUnavailableException(
        `Dossier sans texte exploitable (${text.length} chars, plus gros fichier ${biggestFileChars} — PDF probablement scanné, OCR requis)`,
      );
    }

    const fresh = await aiExtractDossier(
      llm,
      text,
      files.map((f) => f.name),
      { reference: tender.reference, objet: tender.objet },
    );
    // A forced re-run must never regress a previously richer extraction.
    const extraction = existing ? mergeExtractions(existing, fresh) : fresh;

    // Real money onto the columns — only when a corroborated figure was found
    // (never null, which would also crash .toString()). The dossier's RC figure
    // is the authoritative estimation, so it wins; log when it replaces a value.
    const amounts: EnrichmentAmounts = {};
    if (typeof extraction.estimationMad === 'number') {
      amounts.estimationMad = extraction.estimationMad;
    }
    if (typeof extraction.cautionProvisoireMad === 'number') {
      amounts.cautionProvisoireMad = extraction.cautionProvisoireMad;
    }
    if (
      tender.estimationMad != null &&
      amounts.estimationMad != null &&
      tender.estimationMad !== amounts.estimationMad
    ) {
      this.logger.warn(
        `dossier.extract ${tender.reference}: estimation ${tender.estimationMad} → ${amounts.estimationMad} (valeur DCE)`,
      );
    }
    await this.repository.updateEnrichment(id, amounts, {
      dossierExtraction: extraction,
    });

    this.logger.log(
      `dossier.extract ${tender.reference} → budget ${extraction.estimationMad ?? '—'} MAD, ` +
        `caution ${extraction.cautionProvisoireMad ?? '—'}, ${extraction.bpu.length} BPU, ` +
        `${extraction.qualifications.length} qualif (${files.map((f) => f.name).join(', ')})`,
    );
    return this.toResult(
      tender.id,
      tender.reference,
      true,
      extraction,
      files.map((f) => f.name),
    );
  }

  /**
   * Bulk dossier extraction. Skips tenders already extracted (unless force),
   * defaults to active (future-deadline) consultations, bounded concurrency,
   * per-tender failures logged and skipped. Single-flight to cap portal load.
   */
  async extractBatch(
    limit: number,
    opts: { onlyActive?: boolean; force?: boolean } = {},
  ): Promise<DossierExtractionBatchResult> {
    this.requireLlm();
    if (this.batchRunning) {
      throw new ConflictException('Une extraction par lot est déjà en cours');
    }
    this.batchRunning = true;
    try {
      const onlyActive = opts.onlyActive ?? true;
      const now = Date.now();
      const all = await this.repository.findAll();
      const pending = all
        .filter((t) => t.sourceUrl)
        .filter((t) => opts.force || !readDossierExtraction(t.raw))
        .filter((t) => !onlyActive || t.deadlineAt.getTime() >= now)
        .slice(0, Math.max(0, Math.floor(limit)));

      let succeeded = 0;
      const failedIds: string[] = [];
      await runPool(pending, EXTRACT_CONCURRENCY, async (t) => {
        try {
          await this.extractTender(t.id, { force: opts.force });
          succeeded += 1;
        } catch (error) {
          failedIds.push(t.id);
          this.logger.warn(
            `dossier.extract failed ${t.reference}: ${(error as Error).message}`,
          );
        }
      });

      this.logger.log(
        `dossier.extract.batch candidates=${pending.length} ok=${succeeded} ko=${failedIds.length}`,
      );
      return {
        candidates: pending.length,
        succeeded,
        failed: failedIds.length,
        failedIds,
      };
    } finally {
      this.batchRunning = false;
    }
  }

  private toResult(
    tenderId: string,
    reference: string,
    extracted: boolean,
    extraction: DossierExtraction,
    files: string[] = extraction.sourceFiles,
  ): DossierExtractionResult {
    return {
      tenderId,
      reference,
      extracted,
      estimationMad: extraction.estimationMad ?? null,
      cautionProvisoireMad: extraction.cautionProvisoireMad ?? null,
      bpuCount: extraction.bpu.length,
      qualifications: extraction.qualifications.length,
      files,
    };
  }
}
