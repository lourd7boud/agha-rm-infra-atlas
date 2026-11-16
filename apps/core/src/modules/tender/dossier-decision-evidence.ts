import type { DossierFileOcr } from './dossier-file-ocr';

export type DossierDecisionTopic = 'visit' | 'qualifications' | 'guarantee' | 'submission' | 'required_documents' | 'execution';

export interface DossierDecisionExcerpt {
  topic: DossierDecisionTopic;
  filename: string;
  sha256: string;
  page: number;
  quote: string;
  layout?: 'table';
}

interface TopicRule {
  topic: DossierDecisionTopic;
  anchor: RegExp;
  details: readonly RegExp[];
}

const RULES: readonly TopicRule[] = [
  {
    topic: 'visit',
    anchor: /\bvisites? (?:des lieux|du site|sur site)\b/giu,
    details: [/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/u, /\b\d{1,2}\s*(?:h|:)\s*\d{2}\b/iu, /\b(?:obligatoire|facultative|aura lieu|auront lieu|n['’]est pas pr[ée]vue|n['’]est pas exig[ée]e)\b/iu],
  },
  {
    topic: 'qualifications',
    anchor: /\b(?:certificat(?:s)? de qualification(?: et de classification)?|qualifications? (?:et classifications?|exig[ée]es?)|secteur d['’]activit[ée] qualification classe|agr[ée]ments? exig[ée]s?)\b/giu,
    details: [/\b(?:classe|secteur|classification)\b/iu, /\b(?:justifi(?:er|ant)|concurrents? install[ée]s?|exig[ée]s?|copie|d[ée]livr[ée])\b/iu, /\b[A-Z][0-9]{1,3}\b/u, /\bclasse\s*\d+\b/iu],
  },
  {
    topic: 'guarantee',
    anchor: /\b(?:caution(?:nement)? provisoire|caution personnelle et solidaire)\b/giu,
    details: [/\b(?:MAD|dirhams?|DH)\b/iu, /\b(?:fix[ée]e?|montant|constitu[ée]e?|constitution|r[ée]c[ée]piss[ée]|dispens[ée]e?)\b/iu],
  },
  {
    topic: 'submission',
    anchor: /\b(?:d[ée]p[ôo]t (?:des (?:plis|offres)|[ée]lectronique)|remise des (?:plis|offres)|date limite de (?:d[ée]p[ôo]t|remise))\b/giu,
    details: [/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/u, /\b(?:[ée]lectronique|portail|avant|heure limite)\b/iu, /\b(?:doivent|obligatoirement|exclusivement|re[çc]us?)\b/iu],
  },
  {
    topic: 'required_documents',
    anchor: /\b(?:pi[èe]ces (?:[àa] fournir|exig[ée]es?)|dossier (?:administratif|technique)|contenu des dossiers? des concurrents?)\b/giu,
    details: [/\b(?:d[ée]claration sur l['’]honneur|attestation|certificat|r[ée]c[ée]piss[ée]|statuts|pouvoirs?)\b/iu, /\b(?:comprend|doit contenir|pi[èe]ces suivantes|documents suivants)\b/iu],
  },
  {
    topic: 'execution',
    anchor: /\b(?:d[ée]lais? (?:d['’]ex[ée]cution|de r[ée]alisation)|dur[ée]e (?:d['’]ex[ée]cution|du march[ée])|ordre de service de commencement)\b/giu,
    details: [/\b(?:jour[s]?|mois|ans?|semaines?)\b/iu, /\b(?:court|compter|fix[ée]|dur[ée]e|d[ée]lai)\b/iu],
  },
];

const MAX_QUOTE = 300;
const CONTENTS_TITLE = /^\s*(?:sommaire|table des mati[èe]res)(?:\s+du\s+(?:r[èe]glement|cahier).*)?\s*$/imu;
const CONTENTS_ROW = /(?:\.{3,}|…+|\u00b7{3,})\s*\d+\s*$/u;
const CONTENTS_SECTION = /^\s*(?:article|art\.)\s*[\d.]+\s*[:\-–]?\s*.+?\s{2,}\d+\s*$/imu;
const QUALIFICATION_TABLE = /^secteur d['’]activit[ée] qualification classe\b/iu;
const VISIT_OBLIGATION = /\bvisites? (?:des lieux|du site|sur site)\b[^.!?]{0,72}\b(?:obligatoires?|facultatives?|non exig[ée]es?)\b/iu;

function isContentsRow(line: string): boolean {
  return CONTENTS_ROW.test(line) || CONTENTS_SECTION.test(line);
}

function pageSections(page: string): string[] {
  if (CONTENTS_TITLE.test(page)) return [];
  const sections: string[] = [];
  let lines: string[] = [];
  let contentsRows = 0;
  for (const line of page.split(/\r?\n/u)) {
    if (isContentsRow(line)) {
      // Keep a quote contiguous in the original page. Never bridge a removed row.
      if (lines.length) sections.push(normalized(lines.join('\n')));
      lines = [];
      contentsRows++;
      if (contentsRows >= 3) return [];
    } else {
      lines.push(line);
    }
  }
  if (lines.length) sections.push(normalized(lines.join('\n')));
  return sections;
}

export function dossierDecisionFileKind(filename: string): 'rc' | 'cps' | null {
  const leaf = filename.split(/[/\\]/).pop() ?? '';
  if (!/\.pdf$/iu.test(leaf)) return null;
  if (/(?:^|[^\p{L}\p{N}])rc(?:[^\p{L}\p{N}]|$)|r[èe]glement[ _-]+de[ _-]+consultation/iu.test(leaf)) return 'rc';
  if (/(?:^|[^\p{L}\p{N}])cps(?:[^\p{L}\p{N}]|$)|cahier[ _-]+des[ _-]+prescriptions/iu.test(leaf)) return 'cps';
  return null;
}

function normalized(text: string): string {
  return text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/\s+/gu, ' ').trim();
}

function quoteAt(text: string, index: number, heading: string | undefined): string {
  const earliest = Math.max(0, index - 64);
  const sentenceBoundary = text.lastIndexOf('. ', index);
  let start = heading ? index - heading.length : sentenceBoundary >= earliest ? sentenceBoundary + 2 : earliest;
  if (start > 0 && text[start - 1] !== ' ') {
    const boundary = text.indexOf(' ', start);
    if (boundary >= 0 && boundary < index) start = boundary + 1;
  }

  // Preserve words at the cut without inserting text absent from the source.
  let end = Math.min(start + MAX_QUOTE, text.length);
  if (end < text.length && text[end] !== ' ') {
    const boundary = text.lastIndexOf(' ', end);
    if (boundary > index) end = boundary;
  }
  return text.slice(start, end).trim();
}

/** Search source-bound OCR. Every result is an excerpt, with no inferred obligation. */
export function extractDossierDecisionExcerpts(files: readonly DossierFileOcr[]): DossierDecisionExcerpt[] {
  const picked = new Map<DossierDecisionTopic, { score: number; excerpt: DossierDecisionExcerpt }>();
  const sortedFiles = files.slice(0, 4).sort((a, b) => a.filename.localeCompare(b.filename, 'fr') || a.sha256.localeCompare(b.sha256));

  for (const file of sortedFiles) {
    const kind = dossierDecisionFileKind(file.filename);
    if (!kind || file.state === 'failed') continue;

    for (const page of file.pages) {
      if (page.state !== 'text') continue;

      for (const text of pageSections(page.text)) {
        for (const rule of RULES) {
          for (const match of text.matchAll(rule.anchor)) {
            if (match.index === undefined) continue;
            const heading = /(?:article|art\.)\s*\d+[a-z]?\s*[:.–-]?\s*$/iu.exec(text.slice(Math.max(0, match.index - 35), match.index))?.[0];
            const quote = quoteAt(text, match.index, heading);
            const details = rule.details.filter(pattern => pattern.test(quote)).length;
            if (details === 0 || quote.length <= match[0].length + 24) continue;

            const preferredKind = rule.topic === 'execution' ? 'cps' : 'rc';
            const qualificationTable = rule.topic === 'qualifications' && QUALIFICATION_TABLE.test(quote);
            const directRequirement = qualificationTable ||
              rule.topic === 'visit' && VISIT_OBLIGATION.test(quote);
            const score = details * 4 + (heading ? 3 : 0) + (kind === preferredKind ? 2 : 0) + (directRequirement ? 16 : 0);
            if (score > (picked.get(rule.topic)?.score ?? 0)) {
              picked.set(rule.topic, { score, excerpt: {
                topic: rule.topic, filename: file.filename, sha256: file.sha256, page: page.num, quote,
                ...(qualificationTable ? { layout: 'table' as const } : {}),
              } });
            }
          }
        }
      }
    }
  }

  return RULES.flatMap(({ topic }) => {
    const pick = picked.get(topic);
    return pick ? [pick.excerpt] : [];
  });
}
