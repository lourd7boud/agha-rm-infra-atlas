import { strFromU8, unzipSync } from 'fflate';

/**
 * Direct structured parse of a Moroccan tender's Bordereau des Prix (.xlsx) —
 * the datao-grade fast path. Where the LLM dossier extractor only sees the
 * file's joined text and may paraphrase or drop rows on long BPUs, this reads
 * the spreadsheet's actual cells, identifies the header row, maps columns
 * (Désignation / Unité / Quantité / [P.U.]) and emits one item per data row,
 * preserving the section labels that group items in the source workbook.
 *
 * No new runtime dependency: built on `fflate` (already used throughout the
 * dossier-text pipeline). When the workbook is corrupt or doesn't resemble a
 * BPU, the parser returns `{ items: [] }` so the caller can transparently fall
 * back to the LLM path — the parser is a precision augmentation, never a hard
 * requirement.
 */

export interface BpuItem {
  /** Optional section/lot header label this item appears under (e.g. "A - CENTRALES"). */
  section: string | null;
  /** Raw designation text (max 300 chars; mirrors the LLM schema bound). */
  designation: string;
  /** Numeric quantity (parsed from FR-formatted text); null when absent/garbage. */
  quantite: number | null;
  /** Unit code as written in the workbook (E, U, ML, M2, KG…); null when absent. */
  unite: string | null;
  /** Unit price in MAD when present (rare — buyer BPUs usually omit it). */
  prixUnitaireMad: number | null;
}

export interface ParseBordereauResult {
  items: BpuItem[];
  /** Number of sheets actually inspected (diagnostic; 0 on parse failure). */
  sheetsRead: number;
}

const MAX_DESIGNATION_CHARS = 300;
/** Match the LLM schema's `section` bound (boundedStrNullish(160)) so a long
 *  section title from the workbook isn't truncated again on the way to storage. */
const MAX_SECTION_CHARS = 160;
/** Minimum number of distinct meaningful headers a row must carry to qualify
 *  as the BPU header. Below this we'd misidentify a title row as a header. */
const MIN_HEADER_HITS = 2;

const SI_BLOCK = /<si>([\s\S]*?)<\/si>/g;
const T_TAG = /<t[^>]*>([\s\S]*?)<\/t>/g;
const ROW_BLOCK = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
const CELL_BLOCK = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
const V_TAG = /<v>([\s\S]*?)<\/v>/;
const CELL_REF = /\br="([A-Z]+)\d+"/;
const SHEET_NAME = /xl\/worksheets\/sheet\d+\.xml$/i;

const XML_ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  quot: '"',
  nbsp: ' ',
};

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

/** Column letter ("A", "B", ..., "AA", ...) → zero-based index. */
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

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

/** Extracts a sheet's rows as a 2D array of cell strings, preserving column
 *  position via the cell `r="A1"` reference (so a row that skips columns ends
 *  up with empty strings in the gaps, NOT with cells shifted left). */
function extractSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let row: RegExpExecArray | null;
  ROW_BLOCK.lastIndex = 0;
  while ((row = ROW_BLOCK.exec(xml))) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    CELL_BLOCK.lastIndex = 0;
    while ((cell = CELL_BLOCK.exec(row[1]!))) {
      const attrs = cell[1]!;
      const inner = cell[2]!;
      const refMatch = CELL_REF.exec(attrs);
      const col = refMatch ? colIndex(refMatch[1]!) : cells.length;
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
      while (cells.length <= col) cells.push('');
      cells[col] = val.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/** Parses a French-formatted decimal/integer: "1 234,5", "12.345,67", "0,5".
 *  Returns null when the string carries no usable digits. */
export function parseFrenchNumber(raw: string): number | null {
  const cleaned = raw.replace(/[ \s]+/g, '').trim();
  if (!cleaned) return null;
  const m = cleaned.match(/-?[\d.,]+/);
  if (!m) return null;
  let token = m[0];
  if (token.includes(',')) {
    token = token.replace(/\./g, '').replace(',', '.');
  } else if ((token.match(/\./g) ?? []).length > 1) {
    token = token.replace(/\./g, '');
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

interface ColumnMap {
  designation: number;
  unite: number | null;
  quantite: number | null;
  prixUnitaire: number | null;
}

/** Identify the column purpose from a header cell text. Accents are stripped
 *  so "désignation" / "designation" / "DÉSIGNATION" all match the same key.
 *  Order matters: the most specific phrases are checked FIRST so the single
 *  letter "u" (general "Unité" abbreviation) never poaches a "P.U." header. */
function classifyHeader(text: string): keyof ColumnMap | null {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/p\.?\s*u\.?|prix\s*unit/.test(t)) return 'prixUnitaire';
  if (/\bdesignation|libelle|prestation|description|nature/.test(t)) return 'designation';
  if (/\b(qte|qty|quantite|quantity|qtte|qt|nbre|nombre)\b/.test(t)) return 'quantite';
  if (/\b(unite|unit|u)\b/.test(t)) return 'unite';
  return null;
}

/** Scan the first ~12 rows for one that looks like a BPU header row. Returns
 *  the row index + column mapping, or null when no plausible header is found. */
function findHeader(rows: string[][]): { rowIdx: number; cols: ColumnMap } | null {
  const limit = Math.min(rows.length, 12);
  for (let r = 0; r < limit; r++) {
    const row = rows[r]!;
    const cols: ColumnMap = {
      designation: -1,
      unite: null,
      quantite: null,
      prixUnitaire: null,
    };
    let hits = 0;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]!;
      if (!cell) continue;
      const kind = classifyHeader(cell);
      if (!kind) continue;
      if (kind === 'designation' && cols.designation === -1) {
        cols.designation = c;
        hits++;
      } else if (kind === 'unite' && cols.unite == null) {
        cols.unite = c;
        hits++;
      } else if (kind === 'quantite' && cols.quantite == null) {
        cols.quantite = c;
        hits++;
      } else if (kind === 'prixUnitaire' && cols.prixUnitaire == null) {
        cols.prixUnitaire = c;
        hits++;
      }
    }
    if (cols.designation !== -1 && hits >= MIN_HEADER_HITS) {
      return { rowIdx: r, cols };
    }
  }
  return null;
}

const TOTAL_LINE = /\b(total|sous[-\s]?total|montant\s+(ht|ttc|tva))\b/i;
const PAGE_FOOTER = /\bpage\s+\d+/i;

/** True when a single-cell row should be SKIPPED rather than promoted to a
 *  section header — totals/sub-totals/page footers carry no item data. */
function isLikelyTotalRow(text: string): boolean {
  return TOTAL_LINE.test(text) || PAGE_FOOTER.test(text);
}

function truncate(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n);
}

