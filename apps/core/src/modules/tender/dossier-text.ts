import { strFromU8, unzipSync } from 'fflate';
import { defaultPdfExtractor, type PdfTextExtractor } from './pdf-ocr';

// Re-export so any historical consumer that imports defaultPdfExtractor /
// PdfTextExtractor from this module keeps compiling after the lift.
export { defaultPdfExtractor };
export type { PdfTextExtractor };

/**
 * Extracts the readable text of a DCE (Dossier de Consultation) ZIP — the
 * Atexo portal serves RC (Règlement de Consultation), CPS, AVIS and the BPU
 * either as text-layer PDFs (verified live: pdftotext pulls 20k+ clean chars)
 * or — for some buyers — as native .docx files. We unzip in memory, pull the
 * text of the DATA-BEARING documents (skipping bidder-fillable templates like
 * DH / AE) most-informative first, with a PER-BUCKET budget so a fat RC never
 * starves the BPU/CPS that carry the price detail.
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

/** Upper bound on the combined text handed to the LLM (~15k tokens). */
export const MAX_DOSSIER_CHARS = 60_000;
/** Skip any single PDF/DOCX whose uncompressed size exceeds this (memory guard). */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;

const DATA_DOC_NAME = /\.(pdf|docx)$/i;
const DOCX_NAME = /\.docx$/i;
/** Bidder-fillable templates carry no useful data — exclude them up front to
 *  free the budget for the data-bearing docs (RC/CPS/BPU). Matches both the
 *  abbreviations (DH, AE) and the full French names, with the typographic
 *  apostrophe (U+2019) accepted alongside the ASCII one (Atexo file names mix
 *  both: "Acte d'engagement" and "Acte d'engagement"). */
const APOS = "['’]?"; // ASCII or typographic apostrophe, optional
const TEMPLATE_NAME = new RegExp(
  `(^|[^a-z])(` +
    `dh|ae|template` +
    `|d[eé]claration[\\s_-]*(sur[\\s_-]*l${APOS}\\s*honneur)?` +
    `|acte[\\s_-]*d${APOS}\\s*engagement` +
    `|formulaire|modele|modèle` +
    `)([^a-z]|$)`,
  'i',
);

/** Per-document-type character budget. RC carries the headline estimation/
 *  caution figures (gets the lion's share), BPU has the line items + units
 *  (must not be starved by a fat RC), CPS the contractual details, and the
 *  avis is the thinnest summary. Sum (60 000) matches MAX_DOSSIER_CHARS. */
const BUCKET_BUDGET = {
  rc: 24_000,
  bpu: 20_000,
  cps: 12_000,
  other: 4_000,
} as const;
type Bucket = keyof typeof BUCKET_BUDGET;

function bucketOf(name: string): Bucket {
  const n = name.toLowerCase();
  if (/(^|[^a-z])rc([^a-z]|$)|reglement|règlement/.test(n)) return 'rc';
  if (n.includes('bpu') || n.includes('bordereau') || n.includes('estimatif')) return 'bpu';
  if (n.includes('cps') || n.includes('cct') || n.includes('ccap') || n.includes('cctp')) return 'cps';
  return 'other';
}

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

/** Extracts visible text from a .docx (Word) file without adding a Word parser
 *  dependency — DOCX is a ZIP whose `word/document.xml` holds runs of text in
 *  `<w:t>` elements. We strip everything else (styles, drawings, comments),
 *  decode the handful of XML entities that appear in real docs, and return
 *  paragraph-broken plain text. Good enough for BPU/CPS tables: the LLM
 *  doesn't need styled HTML, only the words and numbers. */
const W_T_TAG = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
const W_P_END = /<\/w:p>/g;
const XML_ENTITY: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&apos;': "'",
  '&quot;': '"',
  '&#160;': ' ',
  '&nbsp;': ' ',
};

