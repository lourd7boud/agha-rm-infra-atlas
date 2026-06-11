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
 * Extracts tenders from a PMMP search-results page. Rows that do not match
 * the expected structure are counted, never silently dropped.
 */
export function parsePmmpResults(html: string, baseUrl: string): ParseOutcome {
  const $ = cheerio.load(html);
  const rows = $('table[id$="tableauResultSearch"] tbody tr');
  const tenders: CreateTender[] = [];
  let skippedRows = 0;

  rows.each((_, row) => {
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
