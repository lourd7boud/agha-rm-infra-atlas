import { basename } from 'node:path';

const MONTH_NAMES = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout',
  'septembre', 'octobre', 'novembre', 'decembre',
];
const TABLE_MONTHS = ['janv', 'fevr', 'mars', 'avr', 'mai', 'juin', 'juil', 'aout', 'sept', 'oct', 'nov', 'dec'];
const CASABLANCA_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Casablanca' });

function plain(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function discoverMonthlyBulletins(sources: { url: string; label: string }[]) {
  const pattern = new RegExp(`^bareme[ ._-]+(${MONTH_NAMES.join('|')})[ ._-]+(20\\d{2})(?:-\\d+)?[-._]*\\.pdf$`);
  return sources.flatMap((source) => {
    const name = plain(decodeURIComponent(basename(new URL(source.url).pathname)));
    const match = pattern.exec(name);
    if (!match) return [];
    const month = String(MONTH_NAMES.indexOf(match[1]!) + 1).padStart(2, '0');
    return [{ ...source, month: `${match[2]}-${month}` }];
  }).sort((a, b) => a.month.localeCompare(b.month));
}

export function shiftIndexMonth(period: string, offset: number) {
  const first = new Date(`${period}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() + offset);
  return first.toISOString().slice(0, 7);
}

export function validateMonthlyBulletin(
  month: string, covers: { num: number; text: string }[], lastModified: string | null, observedAt: Date,
  globalHeadings?: string[],
) {
  const months = [0, 1, 2].map((offset) => ({
    month: shiftIndexMonth(month, offset),
    status: offset === 0 ? 'definitif' as const : 'provisoire' as const,
  }));
  const monthPattern = new RegExp(`\\b(${MONTH_NAMES.join('|')}|sepembre)\\s+(20\\d{2})\\s*(\\*{1,2})(?!\\*)`, 'g');
  const headingPattern = new RegExp(`\\b(${[...new Set([...MONTH_NAMES, ...TABLE_MONTHS])].join('|')})[.\\s-]+(20\\d{2}|\\d{2})(?!\\d)`, 'g');
  const expectedHeadings = months.map((period) => period.month).join(' ');
  const headings = (globalHeadings ?? []).map((heading) => [...plain(heading).matchAll(headingPattern)].map(([, name, year]) => {
    const index = Math.max(MONTH_NAMES.indexOf(name!), TABLE_MONTHS.indexOf(name!));
    return `${year!.length === 2 ? '20' : ''}${year}-${String(index + 1).padStart(2, '0')}`;
  }));
  if (headings.some((heading) => heading.length === 3 && heading.join(' ') !== expectedHeadings)) {
    throw new Error('Les dates lues dans les colonnes du barème contredisent les titres.');
  }
  const globalTablesAgree = headings.length === 2 && headings.every((heading) => heading.join(' ') === expectedHeadings);
  const agreement = covers.map(({ num, text }) => {
    const title = plain(text);
    const reference = /\bdatrp\s*\/\s*32\s*\/\s*(\d{2,6})\b/.exec(title)?.[1];
    const columns = [...title.matchAll(monthPattern)].map(([, name, year, marker]) => ({
      month: `${year}-${String(MONTH_NAMES.indexOf(name === 'sepembre' ? 'septembre' : name!) + 1).padStart(2, '0')}`,
      status: marker === '*' ? 'definitif' : 'provisoire',
    }));
    // When the global cover prints a one-year typo, both signed tables and
    // the main title must agree on the full period and all printed statuses.
    const globalCoverYearTypo = num === 6 && globalTablesAgree && columns.length === 3 &&
      columns[0]?.month === shiftIndexMonth(month, -12) && columns[0].status === 'definitif' &&
      JSON.stringify(columns.slice(1)) === JSON.stringify(months.slice(1));
    if (!reference || (!globalCoverYearTypo && JSON.stringify(columns) !== JSON.stringify(months))) {
      throw new Error('Les mois et les statuts lus ne correspondent pas au bulletin mensuel annoncé.');
    }
    return reference;
  });
  if (covers.length !== 2 || new Set(covers.map(({ num }) => num)).size !== 2 || new Set(agreement).size !== 1) {
    throw new Error('Les deux références du bulletin ne concordent pas.');
  }
  const modified = lastModified ? Date.parse(lastModified) : NaN;
  const publishedOn = Number.isFinite(modified) ? CASABLANCA_DAY.format(modified) : '';
  if (publishedOn < `${shiftIndexMonth(month, 1)}-01` || publishedOn > CASABLANCA_DAY.format(observedAt)) {
    throw new Error('La date de mise à disposition retournée par le ministère est absente ou incohérente.');
  }
  return { reference: `DATRP/32/${agreement[0]}`, publishedOn, months,
    publicationEvidence: `Date du fichier servi par le ministère (Last-Modified : ${lastModified}).` };
}

export function shouldApplyMonthlyIndex(
  current: { status: string; publishedOn: string | null; source?: string | null } | undefined,
  incoming: { status?: string; publishedOn?: string; source?: string },
) {
  if (current?.status === 'definitif' && incoming.status !== 'definitif') return false;
  if (!current?.publishedOn) return true;
  if (!incoming.publishedOn) return false;
  const order = compareOfficialIndexReferences(incoming.source, current.source);
  if (order) return order > 0;
  if (incoming.publishedOn < current.publishedOn) return false;
  if (incoming.publishedOn > current.publishedOn) return true;
  return incoming.status === 'definitif' && current.status !== 'definitif';
}

export function compareOfficialIndexReferences(left?: string | null, right?: string | null) {
  const issue = /^DATRP\/32\/(\d+)$/;
  const a = issue.exec(left ?? '')?.[1];
  const b = issue.exec(right ?? '')?.[1];
  return a && b ? Number(a) - Number(b) : 0;
}
