import {
  CATALOG_RESOLVER,
  FALLBACK_RULES,
  NAME_TO_ASSET,
} from './issuer-logos.data';

/** Datao's universal fallback: the Coat of Arms of Morocco (Royal emblem).
 *  Shown by datao for every issuer without a curated logo (Communes, Wilayas,
 *  Provinces, Délégations, Conseils, foreign agencies …). Visual identity is
 *  uniform but never blank, so the page reads as "complete catalogue". */
export const DEFAULT_ISSUER_EMBLEM = '/issuers/datao/84919d13-8cb6-4d13-83d1-65b0bb1d4107.png';

/** Normalize a buyer name for matching: lowercase, strip accents/diacritics,
 *  collapse punctuation+whitespace to single spaces. */
export function normalizeIssuerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Article-stripping pass used by the catalog-resolver fallback below: drops
 *  a leading "la|le|les|l" article and collapses common French conjugatives
 *  ("de", "du", "des", "et", "au", "aux") that PMP buyer-names sprinkle but
 *  datao's canonical name omits. Lets "Société Nationale de Radiodiffusion…"
 *  match datao's "LA SOCIETE NATIONALE DE RADIODIFFUSION…". */
function stripArticlesAndConjugatives(s: string): string {
  return s
    .replace(/^(la|le|les|l)\s+/, '')
    .replace(/\s+(la|le|les|l|de|du|des|et|d|au|aux)\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the public path to the curated logo for this issuer, or null when
 *  no rule matches — the caller falls back to the initials avatar.
 *  Three layers, most-specific first:
 *    1. exact normalized-name table (970 curated entries)
 *    2. substring-regex FALLBACK_RULES (48 catch-alls for regions/CHU/etc.)
 *    3. catalog resolver (1799 keys generated from all 1049 datao issuers,
 *       includes alt_name + article-stripped variants for fuzzier matching) */
export function lookupIssuerLogo(name: string): string | null {
  if (!name) return null;
  const normalized = normalizeIssuerName(name);
  const exact = NAME_TO_ASSET[normalized];
  if (exact) return `/issuers/datao/${exact}`;
  for (const rule of FALLBACK_RULES) {
    if (rule.match.test(normalized)) return `/issuers/datao/${rule.file}`;
  }
  const resolverHit = CATALOG_RESOLVER[normalized];
  if (resolverHit) return `/issuers/datao/${resolverHit}`;
  const stripped = stripArticlesAndConjugatives(normalized);
  if (stripped !== normalized) {
    const strippedHit = CATALOG_RESOLVER[stripped];
    if (strippedHit) return `/issuers/datao/${strippedHit}`;
  }
  return null;
}
