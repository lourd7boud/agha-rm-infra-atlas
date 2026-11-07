import * as cheerio from 'cheerio';
import { parseMoneyMad } from '../watch/detail.parser';
import { parsePmmpDate } from '../watch/watch.parser';
import type { PortalCautionInput } from './portal.repository';

/**
 * Authenticated-account acquisition — "Mes cautions" (page=entreprise.MesCautions).
 *
 * Lists our own bank guarantees: per row, the référence/procédure/catégorie, the
 * objet/organisme/date-limite, then the banque + (optional) RIB/compte + intitulé
 * + montant + the "Demande_Caution_*.pdf" filename, and the lifecycle statut
 * ("Validée par la banque" / "Rejetée par la banque" / "Brouillon" / restitution
 * states). The cells stack several labelled lines, so we split each cell's text by
 * its "Label :" markers rather than relying on inner tags.
 *
 * Supports both the portal's older labelled-cell markup and the production
 * results-table idiom (`.ref`, `.info-bulle`, direct `tr` children without an
 * explicit `tbody`).
 *
 * Defensive: a row that doesn't yield a référence is skipped (collected, never
 * thrown) so one malformed row can never crash a crawl.
 */

/** A row that did not parse, kept so callers can log/count instead of dropping. */
export interface SkippedCautionRow {
  reason: string;
  text: string;
}

export interface ParseMesCautionsOutcome {
  cautions: readonly PortalCautionInput[];
  skipped: readonly SkippedCautionRow[];
  /** True only when the authenticated Mes cautions results table is present. */
  surfaceDetected: boolean;
  /** Rows containing data cells, including malformed rows. */
  candidateRows: number;
}

const MIN_CELLS = 4;
const MAX_SKIP_TEXT = 200;

// The node-typed Cheerio selection that `$('sel')` / `.eq()` yield — derived from
// the API itself so we never hardcode cheerio's internal DOM node type.
type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

/**
 * Pulls the value following a "Label :" marker out of stacked cell text. Matches
 * up to the next labelled line or end of cell. Accent/case-insensitive on the
 * label; trims the trailing whitespace. Returns undefined when the label is
 * absent so the back-fill upsert keeps any earlier value.
 */
