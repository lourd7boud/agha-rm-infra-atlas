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
import { pdfParseExtract } from './pdf-ocr';
import { defaultBinaryExtractor } from './dossier-binary';
import { buildVisionInput } from './dossier-vision';
import {
  aiExtractDossier,
  aiExtractDossierVision,
  readDossierExtraction,
  type DossierExtraction,
} from './dossier-extraction';
import { extractBordereauFromDce } from './bordereau-parser';
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

/** After a failed extraction we stamp raw.dossierExtractAttempt so the batch
 *  stops re-picking the SAME unreadable dossiers first on every sweep (that
 *  clog wasted ~60% of capacity and pinned coverage at ~6%). The row becomes
 *  eligible again only after this cooldown — long enough to drain the backlog,
 *  short enough that a later pipeline improvement (e.g. better OCR) retries it. */
const EXTRACT_ATTEMPT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** True when a stored extraction predates the datao-form fields (contact /
 *  conditionsLegales / autres). Detected by the absence of the 'autres' key in
 *  the RAW JSON — not the zod-parsed object, whose .default([]) would mask it.
 *  Drives the --upgrade pass: re-extract such rows to fill the new sections. */
function lacksDatoFields(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const de = (raw as Record<string, unknown>)['dossierExtraction'];
  return !!de && typeof de === 'object' && !('autres' in (de as object));
}

