import { strFromU8, unzipSync } from 'fflate';
import { defaultPdfExtractor, type PdfTextExtractor } from './pdf-ocr';
import { noopBinaryExtractor, type BinaryDocExtractor } from './dossier-binary';

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

/** Formats we can pull text from natively (no LibreOffice): text-layer PDF,
 *  OOXML Word (.docx), OOXML Excel (.xlsx — the bordereau des prix is almost
 *  always one), and plain CSV/TXT. Binary .doc/.xls/.rtf/.odt/.ods are handled
 *  by the LibreOffice fallback in the extractor, NOT here. */
const DATA_DOC_NAME = /\.(pdf|docx?|xlsx?|csv|txt|odt|ods|ppt|rtf)$/i;
const DOCX_NAME = /\.docx$/i;
const XLSX_NAME = /\.xlsx$/i;
const ODF_NAME = /\.(odt|ods)$/i;
const PLAINTEXT_NAME = /\.(csv|txt)$/i;
/** Legacy Office binaries handled by the CLI-tool fallback (dossier-binary.ts).
 *  Anchored so it never matches the OOXML .docx/.xlsx handled natively above. */
const BINARY_NAME = /\.(doc|xls|ppt|rtf)$/i;
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
/** True when a zip entry is a data-bearing RC/CPS/BPU/avis doc (not a folder,
 *  not a bidder-fillable template). Shared with the vision-render path so both
 *  the text and image pipelines select the same documents. */
export function isDataBearingDoc(name: string): boolean {
  if (name.endsWith('/')) return false;
  if (!DATA_DOC_NAME.test(name)) return false;
  if (TEMPLATE_NAME.test(name)) return false;
  return true;
}

export function docPriority(name: string): number {
  const n = name.toLowerCase();
  // AVIS first — it's a 1-2 page document that almost always carries the
  // budget + caution provisoire (the two fields ATLAS most often misses on
  // marché-cadre tenders). When a 60-page scanned CPS competes for the same
  // 20-page vision budget, AVIS lost every time. Now it wins.
  if (n.includes('avis')) return 0;
  // BPDE / Bordereau / Détail estimatif second — for marché-cadre tenders
  // (SRM, ONEE-Branche-Eau, RADEEMA…) the budget is in the LAST row of this
  // table, not the Avis. Both AVIS and BPDE together cap at <10 pages so
  // they comfortably fit before RC/CPS get their turn.
  if (n.includes('bpu') || n.includes('bordereau') || n.includes('estimatif') || n.includes('bpde')) return 1;
  if (/(^|[^a-z])rc([^a-z]|$)|reglement|règlement/.test(n)) return 2;
  if (n.includes('cct') || n.includes('ccap') || n.includes('cctp')) return 3;
  if (n.includes('cps')) return 4;
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
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  quot: '"',
  nbsp: ' ',
};

/** Decodes the named + numeric (decimal/hex) XML entities that appear in OOXML
 *  text (`word/document.xml`, `xl/sharedStrings.xml`). Numeric refs cover the
 *  accented French/Arabic characters Office encodes as `&#233;` / `&#xE9;`. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeFromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|apos|quot|nbsp);/g, (_, name: string) => XML_ENTITY[name] ?? `&${name};`);
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

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
  return decodeXmlEntities(chunks.join(''));
}

/** Extracts cell text from an .xlsx (OOXML spreadsheet) — same dependency-free
 *  approach as DOCX: the workbook is a ZIP with a shared-string table
 *  (`xl/sharedStrings.xml`) and one XML per sheet (`xl/worksheets/sheetN.xml`).
 *  String cells (`t="s"`) reference the shared table by index; inline strings
 *  carry their own `<t>`; everything else is a literal number/date serial. We
 *  emit one line per row, cells joined by " | ", which is exactly what the BPU
 *  (bordereau des prix / détail estimatif) is shipped as for most buyers. */
