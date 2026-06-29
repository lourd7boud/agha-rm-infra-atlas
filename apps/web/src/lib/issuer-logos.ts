/**
 * Real issuer logos mapped to normalized buyer-name fragments. The lookup is
 * substring-based on a normalized form (lower-case, accent-stripped, no
 * punctuation), so a single curated logo covers every regional sub-entity
 * that ships its tenders under the same umbrella (every "Direction Provinciale
 * de l'Equipement" provincial office matches the same pattern, etc.).
 *
 * Assets are PNG 1000x1000 sourced from datao's public Storage bucket and
 * committed to `apps/web/public/issuers/`. Add an entry to LOGO_RULES to wire
 * up a new logo: drop the .png into that folder and append a row here -- first
 * substring match wins, so put more-specific patterns ABOVE more-general ones.
 */

interface LogoRule {
  /** Lowercase, accent-free substring that must appear in the normalized name. */
  match: RegExp;
  /** Filename under /public/issuers (without the leading slash). */
  file: string;
}

/** Order matters: first match wins. Specific patterns first. */
const LOGO_RULES: readonly LogoRule[] = [
  { match: /\bofppt\b/, file: 'ofppt.png' },
  { match: /onee.*electricite|office national.*electricite/, file: 'onee-electricite.png' },
  {
    match: /direction provinciale.*equipement|direction provinciale.*transport.*logistique/,
    file: 'direction-provinciale-equipement-transport-logistique.png',
  },
  {
    match: /direction provinciale.*agriculture/,
    file: 'direction-provinciale-agriculture.png',
  },
  {
    match: /fonds d.equipement communal|\bfec\b/,
    file: 'fonds-equipement-communal.png',
  },
];

/** Normalize a buyer name for matching: lowercase, strip accents/diacritics,
 *  collapse punctuation+whitespace to single spaces. */
export function normalizeIssuerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Returns the public path to the curated logo for this issuer, or null when
 *  no rule matches -- the caller falls back to the initials avatar. */
export function lookupIssuerLogo(name: string): string | null {
  if (!name) return null;
  const normalized = normalizeIssuerName(name);
  for (const rule of LOGO_RULES) {
    if (rule.match.test(normalized)) {
      return `/issuers/${rule.file}`;
    }
  }
  return null;
}
