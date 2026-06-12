import * as cheerio from 'cheerio';

/**
 * Result Miner (agent C1) — parser for PMMP published results
 * (résultats définitifs). Published data only (security-compliance §4.3).
 */

export interface PublishedResult {
  reference: string;
  buyerName: string;
  bidderName: string;
  amountMad?: number;
  isWinner: boolean;
  resultDate?: Date;
  sourceUrl?: string;
}

/** Parses Moroccan amount notation "1.234.567,89" into a number. */
export function parseMadAmount(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '');
  if (!/^[\d.]+,?\d*$/.test(cleaned)) return null;
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Parses "DD/MM/YYYY" into a UTC date. */
export function parseResultDate(text: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ResultsParseOutcome {
  results: readonly PublishedResult[];
  skippedRows: number;
}

export function parseResultsPage(
  html: string,
  sourceUrl: string,
): ResultsParseOutcome {
  const $ = cheerio.load(html);
  const rows = $('table[id$="tableauResultats"] tbody tr');
  const results: PublishedResult[] = [];
  let skippedRows = 0;

  rows.each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) {
      skippedRows += 1;
      return;
    }

    const reference = cells.eq(0).text().trim();
    const buyerName = cells.eq(1).text().trim();
    const bidderName = cells.eq(2).text().trim();
    const amountMad = parseMadAmount(cells.eq(3).text());
    const resultDate = parseResultDate(cells.eq(4).text());

    if (!reference || !buyerName || !bidderName) {
      skippedRows += 1;
      return;
    }

    results.push({
      reference,
      buyerName,
      bidderName,
      amountMad: amountMad ?? undefined,
      // Published results list the attributaire — the winner. Full bid lists
      // (all participants from PV extracts) arrive in intelligence stage M2.
      isWinner: true,
      resultDate: resultDate ?? undefined,
      sourceUrl,
    });
  });

  return { results, skippedRows };
}
