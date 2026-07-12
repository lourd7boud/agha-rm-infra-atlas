import { unzipSync } from 'fflate';
import { defaultPdfExtractor, type PdfTextExtractor } from './pdf-ocr';
import { noopBinaryExtractor, type BinaryDocExtractor } from './dossier-binary';
import {
  extractDocText,
  isDataBearingDoc,
  docPriority,
  MAX_PDF_BYTES,
} from './dossier-text';
import { toDossierMarkdown } from './dossier-markdown';

/**
 * FULL-fidelity dossier read for the chat agent. Unlike extractDossierText — a
 * budgeted SUMMARY (60k total, per-bucket caps, BPU capped at 30 rows) tuned for
 * the cheap structured-extraction LLM — this reads EVERY data-bearing document's
 * COMPLETE text so the agent sees the real files (RC/CPS/BPU article by article,
 * the full bordereau), not a digest. Markdown-formatted (## per file + GFM
 * tables). Bounded only by maxChars as a memory/cost guard, far higher than the
 * summary budget. CHEAP by design: pass pdfParseExtract (no OCR) — OCR stays in
 * the extraction pipeline; scanned pages contribute whatever text layer exists.
 */
export const MAX_FULL_DOSSIER_CHARS = 250_000;

export interface FullDossier {
  /** Concatenated Markdown of every data-bearing file, most-informative first. */
  markdown: string;
  /** Per-file full char counts (diagnostic), in the order used. */
  files: { name: string; chars: number }[];
}

export async function buildFullDossierMarkdown(
  zipBytes: Uint8Array,
  extractPdf: PdfTextExtractor = defaultPdfExtractor,
  extractBinary: BinaryDocExtractor = noopBinaryExtractor,
  maxChars: number = MAX_FULL_DOSSIER_CHARS,
): Promise<FullDossier> {
  let entries: Record<string, Uint8Array>;
  try {
    // Inflate only the data-bearing docs (RC/CPS/BPU/avis, docx/xlsx…), skipping
    // bidder-fillable templates and any single oversize member (memory guard).
    entries = unzipSync(zipBytes, {
      filter: (file) => isDataBearingDoc(file.name) && file.originalSize <= MAX_PDF_BYTES,
    });
  } catch {
    return { markdown: '', files: [] };
  }

  const names = Object.keys(entries).sort(
    (a, b) => docPriority(a) - docPriority(b) || a.localeCompare(b),
  );

  const parts: string[] = [];
  const files: { name: string; chars: number }[] = [];
  let used = 0;

  for (const name of names) {
    if (used >= maxChars) break;
    const bytes = entries[name];
    if (!bytes || bytes.length === 0) continue;
    const raw = (await extractDocText(name, bytes, extractPdf, extractBinary)).trim();
    if (!raw) continue;
    const room = maxChars - used;
    const slice = raw.length > room ? raw.slice(0, room) : raw;
    // Same "===== name =====" delimiter extractDossierText uses, so
    // toDossierMarkdown turns each into a "## name" section + GFM tables.
    parts.push(`===== ${name} =====\n${slice}`);
    files.push({ name, chars: raw.length });
    used += slice.length;
  }

  return { markdown: toDossierMarkdown(parts.join('\n\n')), files };
}