function labelled(text: string, label: RegExp): string | undefined {
  const re = new RegExp(`${label.source}\\s*:\\s*([\\s\\S]*?)(?=\\n|$)`, 'i');
  const value = re.exec(text)?.[1];
  if (value === undefined) return undefined;
  const trimmed = value.replace(/[ \t]+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Cell text with each stacked line preserved as its own line: cheerio's `.text()`
 * concatenates <br>-separated lines without a separator, so we read the cell's
 * HTML and turn <br> (and block-close tags) into newlines before stripping tags.
 * Lets `labelled()` stop at the next line. Non-breaking spaces are normalised so
 * "7 700,00" reads as "7 700,00" for parseMoneyMad.
 */
function stackedCellText(cell: CheerioSelection): string {
  const html = cell.html() ?? '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|tr)>/gi, '\n');
  return cheerio
    .load(withBreaks)
    .root()
    .text()
    .replace(/[\u00a0\u202f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function compactText(value: string): string | undefined {
  const compact = value.replace(/[\u00a0\u202f\s]+/g, ' ').trim();
  return compact.length > 0 ? compact : undefined;
}

function liveReference(cell: CheerioSelection): string | undefined {
  return compactText(cell.find('.ref').first().text());
}

function liveProcedure(cell: CheerioSelection): string | undefined {
  return compactText(cell.find('.info-bulle').first().text());
}

function lastStackedLine(text: string): string | undefined {
  return compactText(text.split('\n').at(-1) ?? '');
}

function consultationIdFromRow(row: CheerioSelection): string | undefined {
  let consultationId: string | undefined;
  row.find('a[href*="refConsultation"]').each((_, link) => {
    if (consultationId) return;
    const href = row.find(link).attr('href');
    if (!href) return;
    try {
      consultationId =
        new URL(href, 'https://www.marchespublics.gov.ma/').searchParams.get(
          'refConsultation',
        ) ?? undefined;
    } catch {
      // A malformed action URL must not discard the otherwise valid row.
    }
  });
  return consultationId;
}

/** Extracts the "Demande_Caution_*.pdf" filename from the caution cell. */
function extractDemandeFile(
  cell: CheerioSelection,
  cellText: string,
): string | undefined {
  const anchor = cell.find('a').first().text().trim();
  if (anchor.length > 0) return anchor;
  const m = /([\w-]+\.pdf)/i.exec(cellText);
  return m?.[1];
}

/** Maps one results-table row to a PortalCautionInput, or null to skip it. */
function parseRow(row: CheerioSelection): PortalCautionInput | null {
  const cells = row.find('td');
  if (cells.length < MIN_CELLS) return null;

  const refText = stackedCellText(cells.eq(0));
  const objetText = stackedCellText(cells.eq(1));
  const cautionText = stackedCellText(cells.eq(2));
  const statutText = stackedCellText(cells.eq(3));

  const reference =
    labelled(refText, /R[ée]f[ée]rence/) ?? liveReference(cells.eq(0));
  if (!reference) return null; // a caution with no référence is unusable

  const deadlineRaw = labelled(objetText, /Date limite de remise des plis/);
  const montantRaw = labelled(cautionText, /Montant/);
  const statut = statutText.length > 0 ? statutText : undefined;

  return {
    reference,
    procedure:
      labelled(refText, /Proc[ée]dure/) ?? liveProcedure(cells.eq(0)),
    category:
      labelled(refText, /Cat[ée]gorie/) ?? lastStackedLine(refText),
    objet: labelled(objetText, /Objet/),
    organisme: labelled(objetText, /Organisme/),
    deadlineAt: deadlineRaw ? (parsePmmpDate(deadlineRaw) ?? undefined) : undefined,
    bankName: labelled(cautionText, /Banque/),
    intitule: labelled(cautionText, /Intitul[ée]/),
    amountMad: montantRaw ? (parseMoneyMad(montantRaw) ?? undefined) : undefined,
    statut,
    demandeFile: extractDemandeFile(cells.eq(2), cautionText),
    consultationId: consultationIdFromRow(row),
    raw: { refText, objetText, cautionText, statutText },
  };
}

/**
 * Parses the "Mes cautions" page into PortalCautionInput rows. Locates the
 * results table (PRADO `tableau…` id, with a `table.table-results` fallback so a
 * markup change degrades gracefully), iterates body rows, and skips+collects any
 * row that fails — never throws on a single bad row.
 */
export function parseMesCautionsDetailed(html: string): ParseMesCautionsOutcome {
  const $ = cheerio.load(html);
  const legacyTable = $('table[id*="tableau"]').first();
  const table = legacyTable.length > 0 ? legacyTable : $('table.table-results').first();
  const selected = table.find('tr');

  const cautions: PortalCautionInput[] = [];
  const skipped: SkippedCautionRow[] = [];
  let candidateRows = 0;

  selected.each((_, el) => {
    const row = $(el);
    if (row.find('th').length > 0 && row.find('td').length === 0) return; // header
    if (row.find('td').length === 0) return;
    candidateRows += 1;
    let parsed: PortalCautionInput | null;
    try {
      parsed = parseRow(row);
    } catch {
      parsed = null;
    }
    if (parsed) {
      cautions.push(parsed);
      return;
    }
    skipped.push({
      reason: 'no référence / too few cells',
      text: row.text().replace(/\s+/g, ' ').trim().slice(0, MAX_SKIP_TEXT),
    });
  });

  return {
    cautions,
    skipped,
    surfaceDetected: table.length > 0,
    candidateRows,
  };
}

/**
 * Pure entrypoint requested by the crawler: the parsed PortalCautionInput rows.
 * Skipped rows are collected internally; use parseMesCautionsDetailed when the
 * caller wants to log the skip count (the crawler does, mirroring result.crawler).
 */
export function parseMesCautions(html: string): PortalCautionInput[] {
  return [...parseMesCautionsDetailed(html).cautions];
}
