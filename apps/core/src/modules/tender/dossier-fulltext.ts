import { createHash } from 'node:crypto';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { defaultPdfExtractor, type PdfTextExtractor } from './pdf-ocr';
import { noopBinaryExtractor, type BinaryDocExtractor } from './dossier-binary';
import {
  extractDocText,
  isDataBearingDoc,
  docPriority,
  MAX_PDF_BYTES,
} from './dossier-text';
import { toDossierMarkdown } from './dossier-markdown';
import { assertDossierArchiveSize, createDossierMetadataBudget, trackDossierEntryMetadata, MAX_DOSSIER_ARCHIVE_BYTES } from './dossier-archive-safety';

/**
 * Archive text for chat, with explicit file coverage before the body. Files may
 * have no usable text or exceed size/text budgets; this never establishes full
 * DCE reading or the latest official revision. No OCR is added by this builder.
 */
export const MAX_FULL_DOSSIER_CHARS = 250_000;
export const DOSSIER_COVERAGE_MARKER = '<!-- ATLAS_DCE_COVERAGE_V1';
export const MAX_DOSSIER_COVERAGE_CHARS = 64_000;
const MAX_COVERAGE_FILES = 200;

export type CoverageState = 'readable' | 'no_readable_text' | 'truncated' | 'skipped_budget' | 'skipped_size' | 'skipped_resource_limit' | 'failed';
interface CoverageFile { name: string; state: CoverageState; usedChars: number }
const COVERAGE_STATES = new Set<CoverageState>(['readable', 'no_readable_text', 'truncated', 'skipped_budget', 'skipped_size', 'skipped_resource_limit', 'failed']);

/** Saved evidence is usable in the viewer only for the exact archive being listed. */
export function readDossierCoverage(markdown: string, archiveSha256: string): Map<string, CoverageState> | null {
  if (!markdown.startsWith(DOSSIER_COVERAGE_MARKER)) return null;
  const end = markdown.indexOf('\n-->');
  if (end < 0 || end + 4 > MAX_DOSSIER_COVERAGE_CHARS) return null;
  try {
    const manifest = JSON.parse(markdown.slice(DOSSIER_COVERAGE_MARKER.length, end).trim());
    if (manifest.version !== 1 || manifest.archiveSha256 !== archiveSha256 || !/^[a-f0-9]{64}$/.test(archiveSha256) ||
        manifest.completeDce !== false || manifest.latestRevisionVerified !== false ||
        typeof manifest.manifestTruncated !== 'boolean' || !Number.isSafeInteger(manifest.candidateCount) ||
        !Array.isArray(manifest.files) || manifest.files.length > MAX_COVERAGE_FILES ||
        manifest.candidateCount < manifest.files.length) return null;
    const files = new Map<string, CoverageState>();
    for (const file of manifest.files) {
      if (!file || typeof file.name !== 'string' || !file.name || Buffer.byteLength(file.name) > 1024 ||
          !COVERAGE_STATES.has(file.state) || !Number.isSafeInteger(file.usedChars) || file.usedChars < 0 ||
          files.has(file.name)) return null;
      files.set(file.name, file.state);
    }
    return files;
  } catch { return null; }
}

function coveragePrefix(files: CoverageFile[], candidateCount: number, archiveSha256: string): string {
  const manifest = {
    version: 1, archiveSha256, candidateCount, manifestTruncated: files.length > MAX_COVERAGE_FILES,
    completeDce: false, latestRevisionVerified: false,
    scope: 'data-bearing candidates only; templates excluded; page coverage unverified',
    files: files.slice(0, MAX_COVERAGE_FILES),
  };
  let result = '';
  do {
    result = `${DOSSIER_COVERAGE_MARKER}\n${JSON.stringify(manifest).replaceAll('-->', '--\\u003e')}\n-->`;
    if (result.length <= MAX_DOSSIER_COVERAGE_CHARS) return result;
    manifest.files.pop();
    manifest.manifestTruncated = true;
  } while (manifest.files.length);
  return `${DOSSIER_COVERAGE_MARKER}\n${JSON.stringify(manifest)}\n-->`;
}