export function parseBordereauXlsx(bytes: Uint8Array): ParseBordereauResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => file.name === 'xl/sharedStrings.xml' || SHEET_NAME.test(file.name),
    });
  } catch {
    return { items: [], sheetsRead: 0 };
  }
  const sharedBytes = entries['xl/sharedStrings.xml'];
  const shared = sharedBytes ? parseSharedStrings(strFromU8(sharedBytes)) : [];

  const items: BpuItem[] = [];
  const sheetNames = Object.keys(entries).filter((n) => SHEET_NAME.test(n)).sort();
  let sheetsRead = 0;

  for (const name of sheetNames) {
    const rows = extractSheetRows(strFromU8(entries[name]!), shared);
    if (!rows.length) continue;
    const header = findHeader(rows);
    if (!header) continue;
    sheetsRead++;
    const { cols } = header;
    let currentSection: string | null = null;

    for (let r = header.rowIdx + 1; r < rows.length; r++) {
      const row = rows[r]!;
      const nonEmpty = row.filter((c) => c && c.trim().length > 0);
      if (nonEmpty.length === 0) continue;

      // Section header: only one non-empty cell.
      if (nonEmpty.length === 1) {
        const txt = nonEmpty[0]!.trim();
        if (isLikelyTotalRow(txt)) continue;
        if (txt.length >= 2) currentSection = truncate(txt, MAX_SECTION_CHARS);
        continue;
      }

      const rawDesig = (row[cols.designation] || '').trim();
      if (!rawDesig) continue;
      if (isLikelyTotalRow(rawDesig)) continue;
      // Skip rows whose "designation" cell is just digits — that's a stray
      // number row, not a real item.
      if (/^[\d\s.,-]+$/.test(rawDesig)) continue;

      const unite = cols.unite != null ? (row[cols.unite] || '').trim() : '';
      const quantiteRaw = cols.quantite != null ? (row[cols.quantite] || '').trim() : '';
      const prixRaw = cols.prixUnitaire != null ? (row[cols.prixUnitaire] || '').trim() : '';

      items.push({
        section: currentSection,
        designation: truncate(rawDesig, MAX_DESIGNATION_CHARS),
        quantite: quantiteRaw ? parseFrenchNumber(quantiteRaw) : null,
        unite: unite ? truncate(unite, 24) : null,
        prixUnitaireMad: prixRaw ? parseFrenchNumber(prixRaw) : null,
      });
    }
  }

  return { items, sheetsRead };
}

/** True when a zip entry name looks like a tender's bordereau des prix workbook
 *  (xlsx/xls/ods), used to pick the right file out of the DCE archive. */
export function isBordereauFileName(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  const lower = base.toLowerCase();
  if (!/\.(xlsx|xls|ods)$/i.test(lower)) return false;
  return /(bordereau|bpu|detail.{0,3}estimatif|cadre.{0,3}bordereau)/i.test(lower);
}

export interface BordereauFromDce {
  /** The matched entry name within the DCE archive. */
  fileName: string;
  items: BpuItem[];
  sheetsRead: number;
}

/** A short numeric score used to pick the BEST bordereau when a DCE ships more
 *  than one candidate (e.g. an `Estimatif` *and* a `Bordereau` for the same
 *  market — happens in BTP). Higher = preferred. */
function bordereauPriority(name: string): number {
  const lower = name.toLowerCase();
  if (/\bbordereau\b/.test(lower)) return 4;
  if (/\bbpu\b/.test(lower)) return 3;
  if (/cadre.{0,3}bordereau/.test(lower)) return 2;
  if (/detail.{0,3}estimatif/.test(lower)) return 1;
  return 0;
}

/**
 * Scans a DCE archive for the tender's bordereau des prix workbook and parses
 * its items directly — the data fidelity layer that replaces (or augments) the
 * LLM-extracted BPU. Returns the best match, or null when no XLSX bordereau is
 * present (e.g. some procuring entities ship the BPU embedded inside the CPS
 * PDF; those still go through the LLM path).
 *
 * Important: only `.xlsx` (and `.ods` in a future round) is structurally
 * parsed — legacy `.xls` files exist on the portal but require a CFB reader we
 * don't ship. They fall through to the LLM path, same as image-only PDFs.
 */
export function extractBordereauFromDce(zipBytes: Uint8Array): BordereauFromDce | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      filter: (file) => isBordereauFileName(file.name),
    });
  } catch {
    return null;
  }
  const names = Object.keys(entries).sort(
    (a, b) => bordereauPriority(b) - bordereauPriority(a) || a.localeCompare(b),
  );
  for (const name of names) {
    // Only structurally-parsable formats. .xls (binary CFB) would need a heavy
    // legacy dependency; defer to the LLM path for those.
    if (!/\.xlsx$/i.test(name)) continue;
    const out = parseBordereauXlsx(entries[name]!);
    if (out.items.length > 0) {
      return { fileName: name, items: out.items, sheetsRead: out.sheetsRead };
    }
  }
  return null;
}
