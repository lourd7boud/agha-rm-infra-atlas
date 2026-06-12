import * as cheerio from 'cheerio';
import type { TenderProcedure } from '@atlas/contracts';
import type { CreateTender } from '../tender/tender.repository';

// Morocco is UTC+1 year-round (since 2018); PMMP shows local times.
// Ramadan clock changes are ignored deliberately — one hour of slack is
// always reclaimed by the J-1 submission milestone.
const MOROCCO_UTC_OFFSET_HOURS = 1;

const PROCEDURE_LABELS: ReadonlyArray<[needle: string, value: TenderProcedure]> = [
  ["appel d'offres ouvert", 'AOO'],
  ["appel d'offres restreint", 'AOR'],
  ['concours', 'concours'],
  ['négoci', 'negocie'],
  ['bons de commande', 'bons_de_commande'],
];

export function mapProcedure(label: string): TenderProcedure | null {
  const normalized = label.toLowerCase();
  const match = PROCEDURE_LABELS.find(([needle]) => normalized.includes(needle));
  return match ? match[1] : null;
}

/** Parses "DD/MM/YYYY HH:mm" (PMMP local time) into a UTC Date. */
export function parsePmmpDate(text: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - MOROCCO_UTC_OFFSET_HOURS,
    Number(minute),
  );
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ParseOutcome {
  tenders: readonly CreateTender[];
  skippedRows: number;
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
      sourceUrl: href ? new URL(href, baseUrl).toString() : undefined,
    });
  });

  return { tenders, skippedRows };
}

/**
 * Live PMMP layout (table.table-results, Atexo MPE), column order verified
 * against the live portal: [0] checkbox, [1] procédure, [2] référence +
 * "Objet :"objet, [3] acheteur, [4] date+heure (often concatenated),
 * [5..] noise. Reference is the anchor in the objet cell, falling back to
 * the leading token before " - " or "Objet".
 */
function parseLiveLayout($: cheerio.CheerioAPI, baseUrl: string): ParseOutcome {
  const tenders: CreateTender[] = [];
  let skippedRows = 0;

  $('table.table-results tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) {
      skippedRows += 1;
      return;
    }
    const procedure = mapProcedure(cells.eq(1).text());
    const refCell = cells.eq(2);
    const refText = refCell.text();
    const anchor = refCell.find('a').first();
    const reference =
      anchor.text().trim() ||
      cleanCell(refText.split(/ - |objet\s*:/i)[0] ?? '');
    const href = anchor.attr('href');
    const objetMatch = /objet\s*:\s*(.+)/is.exec(refText);
    const objet = objetMatch?.[1] ? cleanCell(objetMatch[1]) : '';
    const buyerName = cleanCell(cells.eq(3).text());
    const deadlineAt = firstPmmpDate(cells.eq(4).text());

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
      sourceUrl: href ? new URL(href, baseUrl).toString() : undefined,
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
export function parsePmmpResults(html: string, baseUrl: string): ParseOutcome {
  const $ = cheerio.load(html);
  const fixture = parseFixtureLayout($, baseUrl);
  if (fixture.tenders.length > 0) return fixture;

  const live = parseLiveLayout($, baseUrl);
  if (live.tenders.length > 0) return live;

  // Neither layout matched: report the union of skipped rows so coverage
  // surfaces a parser miss instead of a false "0 tenders, all fine".
  return { tenders: [], skippedRows: fixture.skippedRows + live.skippedRows };
}
