import {
  BadRequestException,
  ConflictException,
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
import { createHash } from 'node:crypto';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';
import type { SamirArchiveEvidence } from './samir-review';
import { inspectDossierFile } from './dossier-file-evidence';
import { runDossierFileOcr, projectDossierFileOcr, readCachedDossierFileOcr } from './dossier-file-ocr';
import { dossierDecisionFileKind, extractDossierDecisionExcerpts } from './dossier-decision-evidence';
import { checkDossierRevision, comparedArchiveSha256, readSavedDossierRevision } from './dossier-revision-check';
import { normalizeArchiveToZip } from './dossier-archive';
import { buildFullDossierMarkdown, DOSSIER_COVERAGE_MARKER, readDossierCoverage, type CoverageState } from './dossier-fulltext';
import { pdfParseExtract } from './pdf-ocr';
import { defaultBinaryExtractor } from './dossier-binary';
import {
  assertDossierArchiveSize,
  assertDossierEntrySize,
  assertSelectedDossierEntry,
  createDossierMetadataBudget,
  DossierArchiveAccessGate,
  MAX_DOSSIER_ARCHIVE_BYTES,
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

interface DossierFileOptions {
  cachedOnly?: boolean;
  expectedSha256?: string;
}

export interface DossierFileInfo {
  /** Full path inside the ZIP (e.g. "AO 09 DR4 2026/Bordereau.xlsx"). */
  name: string;
  /** Display label = bare leaf without the parent folder. */
  label: string;
  /** Coarse kind for the UI viewer (pdf/excel/word/image/other). */
  kind: DceFileKind;
  sizeBytes: number;
  /** Saved extraction state, attached only when its ZIP fingerprint matches. */
  readability?: CoverageState;
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
  private readonly ocrAccess = new DossierArchiveAccessGate(1, 1);
  private readonly revisionAccess = new DossierArchiveAccessGate(1, 1);

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Local-only evidence check. Never enters the live portal download flow. */
  async inspectCachedArchive(tenderId: string, raw: Record<string, unknown> | null, comparedSha256?: string): Promise<SamirArchiveEvidence> {
    if (raw?.dossier == null) return { state: 'not_cached' };
    const meta = readDossierMeta(raw);
    if (!meta || meta.objectKey !== `dossiers/${tenderId}.zip` || !meta.filename.trim() ||
        !Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0 ||
        !Number.isFinite(Date.parse(meta.downloadedAt)) || Date.parse(meta.downloadedAt) > Date.now()) {
      return { state: 'unavailable' };
    }
    const cached = { filename: meta.filename, cachedAt: meta.downloadedAt };
    try {
      const present = await this.storage.exists(meta.objectKey, AbortSignal.timeout(1500));
      if (!present) return { state: 'missing_object', ...cached };
    } catch {
      return { state: 'unavailable' };
    }
    if (!comparedSha256) return { state: 'available', ...cached };
    try {
      const integrity = await this.payloadAccess.run(async () => {
        const signal = AbortSignal.timeout(2500);
        const archive = await this.storage.getObject(meta.objectKey, signal);
        const abort = () => archive.body.destroy();
        signal.addEventListener('abort', abort, { once: true });
        try {
          signal.throwIfAborted();
          if (archive.sizeBytes !== undefined) assertDossierArchiveSize(archive.sizeBytes);
          const digest = createHash('sha256');
          let length = 0;
          for await (const chunk of archive.body) {
            signal.throwIfAborted();
            length += chunk.byteLength;
            if (length > MAX_DOSSIER_ARCHIVE_BYTES) throw new Error('Archive limit exceeded');
            digest.update(chunk);
          }
          signal.throwIfAborted();
          return length === meta.sizeBytes && digest.digest('hex') === comparedSha256 ? 'matched' : 'mismatch';
        } finally {
          signal.removeEventListener('abort', abort);
          archive.body.destroy();
        }
      }, AbortSignal.timeout(3000));
      return { state: 'available', ...cached, integrity };
    } catch {
      return { state: 'available', ...cached, integrity: 'unavailable' };
    }
  }

  async inspectCachedFile(tenderId: string, name: string, signal?: AbortSignal) {
    const leased = await this.acquireDossierFile(tenderId, name, signal, { cachedOnly: true });
    try {
      const evidence = await inspectDossierFile(leased.file.bytes, leased.file.filename, { signal });
      const ocr = await this.readSavedFileOcr(tenderId, evidence.sha256, leased.file.filename);
      return { ...evidence, ...(ocr ? { ocr: projectDossierFileOcr(ocr) } : {}) };
    } finally {
      leased.release();
    }
  }

  private fileOcrKey(tenderId: string, sha: string, filename: string): string {
    const leaf = filename.split('/').pop() ?? filename;
    const nameHash = createHash('sha256').update(leaf).digest('hex').slice(0, 16);
    return `dossiers/${tenderId}/ocr/${sha}-${nameHash}.json`;
  }

  async savedRevision(tenderId: string) {
    const tender = await this.tenders.findById(tenderId);
    if (!tender) throw new NotFoundException('Marché introuvable');
    const revision = readSavedDossierRevision(tender.raw, tender.sourceUrl);
    const comparedSha256 = comparedArchiveSha256(revision);
    if (revision && comparedSha256) {
      const archive = await this.inspectCachedArchive(tenderId, tender.raw, comparedSha256);
      if (archive.state !== 'available' || archive.integrity !== 'matched') return {
        version: revision.version, officialIdentity: revision.officialIdentity, checkedAt: revision.checkedAt,
        state: 'unavailable' as const, reason: 'archive_unverified' as const,
        ...(revision.mode ? { mode: revision.mode } : {}),
        changedFiles: [], addedFiles: [], removedFiles: [],
      };
    }
    return revision ?? { state: 'not_checked' as const };
  }

  /** Read only existing OCR for the RC and CPS in the currently saved archive. */
  async decisionExcerpts(tenderId: string, signal?: AbortSignal) {
    return this.archiveAccess.run(async () => {
      const dossier = await this.getCachedDossier(tenderId);
      assertDossierArchiveSize(dossier.sizeBytes);
      const response = await fetch(dossier.url, { signal });
      if (!response.ok) throw new ServiceUnavailableException('Archive DCE indisponible');
      const archive = await readBoundedResponse(response);
      const metadata = createDossierMetadataBudget();
      const candidates: UnzipFileInfo[] = [];
      const counts = new Map<string, number>();
      unzipSync(archive, { filter: file => {
        trackDossierEntryMetadata(file, metadata);
        if (dossierDecisionFileKind(file.name)) {
          candidates.push(file);
          counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
        }
        return false;
      } });
      candidates.sort((a, b) => Number(dossierDecisionFileKind(b.name) === 'rc') - Number(dossierDecisionFileKind(a.name) === 'rc') || a.name.localeCompare(b.name));
      const selected = candidates.filter(candidate => counts.get(candidate.name) === 1).slice(0, 4);
      const names = new Set<string>();
      for (const file of selected) {
        try { assertSelectedDossierEntry(file); names.add(file.name); }
        catch { /* A selected PDF exceeding the viewer limits cannot have usable OCR. */ }
      }
      const entries = unzipSync(archive, { filter: file => names.has(file.name) });
      const records = [];
      for (const name of names) {
        signal?.throwIfAborted();
        const bytes = Object.hasOwn(entries, name) ? entries[name] : undefined;
        if (!bytes) continue;
        const ocr = await this.readSavedFileOcr(tenderId, createHash('sha256').update(bytes).digest('hex'), name);
        if (ocr && ocr.state !== 'failed') records.push({ ...ocr, filename: name });
      }
      return { excerpts: extractDossierDecisionExcerpts(records) };
    }, signal);
  }

  async checkRevision(tenderId: string, signal?: AbortSignal, usePortalAccount = false) {
    return this.revisionAccess.run(() => checkDossierRevision(tenderId, {
      tenders: this.tenders, storage: this.storage, usePortalAccount,
      commit: operation => this.archiveAccess.run(operation),
    }, signal), signal);
  }

  private async readSavedFileOcr(tenderId: string, sha: string, filename: string) {
    const leaf = filename.split('/').pop() ?? filename;
    try {
      const object = await this.storage.getObject(this.fileOcrKey(tenderId, sha, leaf));
      const text = await this.streamToString(object.body as AsyncIterable<Buffer | Uint8Array>);
      return readCachedDossierFileOcr(JSON.parse(text), sha, leaf);
    } catch { return null; }
  }

  /** Explicit local OCR of a saved source. It never invokes the portal or an LLM. */
  async ocrCachedFile(tenderId: string, name: string, signal?: AbortSignal) {
    return this.ocrAccess.run(async () => {
      const leased = await this.acquireDossierFile(tenderId, name, signal, { cachedOnly: true });
      const file = leased.file;
      leased.release(); // OCR has a separate gate and must not block document viewing.
      const sha = createHash('sha256').update(file.bytes).digest('hex');
      const saved = await this.readSavedFileOcr(tenderId, sha, file.filename);
      const result = saved && saved.state !== 'failed'
        ? saved : await runDossierFileOcr(file.bytes, file.filename, { signal });
      if (!saved || saved.state === 'failed') {
        const json = Buffer.from(JSON.stringify(result), 'utf8');
        if (json.byteLength > 2 * 1024 * 1024) throw new ServiceUnavailableException('Résultat OCR trop volumineux');
        await this.storage.put(this.fileOcrKey(tenderId, sha, file.filename), json, 'application/json');
      }
      if (result.state !== 'failed') {
        // A build already in flight must finish before its derived cache is invalidated.
        await this.archiveAccess.run(() => this.storage.delete(`dossiers/${tenderId}.md`));
      }
      return projectDossierFileOcr(result);
    }, signal);
  }

  private async getCachedDossier(tenderId: string): Promise<DossierResult> {
    const tender = await this.tenders.findById(tenderId);
    if (!tender) throw new NotFoundException('Marché introuvable');
    if (tender.raw?.dossier == null) throw new NotFoundException('Archive DCE absente');
    const evidence = await this.inspectCachedArchive(tenderId, tender.raw);
    const meta = readDossierMeta(tender.raw);
    if (evidence.state === 'unavailable') throw new ServiceUnavailableException('Vérification de l’archive indisponible');
    if (evidence.state !== 'available' || !meta) throw new NotFoundException('Archive DCE absente');
    return {
      url: await this.storage.presignedGetUrl(meta.objectKey),
      filename: meta.filename,
      sizeBytes: meta.sizeBytes,
      cached: true,
    };
  }

  /** Presigned URL to the tender's DCE ZIP; downloads + caches on first call. */
  async ensureDossier(tenderId: string, signal?: AbortSignal): Promise<DossierResult> {
    return this.archiveAccess.run(() => this.ensureDossierUnlocked(tenderId, signal), signal);
  }

  private async ensureDossierUnlocked(tenderId: string, signal?: AbortSignal): Promise<DossierResult> {
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

    // This method already holds archiveAccess; reuse the source guard and
    // anonymous mode without reacquiring that same commit gate.
    const revision = await checkDossierRevision(tenderId, {
      tenders: this.tenders, storage: this.storage, commit: operation => operation(),
    }, signal);
    if (revision.state === 'unavailable') throw new ServiceUnavailableException('DCE officiel indisponible. Consultez le contrôle de version pour le motif et la prochaine vérification.');
    const refreshed = await this.tenders.findById(tenderId);
    const meta = readDossierMeta(refreshed?.raw ?? null);
    if (!meta) throw new ServiceUnavailableException('Archive DCE non conservée');
    return {
      url: await this.storage.presignedGetUrl(meta.objectKey),
      filename: meta.filename,
      sizeBytes: meta.sizeBytes,
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
    const dossier = await this.ensureDossierUnlocked(tenderId, signal);
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
    try {
      const saved = await this.storage.getObject(`dossiers/${tenderId}.md`);
      const markdown = await this.streamToString(saved.body as AsyncIterable<Buffer | Uint8Array>);
      const coverage = readDossierCoverage(markdown, createHash('sha256').update(zipBuf).digest('hex'));
      if (coverage) for (const file of files) file.readability = coverage.get(file.name);
    } catch {
      // No valid saved coverage: the viewer keeps the file explicitly unverified.
    }
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
    options: DossierFileOptions = {},
  ): Promise<LeasedDossierFile> {
    const release = await this.payloadAccess.lease(signal);
    try {
      return {
        file: await this.getDossierFile(tenderId, name, signal, options),
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
    options: DossierFileOptions = {},
  ): Promise<DossierFileResult> {
    if (!name || name.includes('..') || name.includes('\0')) {
      throw new BadRequestException('Nom de fichier invalide');
    }
    if (options.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedSha256)) {
      throw new BadRequestException('Empreinte du fichier invalide');
    }
    return this.archiveAccess.run(
      () => this.getDossierFileUnlocked(tenderId, name, signal, options),
      signal,
    );
  }

  private async getDossierFileUnlocked(
    tenderId: string,
    name: string,
    signal?: AbortSignal,
    options: DossierFileOptions = {},
  ): Promise<DossierFileResult> {
    // Ensure the ZIP is cached + grab a fresh presigned URL.
    const dossier = options.cachedOnly || options.expectedSha256
      ? await this.getCachedDossier(tenderId)
      : await this.ensureDossierUnlocked(tenderId, signal);
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
          if (!file.name.endsWith('/') && (file.name === name || (!options.expectedSha256 && fileLeaf === leaf))) {
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
    if (options.expectedSha256 && matches.length > 1) throw new ConflictException('Source DCE ambiguë');
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
    const found = Object.hasOwn(entries, selected.name) ? entries[selected.name] : undefined;
    if (!found) {
      throw new NotFoundException(`Fichier "${name}" introuvable dans le dossier`);
    }
    assertDossierEntrySize(found.byteLength);
    if (options.expectedSha256 && createHash('sha256').update(found).digest('hex') !== options.expectedSha256) {
      throw new ConflictException('La source a changé. Rouvrez la fiche pour actualiser les extraits.');
    }
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
    let bytes = 0;
    for await (const chunk of body) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new ServiceUnavailableException('Texte DCE conservé trop volumineux');
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
   * — then cached in MinIO (dossiers/{id}.md). New caches include file coverage.
   * Legacy Markdown is rebuilt only from a saved ZIP; absent or unavailable ZIPs
   * retain their old text with explicit unverified coverage, without acquisition.
   * Otherwise returns null on failure so chat can fall back to its saved excerpt.
   */
  async getDossierMarkdown(tenderId: string): Promise<string | null> {
    const mdKey = `dossiers/${tenderId}.md`;
    let legacyMarkdown: string | null = null;
    const fallback = () => legacyMarkdown
      ? `COUVERTURE NON VÉRIFIÉE — CACHE ANCIEN\nLes fichiers et pages absents de ces extraits restent à vérifier. Version officielle actuelle non confirmée.\n\n${legacyMarkdown}`
      : null;
    // 1) Serve the cached Markdown if we already built it.
    try {
      const obj = await this.storage.getObject(mdKey);
      const md = await this.streamToString(obj.body as AsyncIterable<Buffer | Uint8Array>);
      if (md.trim().length > 0) {
        if (md.startsWith(DOSSIER_COVERAGE_MARKER)) return md;
        legacyMarkdown = md;
      }
    } catch {
      // Not cached yet — build it below.
    }
    // 2) Build from the archive (cached zip, or a one-time portal download).
    try {
      return await this.archiveAccess.run(async () => {
        const dossier = legacyMarkdown
          ? await this.getCachedDossier(tenderId)
          : await this.ensureDossierUnlocked(tenderId);
        assertDossierArchiveSize(dossier.sizeBytes);
        const r = await fetch(dossier.url);
        if (!r.ok) return fallback();
        const archive = await readBoundedResponse(r);
        const zip = await normalizeArchiveToZip(
          new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength),
        );
        const { markdown } = await buildFullDossierMarkdown(
          zip,
          pdfParseExtract,
          defaultBinaryExtractor,
          undefined,
          async (name, bytes) => {
            const sha = createHash('sha256').update(bytes).digest('hex');
            const ocr = await this.readSavedFileOcr(tenderId, sha, name);
            if (!ocr || ocr.state === 'failed' || !ocr.pages.some(page => page.state === 'text' && page.text.trim().length >= 40)) return null;
            return ocr.pages.map(page => `\n[Page ${page.num} — OCR local · ${page.state}${page.textTruncated ? ' · texte limité' : ''}]\n${page.text}`).join('\n');
          },
        );
        if (!markdown.trim()) return fallback();
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
      return fallback();
    }
  }
}