export interface FullDossier {
  /** Coverage manifest followed by readable source text within the body budget. */
  markdown: string;
  /** Per-file full char counts (diagnostic), in the order used. */
  files: { name: string; chars: number }[];
}

export async function buildFullDossierMarkdown(
  zipBytes: Uint8Array,
  extractPdf: PdfTextExtractor = defaultPdfExtractor,
  extractBinary: BinaryDocExtractor = noopBinaryExtractor,
  maxChars: number = MAX_FULL_DOSSIER_CHARS,
  savedText?: (name: string, bytes: Uint8Array) => Promise<string | null>,
): Promise<FullDossier> {
  let entries: Record<string, Uint8Array>;
  const candidates: UnzipFileInfo[] = [];
  const accepted = new Set<string>();
  const skipped = new Map<string, CoverageState>();
  try {
    assertDossierArchiveSize(zipBytes.byteLength);
    const budget = createDossierMetadataBudget();
    // Read metadata without allocating uncompressed documents first.
    unzipSync(zipBytes, { filter: (file) => {
      trackDossierEntryMetadata(file, budget);
      if (isDataBearingDoc(file.name)) candidates.push({ ...file });
      return false;
    } });
    candidates.sort((a, b) => docPriority(a.name) - docPriority(b.name) || a.name.localeCompare(b.name));
    let inflated = 0;
    for (const file of candidates) {
      if (accepted.has(file.name) || skipped.has(file.name)) throw new Error('Ambiguous archive entry');
      if (file.compression === 0 && file.size !== file.originalSize) throw new Error('Inconsistent stored entry size');
      if (file.originalSize > MAX_PDF_BYTES) skipped.set(file.name, 'skipped_size');
      else if (inflated + file.originalSize > MAX_DOSSIER_ARCHIVE_BYTES) skipped.set(file.name, 'skipped_resource_limit');
      else { accepted.add(file.name); inflated += file.originalSize; }
    }
    entries = unzipSync(zipBytes, {
      filter: (file) => accepted.has(file.name),
    });
  } catch {
    return { markdown: '', files: [] };
  }

  const parts: string[] = [];
  const files: { name: string; chars: number }[] = [];
  const coverage: CoverageFile[] = [];
  const bodyBudget = Number.isFinite(maxChars) ? Math.max(0, Math.min(MAX_FULL_DOSSIER_CHARS, Math.floor(maxChars))) : MAX_FULL_DOSSIER_CHARS;
  let used = 0;

  for (const { name } of candidates) {
    const omitted = skipped.get(name);
    if (omitted) { coverage.push({ name, state: omitted, usedChars: 0 }); continue; }
    if (used >= bodyBudget) { coverage.push({ name, state: 'skipped_budget', usedChars: 0 }); continue; }
    const bytes = entries[name];
    if (!bytes || bytes.length === 0) { coverage.push({ name, state: 'no_readable_text', usedChars: 0 }); continue; }
    let failed = false;
    const pdf: PdfTextExtractor = async (data) => {
      try { return await extractPdf(data); } catch { failed = true; return ''; }
    };
    const binary: BinaryDocExtractor = async (data, filename) => {
      try { return await extractBinary(data, filename); } catch { failed = true; return ''; }
    };
    const restored = await savedText?.(name, bytes);
    const raw = (restored ?? await extractDocText(name, bytes, pdf, binary))
      .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '').trim();
    if (!raw) { coverage.push({ name, state: failed ? 'failed' : 'no_readable_text', usedChars: 0 }); continue; }
    const room = bodyBudget - used;
    const slice = raw.length > room ? raw.slice(0, room) : raw;
    // Same "===== name =====" delimiter extractDossierText uses, so
    // toDossierMarkdown turns each into a "## name" section + GFM tables.
    parts.push(`===== ${name} =====\n${slice}`);
    files.push({ name, chars: raw.length });
    coverage.push({ name, state: slice.length < raw.length ? 'truncated' : 'readable', usedChars: slice.length });
    used += slice.length;
  }

  return {
    markdown: `${coveragePrefix(coverage, candidates.length, createHash('sha256').update(zipBytes).digest('hex'))}\n\n${toDossierMarkdown(parts.join('\n\n'))}`,
    files,
  };
}
