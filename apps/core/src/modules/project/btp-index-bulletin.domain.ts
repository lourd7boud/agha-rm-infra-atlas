export interface ParsedIndexBulletin {
  reference: string | null;
  documentDate: string | null;
  months: {
    month: string;
    status: 'provisoire' | 'definitif' | null;
    values: Record<string, number>;
    evidence: { code: string; value: number; page: number; line: string }[];
  }[];
  issues: string[];
}

const MONTHS = [
  'janvier|janv', 'fevrier|fevr|fev', 'mars', 'avril|avr', 'mai', 'juin',
  'juillet|juil', 'aout', 'septembre|sept', 'octobre|oct', 'novembre|nov', 'decembre|dec',
];
const MONTH_PATTERN = MONTHS.join('|');
const NUMBER = '(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)%?';

function plain(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

function monthTokens(text: string) {
  const pattern = new RegExp(`\\b(${MONTH_PATTERN})[.\\s-]+(20\\d{2}|\\d{2})(?!\\d)(\\*{1,2})?`, 'gi');
  return [...plain(text).matchAll(pattern)].map((match) => {
    const month = MONTHS.findIndex((alternatives) => new RegExp(`^(?:${alternatives})$`, 'i').test(match[1]!)) + 1;
    const year = match[2]!.length === 2 ? `20${match[2]}` : match[2]!;
    return { month: `${year}-${String(month).padStart(2, '0')}`, stars: match[3] ?? '' };
  });
}

/** Candidate extraction only. Saving reviewed values requires a separate explicit action. */
export function parseIndexBulletin(pages: { num: number; text: string }[]): ParsedIndexBulletin {
  const issues = new Set<string>();
  const states = new Map<string, Set<'provisoire' | 'definitif'>>();
  const references = new Set<string>();
  const documentDates = new Set<string>();

  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      for (const token of monthTokens(line)) {
        const status = token.stars === '*' ? 'definitif' : token.stars === '**' ? 'provisoire' : null;
        if (status) {
          const statuses = states.get(token.month) ?? new Set();
          statuses.add(status);
          states.set(token.month, statuses);
        }
      }
      for (const match of line.matchAll(/\bD[A-Z]{2,6}\/\d{1,5}\/\d{1,8}(?:\s+bis)?\b/g)) references.add(match[0]);
      const stamp = new RegExp(`^\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})\\.?\\s+(20\\d{2})\\s*$`, 'i').exec(plain(line));
      if (stamp) {
        const [month] = monthTokens(`${stamp[2]} ${stamp[3]}`);
        const day = `${month!.month}-${stamp[1]!.padStart(2, '0')}`;
        if (Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day) documentDates.add(day);
      }
    }
  }

  const proposals = new Map<string, ParsedIndexBulletin['months'][number]>();
  for (const [month, statuses] of states) {
    proposals.set(month, { month, status: statuses.size === 1 ? [...statuses][0]! : null, values: {}, evidence: [] });
  }
  const conflicts = new Set<string>();
  let omitted = 0;
  for (const page of pages) {
    let columns: string[] = [];
    let indexTable = false;
    let taxes = false;
    for (const rawLine of page.text.split(/\r?\n/)) {
      if (rawLine.length > 2_000) { omitted++; continue; }
      const line = plain(rawLine);
      if (/\b(?:INDEX.*(?:BASE|APPLICABLES?)|SYMBOLES?)\b/i.test(line)) indexTable = true;
      if (/^\s*TAXES\b/i.test(line)) taxes = true;
      const tokens = monthTokens(line);
      if (tokens.length && new Set(tokens.map((token) => token.month)).size === tokens.length && tokens.length <= 12) {
        columns = tokens.map((token) => token.month);
        continue;
      }
      if (!columns.length || (columns.length === 1 && !indexTable) || taxes) continue;
      const pattern = new RegExp(`(?:^| {2,})([A-Za-z][A-Za-z0-9/]{0,14})\\s+${columns.map(() => NUMBER).join('\\s+')}\\s*$`);
      const values = pattern.exec(line);
      if (!values) {
        if (new RegExp(`(?:${NUMBER}\\s+){${columns.length - 1}}${NUMBER}\\s*$`).test(line)) omitted++;
        continue;
      }
      const code = values[1]!;
      if (/^(?:TR|OA|BAT)(?!\d)/.test(code)) {
        issues.add(`Symbole ambigu à vérifier sur la page ${page.num} · ${code}.`);
        continue;
      }
      columns.forEach((month, index) => {
        const value = Number(values[index + 2]!.replace(/[ \u00a0]/g, '').replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
          issues.add(`Valeur à vérifier sur la page ${page.num} · ${month} · ${code}.`);
          return;
        }
        const statuses = states.get(month);
        let proposal = proposals.get(month);
        if (!proposal) {
          proposal = { month, status: statuses?.size === 1 ? [...statuses][0]! : null, values: {}, evidence: [] };
          proposals.set(month, proposal);
        }
        const key = `${month}:${code}`;
        if (conflicts.has(key)) return;
        if (Object.hasOwn(proposal.values, code) && proposal.values[code] !== value) {
          delete proposal.values[code];
          proposal.evidence = proposal.evidence.filter((evidence) => evidence.code !== code);
          conflicts.add(key);
          issues.add(`Valeurs contradictoires à vérifier · ${month} · ${code}.`);
          return;
        }
        if (!Object.hasOwn(proposal.values, code)) {
          proposal.values[code] = value;
          proposal.evidence.push({ code, value, page: page.num, line: rawLine.trim() });
        }
      });
    }
  }
  const months = [...proposals.values()].sort((left, right) => left.month.localeCompare(right.month));
  for (const month of months) if (!month.status) issues.add(`Confirmer le caractère provisoire ou définitif du mois ${month.month}.`);
  if (omitted) issues.add(`${omitted} ligne(s) sans symbole lisible nécessitent une vérification dans le document.`);
  if (months.length === 0) issues.add('Aucune table mensuelle exploitable. Vérifiez la lecture du document et saisissez les cellules manquantes.');
  if (documentDates.size !== 1) issues.add('Le cachet du document doit être vérifié. La date de publication reste à confirmer.');
  issues.add('Relire les symboles et les valeurs extraites avec la page du barème avant enregistrement.');
  return { reference: references.size ? [...references].join(' · ') : null,
    documentDate: documentDates.size === 1 ? [...documentDates][0]! : null, months, issues: [...issues] };
}