/** True when a prior extraction attempt failed within the cooldown window. */
function attemptedRecently(raw: unknown, now: number): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const a = (raw as Record<string, unknown>)['dossierExtractAttempt'] as
    | { at?: string }
    | undefined;
  if (!a?.at) return false;
  const t = Date.parse(a.at);
  return Number.isFinite(t) && now - t < EXTRACT_ATTEMPT_COOLDOWN_MS;
}

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
    contact: next.contact ?? prev.contact ?? null,
    conditionsLegales:
      next.conditionsLegales.length > 0 ? next.conditionsLegales : prev.conditionsLegales,
    autres: next.autres.length > 0 ? next.autres : prev.autres,
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
    // 1) Fast digital pass — pdf-parse + DOCX text only, NO tesseract (which is
    //    the slow CPU-bound step). Digital DCEs are resolved here cheaply.
    const { text, files } = await extractDossierText(
      dossier.bytes,
      pdfParseExtract,
      defaultBinaryExtractor,
    );
    const biggestFileChars = files.reduce((m, f) => Math.max(m, f.chars), 0);
    const digitalReadable =
      text.length >= MIN_READABLE_TOTAL_CHARS &&
      biggestFileChars >= MIN_READABLE_FILE_CHARS;

    // 1b) datao-grade BPU: parse the Bordereau.xlsx directly when the DCE ships
    //     one. Done BEFORE the LLM call so the prompt isn't a confounding
    //     variable — the structured rows are the ground truth and replace any
    //     LLM-paraphrased BPU below. Cheap (~ms) and never throws — null when
    //     no XLSX bordereau is in the archive.
    const bordereau = extractBordereauFromDce(dossier.bytes);

    let fresh: DossierExtraction;
    let sourceNames: string[];
    let mode: 'text' | 'vision' | 'bordereau-only';
    try {
      if (digitalReadable) {
        // Digital text layer present → cheap text→LLM path (unchanged behaviour).
        mode = 'text';
        sourceNames = files.map((f) => f.name);
        fresh = await aiExtractDossier(llm, text, sourceNames, {
          reference: tender.reference,
          objet: tender.objet,
        });
      } else {
        // 2) Scanned → VISION path: render pages to images and let the multimodal
        //    model OCR + understand + extract in one call (datao-grade; replaces
        //    the slow tesseract path). Throws only when nothing could be rendered.
        mode = 'vision';
        const vis = await buildVisionInput(dossier.bytes);
        if (vis.images.length === 0) {
          throw new ServiceUnavailableException(
            `Dossier illisible (aucun texte ni page rendue) — ${files.length} fichiers`,
          );
        }
        sourceNames = vis.sourceFiles;
        fresh = await aiExtractDossierVision(llm, vis.images, vis.digitalText, vis.sourceFiles, {
          reference: tender.reference,
          objet: tender.objet,
        });
      }
    } catch (llmError) {
      // Bordereau-only fallback: when the LLM is unavailable (rate-limited,
      // timed out, schema invalid…) BUT the DCE ships a structured XLSX
      // bordereau, persist the BPU alone rather than aborting the whole
      // extraction. We lose the LLM-only fields (budget/caution/qualifs) for
      // now — they stay null and become eligible for a retry once the LLM is
      // back — but we keep the deepest, source-of-truth data we have. Without
      // this guard a single LLM outage drops EVERY extraction including
      // tenders whose BPU we could read without an AI call at all.
      if (bordereau && bordereau.items.length > 0) {
        this.logger.warn(
          `dossier.extract ${tender.reference}: LLM unavailable (${(llmError as Error).message}) — ` +
            `persisting bordereau-only (${bordereau.items.length} items from ${bordereau.fileName})`,
        );
        mode = 'bordereau-only';
        sourceNames = [bordereau.fileName];
        fresh = {
          estimationMad: null,
          cautionProvisoireMad: null,
          cautionDefinitivePct: null,
          retenueGarantiePct: null,
          delaiGarantieMois: null,
          delaiExecutionMois: null,
          chiffreAffairesMinMad: null,
          qualifications: [],
          bpu: bordereau.items,
          contact: null,
          conditionsLegales: [],
          autres: [],
          model: 'bordereau-xlsx-direct',
          extractedAt: new Date().toISOString(),
          sourceFiles: [bordereau.fileName],
        };
      } else {
        throw llmError;
      }
    }
    // Direct XLSX bordereau wins when it carries MORE items than the LLM read —
    // it never paraphrases, never drops rows on long BPUs, and the unit codes
    // (E/U/ML/M2/KG…) are the source's, not the model's interpretation. When
    // the XLSX returns fewer items than the LLM (e.g. some buyers ship a tiny
    // template alongside a richer estimatif inside the CPS), the LLM result is
    // kept so we never regress coverage. Skipped when we already fell back to
    // bordereau-only above — its BPU is already in `fresh.bpu`.
    if (
      mode !== 'bordereau-only' &&
      bordereau &&
      bordereau.items.length > fresh.bpu.length
    ) {
      this.logger.log(
        `dossier.extract ${tender.reference}: BPU from ${bordereau.fileName} ` +
          `(${bordereau.items.length} rows, ${bordereau.sheetsRead} sheet${bordereau.sheetsRead === 1 ? '' : 's'}) ` +
          `replaces LLM (${fresh.bpu.length})`,
      );
      fresh = { ...fresh, bpu: bordereau.items };
      if (!sourceNames.includes(bordereau.fileName)) {
        sourceNames = [...sourceNames, bordereau.fileName];
      }
    }

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
      `dossier.extract[${mode}] ${tender.reference} → budget ${extraction.estimationMad ?? '—'} MAD, ` +
        `caution ${extraction.cautionProvisoireMad ?? '—'}, ${extraction.bpu.length} BPU, ` +
        `${extraction.qualifications.length} qualif (${sourceNames.join(', ')})`,
    );
    return this.toResult(tender.id, tender.reference, true, extraction, sourceNames);
  }

  /**
   * Bulk dossier extraction. Skips tenders already extracted (unless force),
   * defaults to active (future-deadline) consultations, bounded concurrency,
   * per-tender failures logged and skipped. Single-flight to cap portal load.
   */
  async extractBatch(
    limit: number,
    opts: {
      onlyActive?: boolean;
      force?: boolean;
      /** 'upgrade': also re-extract rows whose stored extraction predates the
       *  datao-form fields (contact/conditionsLegales/autres) — used by the
       *  distributed backfill worker to bring the whole catalogue to schema v2. */
      upgrade?: boolean;
      /** Processing order. 'oldest' lets a second worker drain from the far end
       *  while the server drains 'newest', so the two converge without clashing. */
      order?: 'newest' | 'oldest';
    } = {},
  ): Promise<DossierExtractionBatchResult> {
    this.requireLlm();
    if (this.batchRunning) {
      throw new ConflictException('Une extraction par lot est déjà en cours');
    }
    this.batchRunning = true;
    try {
      const onlyActive = opts.onlyActive ?? true;
      const now = Date.now();
      // upgrade implies force at the per-tender level (re-extract + merge).
      const forceLike = !!opts.force || !!opts.upgrade;
      const all = await this.repository.findAll();
      const pending = all
        .filter((t) => t.sourceUrl)
        // Candidate when: forced, OR never extracted (backlog), OR (upgrade and
        // the stored extraction lacks the new datao fields).
        .filter(
          (t) =>
            opts.force ||
            !readDossierExtraction(t.raw) ||
            (opts.upgrade && lacksDatoFields(t.raw)),
        )
        // Skip dossiers whose last extraction attempt failed recently — keeps
        // the same unreadable scans from monopolising every sweep's slots.
        .filter((t) => forceLike || !attemptedRecently(t.raw, now))
        .filter((t) => !onlyActive || t.deadlineAt.getTime() >= now)
        // Default newest-first so a freshly-crawled tender is analysed within
        // the same sweep (datao-style "filled the moment it drops"). A worker
        // can pass order:'oldest' to drain the historical end instead.
        .sort((a, b) =>
          opts.order === 'oldest'
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, Math.max(0, Math.floor(limit)));

      let succeeded = 0;
      const failedIds: string[] = [];
      await runPool(pending, EXTRACT_CONCURRENCY, async (t) => {
        try {
          await this.extractTender(t.id, { force: forceLike });
          succeeded += 1;
        } catch (error) {
          failedIds.push(t.id);
          this.logger.warn(
            `dossier.extract failed ${t.reference}: ${(error as Error).message}`,
          );
          // Stamp the attempt so this row drops out of the candidate set for
          // the cooldown window instead of being re-picked first next sweep.
          try {
            await this.repository.updateEnrichment(t.id, {}, {
              dossierExtractAttempt: { at: new Date().toISOString() },
            });
          } catch {
            /* a marker write failure must not fail the batch */
          }
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