function extractDocxText(bytes: Uint8Array): string {
  let inner: Record<string, Uint8Array>;
  try {
    inner = unzipSync(bytes, {
      filter: (file) => file.name === 'word/document.xml',
    });
  } catch {
    return '';
  }
  const xmlBytes = inner['word/document.xml'];
  if (!xmlBytes) return '';
  const xml = strFromU8(xmlBytes);
  // Mark paragraph boundaries first so we don't run sentences together when we
  // strip the rest of the markup.
  const broken = xml.replace(W_P_END, '\n');
  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  W_T_TAG.lastIndex = 0;
  while ((m = W_T_TAG.exec(broken))) {
    chunks.push(m[1]!);
  }
  const joined = chunks.join('');
  return joined.replace(/&(amp|lt|gt|apos|quot|#160|nbsp);/g, (e) => XML_ENTITY[e] ?? e);
}

/** pdf-parse emits a per-page sentinel like "-- 1 of 1 --" even when the page
 *  has zero text layer (scanned PDF). Strip those lines so a 4-file scanned
 *  dossier doesn't masquerade as "163 chars of text" — was letting the LLM
 *  return null for everything while we marked the extraction "done". */
const SENTINEL_LINE = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm;

/** Collapses runs of spaces/blank lines so the bounded budget holds real words. */
function normalize(text: string): string {
  return text
    .replace(SENTINEL_LINE, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Minimum chars per individual file to count as "readable" — anything under
 *  this is almost certainly an image-only scan whose text layer is empty. */
export const MIN_READABLE_FILE_CHARS = 200;
/** Minimum total chars across all files to bother sending to the LLM. Below
 *  this the response is invariably all-nulls and we'd just persist an empty
 *  extraction that blocks the row from ever retrying. */
export const MIN_READABLE_TOTAL_CHARS = 500;

export async function extractDossierText(
  zipBytes: Uint8Array,
  extractPdf: PdfTextExtractor = defaultPdfExtractor,
): Promise<DossierText> {
  let entries: Record<string, Uint8Array>;
  try {
    // Selective inflation: only the data-bearing PDF/DOCX we will read are
    // decompressed — large CAD/DWG plans, scanned annexes, photos and any
    // single oversize/zip-bomb PDF are never materialized in memory.
    // Templates (DH/AE/declaration/acte d'engagement) are rejected here too:
    // they are blank forms the bidder fills, so they only burn budget.
    entries = unzipSync(zipBytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        if (!DATA_DOC_NAME.test(file.name)) return false;
        if (TEMPLATE_NAME.test(file.name)) return false;
        return file.originalSize <= MAX_PDF_BYTES;
      },
    });
  } catch {
    return { text: '', files: [] };
  }

  const docNames = Object.keys(entries).sort(
    (a, b) => docPriority(a) - docPriority(b) || a.localeCompare(b),
  );

  const files: DossierTextFile[] = [];
  const parts: string[] = [];
  // Per-bucket spend so a fat RC never starves the BPU/CPS detail rows. Sum
  // matches MAX_DOSSIER_CHARS by construction.
  const spent: Record<Bucket, number> = { rc: 0, bpu: 0, cps: 0, other: 0 };
  let used = 0;

  for (const name of docNames) {
    if (used >= MAX_DOSSIER_CHARS) break;
    const bytes = entries[name];
    if (!bytes || bytes.length === 0) continue;

    let raw = '';
    try {
      raw = DOCX_NAME.test(name)
        ? extractDocxText(bytes)
        : await extractPdf(bytes);
    } catch {
      // A single unreadable doc must not abort the whole dossier.
      continue;
    }
    const cleaned = normalize(raw);
    if (!cleaned) continue;

    const bucket = bucketOf(name);
    const bucketRoom = Math.max(0, BUCKET_BUDGET[bucket] - spent[bucket]);
    const totalRoom = MAX_DOSSIER_CHARS - used;
    const room = Math.min(bucketRoom, totalRoom);
    if (room === 0) continue;

    let slice = cleaned.slice(0, room);
    // When the budget cuts the doc short, back up to the last whitespace so a
    // figure (e.g. "379 104,00") is never split across the boundary.
    if (cleaned.length > room) {
      const lastWs = slice.lastIndexOf(' ');
      if (lastWs > room * 0.5) slice = slice.slice(0, lastWs);
    }
    parts.push(`===== ${name} =====\n${slice}`);
    files.push({ name, chars: cleaned.length });
    spent[bucket] += slice.length;
    used += slice.length;
  }

  return { text: parts.join('\n\n').trim(), files };
}
