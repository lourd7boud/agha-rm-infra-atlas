import * as cheerio from 'cheerio';
import { parsePmmpDate, parsePmmpDeadline, type TenderProcedure } from '@atlas/contracts';
import type { CreateTender } from '../tender/tender.repository';
import { firstDetailLink, parseMoneyMad } from './detail.parser';
import { pmmpIdentity } from './watch-audit';

export { parsePmmpDate } from '@atlas/contracts';

const PROCEDURE_LABELS: ReadonlyArray<[needle: string, value: TenderProcedure]> = [
  ['concours architectural', 'concours_architectural'],
  ['consultation architecturale', 'consultation_architecturale'],
  ['partenariat public-prive', 'partenariat_public_prive'],
  ["manifestation d'interet", 'manifestation_interet'],
  ['avec preselection', 'preselection'],
  ['demande de cotation', 'demande_cotation'],
  ['dialogue competitif', 'dialogue_competitif'],
  ['enchere electronique', 'enchere_electronique'],
  ["appel d'offres ouvert", 'AOO'],
  ["appel d'offres restreint", 'AOR'],
  ['concours', 'concours'],
  ['negoci', 'negocie'],
  ['bons de commande', 'bons_de_commande'],
];

export function mapProcedure(label: string): TenderProcedure | null {
  const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘ʼ]/g, "'").replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const match = PROCEDURE_LABELS.find(([needle]) => normalized.includes(needle));
  return match ? match[1] : null;
}

export interface ParseOutcome {
  tenders: readonly CreateTender[];
  skippedRows: number;
  layout?: 'cards' | 'table' | 'fixture';
  portalTotal?: number;
  sourceIdentities?: readonly (string | null)[];
}

/** PMMP redesign: cards keep PRADO identities/pager but no result table. */
function parseCards($: cheerio.CheerioAPI, baseUrl: string, captureIdentities: boolean): ParseOutcome {
  const tenders: CreateTender[] = [];
  const sourceIdentities: (string | null)[] = [];
  let skippedRows = 0;
  $('.tender_item').each((_, card) => {
    const row = $(card);
    if (captureIdentities) {
      const identities = row.find('a[href*="refConsultation="][href*="orgAcronyme="]').toArray();
      const identity = identities.map((link) => pmmpIdentity($(link).attr('href') ?? '', baseUrl)).find(Boolean);
      sourceIdentities.push(identity ?? null);
    }
    const reference = cleanCell(row.find('[id$="_referencem"]').first().text());
    const badge = row.find('.verticalText [title]').first();
    const procedure = mapProcedure(badge.attr('title') ?? row.find('.verticalText').text());
    const objet = panelValue(row.find('.p-objet').first());
    const buyerName = panelValue(row.find('.title.p-card .a-card').first());
    const location = panelValue(row.find('[id$="panelBlocLieuxExec"]').first()) || undefined;
    const deadlineAt = parsePmmpDeadline(row.find('.leftColumn').first().text().replace(/\s+/g, ' '));
    const sourceUrl = resolveSourceUrl(row.html() ?? '', undefined, baseUrl);
    const estimationMad = parseMoneyMad(row.find('[id$="_estimationLabel"]').first().text());
    if (!reference || !procedure || !objet || !buyerName || !deadlineAt || !sourceUrl) {
      skippedRows += 1;
      return;
    }
    tenders.push({ reference, procedure, objet, buyerName, location, deadlineAt, sourceUrl,
      ...(estimationMad != null ? { estimationMad } : {}),
    });
  });
  return { tenders, skippedRows, layout: 'cards', ...(captureIdentities ? { sourceIdentities } : {}) };
}

/**
 * Pulls a deadline out of a noisy cell. The live Atexo portal concatenates
 * the date and time with no separator ("15/07/202910:00"); the recorded
 * fixture uses a space. Both normalize to "DD/MM/YYYY HH:mm".
 */
