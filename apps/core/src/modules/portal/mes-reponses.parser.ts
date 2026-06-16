import * as cheerio from 'cheerio';
import { parsePmmpDate } from '../watch/watch.parser';
import type { PortalSubmissionInput } from './portal.repository';

/**
 * Authenticated-account acquisition — "Mes réponses" (page=entreprise.MesReponses).
 *
 * Lists every soumission this account deposited: per row, the
 * référence/procédure/catégorie, the contexte/objet/organisme, the date limite de
 * remise des plis, then "Ma réponse" — our deposit date and, when we pulled the
 * bid, a "Retiré le :" line (=> withdrawnAt). The cells stack several labelled
 * lines, so we split each cell's text by its "Label :" markers rather than relying
 * on inner tags. Mirrors mes-cautions.parser.ts exactly.
 *
 * SYNTHETIC FIXTURE WARNING: real "Mes réponses" HTML could not be captured (a
 * browser guardrail blocked extraction). This parser is modelled on the portal's
 * PRADO results-table idiom (see ../watch/watch.parser.ts +
 * fixtures/mes-reponses.html) and NEEDS a live-HTML validation pass on first real
 * run — the table id, cell order and label wording may need adjustment.
 *
 * Defensive: a row that yields no référence or no date limite is skipped
 * (collected, never thrown) so one malformed row can never crash a crawl.
 */

/** A row that did not parse, kept so callers can log/count instead of dropping. */
export interface SkippedReponseRow {
  reason: string;
  text: string;
}

export interface ParseMesReponsesOutcome {
  submissions: readonly PortalSubmissionInput[];
  skipped: readonly SkippedReponseRow[];
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
 * Lets `labelled()` stop at the next line. Non-breaking spaces are normalised.
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

/** First "DD/MM/YYYY HH:mm" date in a fragment → UTC Date, or undefined. */
function firstDate(text: string): Date | undefined {
  const m = /(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/.exec(text);
  if (!m?.[1] || !m[2]) return undefined;
  return parsePmmpDate(`${m[1]} ${m[2]}`) ?? undefined;
}

/**
 * Splits the "Ma réponse" cell. The deposit timestamp is the first line that is
 * not the withdrawal line; the "Retiré le :" line — present only when we pulled
 * the bid — yields withdrawnAt.
 */
function parseReponseCell(reponseText: string): {
  submittedAt?: Date;
  withdrawnAt?: Date;
} {
  const retraitRaw = labelled(reponseText, /Retir[ée]\s+le/);
  const withdrawnAt = retraitRaw ? firstDate(retraitRaw) : undefined;
  const submittedLine = reponseText
    .split('\n')
    .find((line) => !/Retir[ée]\s+le/i.test(line));
  return { submittedAt: firstDate(submittedLine ?? ''), withdrawnAt };
}

/** Maps one results-table row to a PortalSubmissionInput, or null to skip it. */
function parseRow(row: CheerioSelection): PortalSubmissionInput | null {
  const cells = row.find('td');
  if (cells.length < MIN_CELLS) return null;
  const cell = (i: number) => cells.eq(i);

  const refText = stackedCellText(cell(0));
  const objetText = stackedCellText(cell(1));
  const deadlineText = stackedCellText(cell(2));
  const reponseText = stackedCellText(cell(3));

  const reference = labelled(refText, /R[ée]f[ée]rence/);
  if (!reference) return null; // a soumission with no référence is unusable

  const deadlineAt = firstDate(deadlineText);
  if (!deadlineAt) return null; // no date limite → no (reference, deadline) key

  const { submittedAt, withdrawnAt } = parseReponseCell(reponseText);

  return {
    reference,
    procedure: labelled(refText, /Proc[ée]dure/),
    category: labelled(refText, /Cat[ée]gorie/),
    objet: labelled(objetText, /Objet/),
    organisme: labelled(objetText, /Organisme/),
    deadlineAt,
    submittedAt,
    withdrawnAt,
    raw: { refText, objetText, deadlineText, reponseText },
  };
}

/**
 * Parses the "Mes réponses" page into PortalSubmissionInput rows. Locates the
 * results table (PRADO `tableau…` id, with a `table.table-results` fallback so a
 * markup change degrades gracefully), iterates body rows, and skips+collects any
 * row that fails — never throws on a single bad row.
 */
export function parseMesReponsesDetailed(html: string): ParseMesReponsesOutcome {
  const $ = cheerio.load(html);
  const rows = $('table[id*="tableau"] tbody tr');
  const selected = rows.length > 0 ? rows : $('table.table-results tbody tr');

  const submissions: PortalSubmissionInput[] = [];
  const skipped: SkippedReponseRow[] = [];

  selected.each((_, el) => {
    const row = $(el);
    if (row.find('th').length > 0 && row.find('td').length === 0) return; // header
    let parsed: PortalSubmissionInput | null;
    try {
      parsed = parseRow(row);
    } catch {
      parsed = null;
    }
    if (parsed) {
      submissions.push(parsed);
      return;
    }
    skipped.push({
      reason: 'no référence / no date limite / too few cells',
      text: row.text().replace(/\s+/g, ' ').trim().slice(0, MAX_SKIP_TEXT),
    });
  });

  return { submissions, skipped };
}

/**
 * Pure entrypoint requested by the crawler: the parsed PortalSubmissionInput rows.
 * Skipped rows are collected internally; use parseMesReponsesDetailed when the
 * caller wants to log the skip count (the crawler does, mirroring result.crawler).
 */
export function parseMesReponses(html: string): PortalSubmissionInput[] {
  return [...parseMesReponsesDetailed(html).submissions];
}
