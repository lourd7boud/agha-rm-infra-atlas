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
  resolvePortalFirstAmounts,
  type DossierExtraction,
} from './dossier-extraction';
import { extractBordereauFromDce } from './bordereau-parser';
import {
  TENDER_REPOSITORY,
  type EnrichmentAmounts,
  type TenderRepository,
} from './tender.repository';
import { runPool } from './ai-enrichment';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';
import { normalizeArchiveToZip } from './dossier-archive';
import { toDossierMarkdown, DOSSIER_MARKDOWN_CHARS } from './dossier-markdown';

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
 * How many characters of the DCE's digital text layer we persist alongside the
 * structured extraction (raw.dossierText). This is what lets the per-tender AI
 * chat (TenderChatService) actually READ the dossier prose — article by article,
 * conditions, clauses — instead of only the thin structured summary. Bounded so
 * the JSONB stays reasonable (TOASTed/compressed, never on the /inventory hot
 * path which projects columns and never detoasts `raw`); the chat re-bounds it
 * to its own budget. Only persisted when a real text layer exists (digital DCEs);
 * pure scans keep their structured extraction, which already read the figures.
 */
const DOSSIER_TEXT_EXCERPT_CHARS = 24_000;

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
    // Object storage for the DCE-archive cache: read the cached zip first (so a
    // dead portal link on an OLD tender is not fatal), and persist newly
    // downloaded archives so re-extraction never depends on the portal again.
    // @Optional() so extraction still works (portal-only) when storage is absent.
    @Optional() @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null = null,
  ) {}

  private requireLlm(): LlmClient {
    if (!this.llm) {
      throw new ServiceUnavailableException('LLM non configuré (clé manquante)');
    }
    return this.llm;
  }

  /** Reads all bytes of a stored object (MinIO stream → buffer). */
  private async readObjectBytes(key: string): Promise<Uint8Array> {
    if (!this.storage) throw new Error('no object storage');
    const obj = await this.storage.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  async extractTender(
    id: string,
    // `deep` is set ONLY by the deliberate single-tender "Extraire le DCE"
    // endpoint (never by extractBatch). It also runs the vision OCR supplement
    // when the BPU is still empty and no XLSX/DOCX bordereau was found — e.g. a
    // bordereau embedded as a TABLE INSIDE A SCANNED CPS.pdf, which the cheap
    // text pass (pdf-parse) cannot read at all. Left false in the batch sweep so
    // the 97k-catalogue cost profile is unchanged.
    opts: { force?: boolean; deep?: boolean } = {},
  ): Promise<DossierExtractionResult> {
    const llm = this.requireLlm();
    const tender = await this.repository.findById(id);
    if (!tender) throw new NotFoundException(`Tender not found: ${id}`);

    const existing = readDossierExtraction(tender.raw);
    if (existing && !opts.force) {
      return this.toResult(tender.id, tender.reference, false, existing);
    }

    const ref = parsePortalRef(tender.sourceUrl);

    // Source the DCE archive. Prefer the MinIO-cached copy (from a prior
    // extraction or a "Télécharger le dossier"): OLD/closed tenders often have a
    // DEAD portal link, so re-downloading 404s — the cache lets us (re-)extract
    // anyway. Only hit the portal when there is no cache, and persist what we
    // download so the next run never depends on the portal again.
    const cachedKey =
      tender.raw && typeof tender.raw === 'object'
        ? ((tender.raw as Record<string, unknown>).dossier as
            | { objectKey?: unknown }
            | undefined)?.objectKey
        : undefined;
    let rawBytes: Uint8Array;
    if (typeof cachedKey === 'string' && this.storage) {
      rawBytes = await this.readObjectBytes(cachedKey);
    } else {
      if (!ref) {
        throw new BadRequestException(
          'Aucun lien portail exploitable pour ce marché (sourceUrl manquant)',
        );
      }
      const dossier = await downloadDce(ref, dceIdentityFromEnv());
      rawBytes = dossier.bytes;
      // Persist the archive so a later re-run (or a now-dead portal link) reuses
      // it instead of re-downloading. Best-effort: a cache failure never fails
      // the extraction (we already hold the bytes in memory for this run).
      if (this.storage) {
        try {
          const objectKey = `dossiers/${id}.zip`;
          await this.storage.put(objectKey, Buffer.from(rawBytes), dossier.mime);
          await this.repository.updateEnrichment(id, {}, {
            dossier: {
              objectKey,
              filename: dossier.filename,
              sizeBytes: rawBytes.length,
              downloadedAt: new Date().toISOString(),
            },
          });
        } catch (e) {
          this.logger.warn(
            `dossier cache put failed (${tender.reference}): ${(e as Error).message}`,
          );
        }
      }
    }
    if (rawBytes.length > MAX_DCE_ZIP_BYTES) {
      throw new ServiceUnavailableException(
        `Dossier trop volumineux (${Math.round(rawBytes.length / 1e6)} Mo) — extraction ignorée`,
      );
    }
    // Normalize RAR → ZIP so every downstream ZIP-only reader (text, bordereau,
    // vision) works unchanged; ZIP passes through untouched.
    const archiveBytes = await normalizeArchiveToZip(rawBytes);

    // 1) Fast digital pass — pdf-parse + DOCX text only, NO tesseract (which is
    //    the slow CPU-bound step). Digital DCEs are resolved here cheaply.
    const { text, files } = await extractDossierText(
      archiveBytes,
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
    const bordereau = extractBordereauFromDce(archiveBytes);

    let fresh: DossierExtraction;
    let sourceNames: string[];
    let mode: 'text' | 'vision' | 'text+vision' | 'bordereau-only';
    try {
      if (digitalReadable) {
        // Digital text layer present → cheap text→LLM path (unchanged behaviour).
        mode = 'text';
        sourceNames = files.map((f) => f.name);
        fresh = await aiExtractDossier(llm, text, sourceNames, {
          reference: tender.reference,
          objet: tender.objet,
        });
        // datao-parity: digital DCEs commonly ship a SCANNED Avis (image-only
        // PDF) whose text layer is empty — RC/CPS are text-rich enough for
        // `digitalReadable` to pass, but the budget + caution provisoire live
        // ONLY in that scanned Avis. When text mode returned null for either,
        // run vision as a supplement and merge JUST the financial/timing
        // scalars back. BPU/qualifs/contact stay as text-mode parsed them
        // (those live in RC/CPS, not Avis), so we never regress the deep
        // coverage that already passed. Best-effort: a vision failure here
        // never fails the whole extraction.
        // Portal-first: only spend the (expensive) supplemental vision call when
        // a money figure is STILL missing after text mode AND the portal did not
        // already publish it. When raw.detail/columns already carry estimation +
        // caution, the LLM has nothing to add here — skip the second call.
        const needEstimation =
          fresh.estimationMad == null && tender.estimationMad == null;
        const needCaution =
          fresh.cautionProvisoireMad == null && tender.cautionProvisoireMad == null;
        // Deep mode only: also run vision when the BPU is STILL empty and no
        // XLSX/DOCX bordereau was found — the bordereau is often a table inside a
        // SCANNED CPS.pdf that pdf-parse (text mode) can't read. extractBordereauFromDce
        // only ever returns null or a non-empty list, so this is "no structured bordereau".
        const needBpu =
          !!opts.deep &&
          fresh.bpu.length === 0 &&
          !(bordereau && bordereau.items.length > 0);
        if (needEstimation || needCaution || needBpu) {
          try {
            const vis = await buildVisionInput(archiveBytes);
            if (vis.images.length > 0) {
              const visFresh = await aiExtractDossierVision(
                llm,
                vis.images,
                vis.digitalText,
                vis.sourceFiles,
                { reference: tender.reference, objet: tender.objet },
              );
              fresh = {
                ...fresh,
                estimationMad: fresh.estimationMad ?? visFresh.estimationMad,
                cautionProvisoireMad:
                  fresh.cautionProvisoireMad ?? visFresh.cautionProvisoireMad,
                cautionDefinitivePct:
                  fresh.cautionDefinitivePct ?? visFresh.cautionDefinitivePct,
                retenueGarantiePct:
                  fresh.retenueGarantiePct ?? visFresh.retenueGarantiePct,
                delaiGarantieMois:
                  fresh.delaiGarantieMois ?? visFresh.delaiGarantieMois,
                delaiExecutionMois:
                  fresh.delaiExecutionMois ?? visFresh.delaiExecutionMois,
                chiffreAffairesMinMad:
                  fresh.chiffreAffairesMinMad ?? visFresh.chiffreAffairesMinMad,
                // BPU/qualifications are taken from vision ONLY under needBpu
                // (deep + text-mode found none + no XLSX bordereau). Gating on
                // needBpu — not the money conditions — keeps the batch sweep AND
                // the XLSX-"bordereau wins" override (below) byte-for-byte
                // unchanged: when needBpu holds, `bordereau` is null by
                // construction, so that override stays a no-op here.
                bpu: needBpu && visFresh.bpu.length > 0 ? visFresh.bpu : fresh.bpu,
                qualifications:
                  needBpu && fresh.qualifications.length === 0
                    ? visFresh.qualifications
                    : fresh.qualifications,
              };
              mode = 'text+vision';
              sourceNames = [
                ...new Set([...sourceNames, ...vis.sourceFiles]),
              ];
            }
          } catch (visErr) {
            this.logger.warn(
              `dossier.extract ${tender.reference}: vision supplement failed (${
                (visErr as Error).message
              }) — text-mode result kept`,
            );
          }
        }
      } else {
        // 2) Scanned → VISION path: render pages to images and let the multimodal
        //    model OCR + understand + extract in one call (datao-grade; replaces
        //    the slow tesseract path). Throws only when nothing could be rendered.
        mode = 'vision';
        const vis = await buildVisionInput(archiveBytes);
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

    // Real money onto the columns — PORTAL-FIRST: the DCE only fills a figure the
    // portal detail harvest left empty; it never overwrites a value already on the
    // row. When the DCE disagrees with a portal figure we keep the portal's and
    // just log it (the DCE value is still preserved in raw.dossierExtraction). The
    // full DCE result is always merged into raw so the LLM-only fields survive.
    const amounts: EnrichmentAmounts = resolvePortalFirstAmounts(tender, extraction);
    if (
      tender.estimationMad != null &&
      typeof extraction.estimationMad === 'number' &&
      tender.estimationMad !== extraction.estimationMad
    ) {
      this.logger.log(
        `dossier.extract ${tender.reference}: portail garde estimation ${tender.estimationMad} ` +
          `(DCE proposait ${extraction.estimationMad})`,
      );
    }
    // Persist a bounded slice of the DCE digital text layer so the per-tender AI
    // chat can READ the dossier prose (not just the structured summary). Only when
    // a real text layer exists (`text` is empty for pure scans, where the vision
    // path already captured the figures) — an empty excerpt must never clobber a
    // richer one a prior digital extraction stored.
    const dossierTextExcerpt = text.trim().slice(0, DOSSIER_TEXT_EXCERPT_CHARS);
    // Markdown view of the SAME extracted text (## per-file headers, GFM tables
    // for the bordereau) — what the chat agent reads best. Larger budget than the
    // plain excerpt since it is the primary dossier context for the agent.
    const dossierMarkdown = toDossierMarkdown(text).slice(0, DOSSIER_MARKDOWN_CHARS);
    await this.repository.updateEnrichment(id, amounts, {
      dossierExtraction: extraction,
      ...(dossierTextExcerpt.length > 0 ? { dossierText: dossierTextExcerpt } : {}),
      ...(dossierMarkdown.length > 0 ? { dossierMarkdown } : {}),
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
          // NEVER pass deep:true here — deep runs an extra vision OCR call per
          // BPU-empty dossier, which over the 97k-catalogue sweep would blow the
          // LLM budget. Deep is reserved for the deliberate single-tender endpoint.
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