function firstPmmpDate(text: string): Date | null {
  const match = /(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/.exec(text);
  return match?.[1] && match[2]
    ? parsePmmpDate(`${match[1]} ${match[2]}`)
    : null;
}

/** Cleans an Atexo cell: collapse whitespace, drop leading dashes/dots. */
function cleanCell(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s. -]+/, '')
    .trim();
}

/**
 * Per-row sourceUrl, the join key for download/Soumission. The live reference
 * anchor is a `javascript:popUp(...)` with no usable href, so we first mine the
 * row's own détails/retraits links for the canonical
 * `EntrepriseDetailsConsultation&refConsultation=…&orgAcronyme=…` pair. Only if
 * that is absent (synthetic fixtures) do we fall back to a real anchor href.
 */
function resolveSourceUrl(
  rowHtml: string,
  href: string | undefined,
  baseUrl: string,
): string | undefined {
  const detail = firstDetailLink(rowHtml, baseUrl);
  if (detail) return detail.detailUrl;
  // Fallback for non-PRADO/recorded sources: accept a real anchor href only if
  // it resolves to a download-capable consultation link (refConsultation +
  // orgAcronyme). This keeps the invariant that every stored sourceUrl is
  // parseable by the dossier downloader, never a half-formed URL.
  if (!href || href.startsWith('javascript:') || href.startsWith('#')) {
    return undefined;
  }
  let absolute: string;
  try {
    absolute = new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
  return firstDetailLink(absolute, baseUrl)?.detailUrl;
}

/**
 * Recorded-fixture layout (table id …tableauResultSearch): one row per
 * tender, columns reference / objet / buyer / deadline.
 */
function parseFixtureLayout(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): ParseOutcome {
  const tenders: CreateTender[] = [];
  let skippedRows = 0;

  $('table[id$="tableauResultSearch"] tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) {
      skippedRows += 1;
      return;
    }
    const refCell = cells.eq(0);
    const reference = refCell.find('a').first().text().trim();
    const procedure = mapProcedure(refCell.find('.procedure').first().text());
    const objet = cells.eq(1).text().trim();
    const buyerName = cells.eq(2).text().trim();
    const deadlineAt = parsePmmpDate(cells.eq(3).text());
    const href = refCell.find('a').first().attr('href');

    if (!reference || !procedure || !objet || !buyerName || !deadlineAt) {
      skippedRows += 1;
      return;
    }
    tenders.push({
      reference,
      buyerName,
      procedure,
      objet,
      deadlineAt,
      sourceUrl: resolveSourceUrl($(row).html() ?? '', href, baseUrl),
    });
  });

  return { tenders, skippedRows };
}

/** A `$(...)` / `.find(...)` element selection — typed without naming AnyNode. */
type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

/**
 * Reads an Atexo result-panel value. Long objets/buyers/locations are shown
 * truncated inline (ending in an "…" `.info-suite` link) with the full text
 * repeated in a hidden `.info-bulle` tooltip; short ones sit inline after a
 * `<strong>` label. Prefer the tooltip's complete value, else the visible text
 * minus the label and the "…" link. This is why the legacy parser stored a
 * doubled "GUELMIM … GUELMIM, …" — it concatenated both halves verbatim.
 */
