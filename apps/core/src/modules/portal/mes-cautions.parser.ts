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
 * SYNTHETIC FIXTURE WARNING: real "Mes cautions" HTML could not be captured (a
 * browser guardrail blocked extraction). This parser is modelled on the portal's
 * PRADO results-table idiom (see ../watch/watch.parser.ts +
 * fixtures/mes-cautions.html) and NEEDS a live-HTML validation pass on first real
 * run — the table id, cell order and label wording may need adjustment.
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
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
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

  const reference = labelled(refText, /R[ée]f[ée]rence/);
  if (!reference) return null; // a caution with no référence is unusable

  const deadlineRaw = labelled(objetText, /Date limite de remise des plis/);
  const montantRaw = labelled(cautionText, /Montant/);
  const statut = statutText.length > 0 ? statutText : undefined;

  return {
    reference,
    procedure: labelled(refText, /Proc[ée]dure/),
    category: labelled(refText, /Cat[ée]gorie/),
    objet: labelled(objetText, /Objet/),
    organisme: labelled(objetText, /Organisme/),
    deadlineAt: deadlineRaw ? (parsePmmpDate(deadlineRaw) ?? undefined) : undefined,
    bankName: labelled(cautionText, /Banque/),
    intitule: labelled(cautionText, /Intitul[ée]/),
    amountMad: montantRaw ? (parseMoneyMad(montantRaw) ?? undefined) : undefined,
    statut,
    demandeFile: extractDemandeFile(cells.eq(2), cautionText),
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
  const rows = $('table[id*="tableau"] tbody tr');
  const selected = rows.length > 0 ? rows : $('table.table-results tbody tr');

  const cautions: PortalCautionInput[] = [];
  const skipped: SkippedCautionRow[] = [];

  selected.each((_, el) => {
    const row = $(el);
    if (row.find('th').length > 0 && row.find('td').length === 0) return; // header
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

  return { cautions, skipped };
}

/**
 * Pure entrypoint requested by the crawler: the parsed PortalCautionInput rows.
 * Skipped rows are collected internally; use parseMesCautionsDetailed when the
 * caller wants to log the skip count (the crawler does, mirroring result.crawler).
 */
export function parseMesCautions(html: string): PortalCautionInput[] {
  return [...parseMesCautionsDetailed(html).cautions];
}