const SI_BLOCK = /<si>([\s\S]*?)<\/si>/g;
const T_TAG = /<t[^>]*>([\s\S]*?)<\/t>/g;
const ROW_BLOCK = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
const CELL_BLOCK = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
const V_TAG = /<v>([\s\S]*?)<\/v>/;
const SHEET_NAME = /xl\/worksheets\/sheet\d+\.xml$/i;

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  let si: RegExpExecArray | null;
  SI_BLOCK.lastIndex = 0;
  while ((si = SI_BLOCK.exec(xml))) {
    const parts: string[] = [];
    let t: RegExpExecArray | null;
    T_TAG.lastIndex = 0;
    while ((t = T_TAG.exec(si[1]!))) parts.push(t[1]!);
    out.push(decodeXmlEntities(parts.join('')));
  }
  return out;
}

function extractSheetText(xml: string, shared: string[]): string {
  const rows: string[] = [];
  let row: RegExpExecArray | null;
  ROW_BLOCK.lastIndex = 0;
  while ((row = ROW_BLOCK.exec(xml))) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    CELL_BLOCK.lastIndex = 0;
    while ((cell = CELL_BLOCK.exec(row[1]!))) {
      const attrs = cell[1]!;
      const inner = cell[2]!;
      let val = '';
      if (/\bt="s"/.test(attrs)) {
        const v = V_TAG.exec(inner);
        if (v) val = shared[Number(v[1])] ?? '';
      } else if (/\bt="(inlineStr|str)"/.test(attrs)) {
        T_TAG.lastIndex = 0;
        const t = T_TAG.exec(inner);
        val = t ? decodeXmlEntities(t[1]!) : '';
      } else {
        const v = V_TAG.exec(inner);
        if (v) val = v[1]!;
      }
      const trimmed = val.trim();
      if (trimmed) cells.push(trimmed);
    }
    if (cells.length) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

function extractXlsxText(bytes: Uint8Array): string {
  let inner: Record<string, Uint8Array>;
  try {
    inner = unzipSync(bytes, {
      filter: (file) =>
        file.name === 'xl/sharedStrings.xml' || SHEET_NAME.test(file.name),
    });
  } catch {
    return '';
  }
  const sharedBytes = inner['xl/sharedStrings.xml'];
  const shared = sharedBytes ? parseSharedStrings(strFromU8(sharedBytes)) : [];
  const parts: string[] = [];
  for (const name of Object.keys(inner).filter((n) => SHEET_NAME.test(n)).sort()) {
    const sheet = extractSheetText(strFromU8(inner[name]!), shared);
    if (sheet.trim()) parts.push(sheet);
  }
  return parts.join('\n\n');
}

/** Extracts text from an OpenDocument file (.odt Writer / .ods Calc) — also a
 *  ZIP, with the content in `content.xml`. We turn paragraph / table-cell / row
 *  end-tags into separators, then strip the remaining markup. Covers buyers who
 *  author their DCE in LibreOffice instead of MS Office. */
function extractOdfText(bytes: Uint8Array): string {
  let inner: Record<string, Uint8Array>;
  try {
    inner = unzipSync(bytes, { filter: (file) => file.name === 'content.xml' });
  } catch {
    return '';
  }
  const xmlBytes = inner['content.xml'];
  if (!xmlBytes) return '';
  const stripped = strFromU8(xmlBytes)
    .replace(/<\/table:table-cell>/g, ' | ')
    .replace(/<\/(text:p|text:h|table:table-row)>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(stripped);
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
  extractBinary: BinaryDocExtractor = noopBinaryExtractor,
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
        : XLSX_NAME.test(name)
          ? extractXlsxText(bytes)
          : ODF_NAME.test(name)
            ? extractOdfText(bytes)
            : PLAINTEXT_NAME.test(name)
              ? strFromU8(bytes)
              : BINARY_NAME.test(name)
                ? await extractBinary(bytes, name)
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