function panelValue($el: CheerioSelection): string {
  if ($el.length === 0) return '';
  const full = $el.find('.info-bulle').first().text().replace(/\s+/g, ' ').trim();
  if (full) return full;
  const clone = $el.clone();
  clone.find('strong, .info-suite, .info-bulle').remove();
  // A multi-value panel separates entries with <br> and no whitespace; cheerio's
  // .text() would glue them ("RabatSaleKenitra"). Turn line breaks into commas,
  // then squeeze/trim repeated separators (consecutive <br><br> are common).
  clone.find('br').replaceWith(', ');
  return clone
    .text()
    .replace(/\s+/g, ' ')
    .replace(/(?:,\s*)+/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/**
 * Live PMMP layout (table.table-results, Atexo MPE). Each result row carries
 * stable, id-suffixed panels we read by preference — far more robust than the
 * old positional-cell guesswork that mistook the lieu d'exécution for the
 * acheteur and glued the objet onto the référence:
 *   • span.ref                     → clean référence (no glued objet suffix)
 *   • [id$=panelBlocDenomination]  → real acheteur ("Acheteur public : …")
 *   • [id$=panelBlocObjet]         → objet (full, from the tooltip when long)
 *   • [id$=panelBlocLieuxExec]     → lieu d'exécution (location)
 * Procédure stays in cell [1], the deadline in cell [4] (date+heure, often
 * concatenated). Positional-cell fallbacks remain so a markup change degrades
 * instead of breaking. The référence anchor is a javascript:popUp(...), so the
 * canonical sourceUrl is mined from the row's détails/retraits links.
 */
function parseLiveLayout($: cheerio.CheerioAPI, baseUrl: string): ParseOutcome {
  const tenders: CreateTender[] = [];
  let skippedRows = 0;

  $('table.table-results tbody tr').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    if (cells.length < 5) {
      skippedRows += 1;
      return;
    }
    const refCell = cells.eq(2);
    const refText = refCell.text();
    const procedure = mapProcedure(cells.eq(1).text());

    const reference =
      $row.find('span.ref').first().text().trim() ||
      refCell.find('a').first().text().trim() ||
      cleanCell(refText.split(/ - |objet\s*:/i)[0] ?? '');

    // Real acheteur from the denomination panel ONLY. We deliberately do NOT
    // fall back to a positional cell: cell [3] is the lieu d'exécution, so a
    // fallback there would silently re-introduce the buyer==location bug (and,
    // via the source_url heal, overwrite a previously-correct acheteur). If the
    // panel is absent the row is skipped below — better dropped than mislabeled.
    const buyerName = panelValue($row.find('[id$="panelBlocDenomination"]').first());

    const objetMatch = /objet\s*:\s*(.+)/is.exec(refText);
    const objet =
      panelValue($row.find('[id$="panelBlocObjet"]').first()) ||
      (objetMatch?.[1] ? cleanCell(objetMatch[1]) : '');

    const location =
      panelValue($row.find('[id$="panelBlocLieuxExec"]').first()) || undefined;

    const deadlineAt = firstPmmpDate(cells.eq(4).text());
    const href = refCell.find('a').first().attr('href');

    if (!reference || !procedure || !objet || !buyerName || !deadlineAt) {
      skippedRows += 1;
      return;
    }
    tenders.push({
      reference,
      buyerName,
      procedure,
      objet,
      location,
      deadlineAt,
      sourceUrl: resolveSourceUrl($row.html() ?? '', href, baseUrl),
    });
  });

  return { tenders, skippedRows };
}

/**
 * Extracts tenders from a PMMP search-results page. Parser fallback chain:
 * the recorded-fixture layout is tried first, then the live Atexo layout —
 * so a portal markup change degrades to the other path instead of silently
 * yielding nothing. Rows that don't match are counted, never dropped.
 */
export function parsePmmpResults(html: string, baseUrl: string, captureIdentities = false): ParseOutcome {
  const $ = cheerio.load(html);
  const rawTotal = $('[id$="resultSearch_nombreElement"]').first().text().replace(/\s/g, '');
  const portalTotal = /^\d+$/.test(rawTotal) ? Number(rawTotal) : undefined;
  if ($('.tender_item').length > 0) return { ...parseCards($, baseUrl, captureIdentities), portalTotal };
  const fixture = parseFixtureLayout($, baseUrl);
  if (fixture.tenders.length > 0) return { ...fixture, layout: 'fixture', portalTotal };

  const live = parseLiveLayout($, baseUrl);
  if (live.tenders.length > 0) return { ...live, layout: 'table', portalTotal };

  // Neither layout matched: report the union of skipped rows so coverage
  // surfaces a parser miss instead of a false "0 tenders, all fine".
  return { tenders: [], skippedRows: fixture.skippedRows + live.skippedRows, portalTotal };
}
