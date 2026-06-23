import { unzipSync } from 'fflate';
import { PDFParse } from 'pdf-parse';

/**
 * Extracts the readable text of a DCE (Dossier de Consultation) ZIP — the
 * Atexo portal serves RC (Règlement de Consultation), CPS, AVIS and the BPU as
 * text-layer PDFs (verified live: pdftotext pulls 20k+ clean chars). We unzip in
 * memory and pull the text of the data-bearing PDFs, most-informative first, up
 * to a bound so the LLM payload (and cost) stays controlled. Scanned/image-only
 * PDFs simply yield no text and are skipped — never OCR'd, never fabricated.
 */

export interface DossierTextFile {
  name: string;
  chars: number;
}

export interface DossierText {
  /** Concatenated, bounded text of the dossier's documents (LLM input). */
  text: string;
  /** Per-file extracted char counts, in the order used (diagnostic). */
  files: DossierTextFile[];
}

/** Pulls plain text from one PDF's bytes. Injectable so tests avoid real PDFs. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<string>;

/** Upper bound on the combined text handed to the LLM (~15k tokens). */
export const MAX_DOSSIER_CHARS = 60_000;
/** Skip any single PDF whose uncompressed size exceeds this (memory guard). */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;

const PDF_NAME = /\.pdf$/i;

/**
 * Document priority (lower = read first): the RC (Règlement de Consultation)
 * carries the HEADLINE facts — the maître d'ouvrage estimation, the cautions,
 * the qualifications/classe and the délais — so it leads, ensuring the budget
 * line is never the one starved/truncated by the char budget. The BPU/détail
 * estimatif (prices+quantities) and CPS follow; the avis is the thinnest.
 */
function docPriority(name: string): number {
  const n = name.toLowerCase();
  if (/(^|[^a-z])rc([^a-z]|$)|reglement|règlement/.test(n)) return 0;
  if (n.includes('bpu') || n.includes('bordereau') || n.includes('estimatif')) return 1;
  if (n.includes('cps')) return 2;
  if (n.includes('cct') || n.includes('ccap') || n.includes('cctp')) return 3;
  if (n.includes('avis')) return 4;
  return 5;
}

const defaultPdfExtractor: PdfTextExtractor = async (bytes) => {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy().catch(() => {});
  }
};

/** Collapses runs of spaces/blank lines so the bounded budget holds real words. */
function normalize(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractDossierText(
  zipBytes: Uint8Array,
  extractPdf: PdfTextExtractor = defaultPdfExtractor,
): Promise<DossierText> {
  let entries: Record<string, Uint8Array>;
  try {
    // Selective inflation: only the PDFs we will read are decompressed — the
    // large non-PDF attachments (CAD/DWG plans, scanned annexes, photos) and any
    // single oversize/zip-bomb PDF are never materialized in memory.
    entries = unzipSync(zipBytes, {
      filter: (file) =>
        PDF_NAME.test(file.name) &&
        !file.name.endsWith('/') &&
        file.originalSize <= MAX_PDF_BYTES,
    });
  } catch {
    return { text: '', files: [] };
  }

  const pdfNames = Object.keys(entries).sort(
    (a, b) => docPriority(a) - docPriority(b) || a.localeCompare(b),
  );

  const files: DossierTextFile[] = [];
  const parts: string[] = [];
  let used = 0;

  for (const name of pdfNames) {
    if (used >= MAX_DOSSIER_CHARS) break;
    const bytes = entries[name];
    if (!bytes || bytes.length === 0) continue;

    let raw = '';
    try {
      raw = await extractPdf(bytes);
    } catch {
      // A single unreadable PDF must not abort the whole dossier.
      continue;
    }
    const cleaned = normalize(raw);
    if (!cleaned) continue;

    const room = MAX_DOSSIER_CHARS - used;
    let slice = cleaned.slice(0, room);
    // When the budget cuts the doc short, back up to the last whitespace so a
    // figure (e.g. "379 104,00") is never split across the boundary.
    if (cleaned.length > room) {
      const lastWs = slice.lastIndexOf(' ');
      if (lastWs > room * 0.5) slice = slice.slice(0, lastWs);
    }
    parts.push(`===== ${name} =====\n${slice}`);
    files.push({ name, chars: cleaned.length });
    used += slice.length;
  }

  return { text: parts.join('\n\n').trim(), files };
}
