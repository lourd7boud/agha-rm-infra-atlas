import { parseMoneyMad } from './detail.parser';

/**
 * Stage-3 acquisition — published results / avis d'attribution (Atexo MPE).
 *
 * The attribution data (who won, at what price) is NOT in any HTML field: it is
 * a scanned-image notice ("Annonce de résultat définitif"), reached by submitting
 * the advanced-search form with annonceType=4 and downloading the AvisJAL image.
 * A vision LLM reads the image. These pure helpers build the search POST body,
 * locate the notice download URL, and parse the vision LLM's JSON.
 */

const ADV = 'ctl0$CONTENU_PAGE$AdvancedSearch';

/** Annonce types on the search form (verified live). */
export const ANNONCE_TYPE_RESULTAT_DEFINITIF = '4';
export const ANNONCE_TYPE_EXTRAIT_PV = '5';

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'https://www.marchespublics.gov.ma';
  }
}

/**
 * Replays the advanced-search form as a POST body with the result filter set.
 * Captures every submitted input/select/textarea (incl. the ~100 KB
 * PRADO_PAGESTATE) so the stateful search executes server-side.
 */
export function parseFormFields(formHtml: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of formHtml.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = m[1] ?? '';
    const type = (/\btype="([^"]*)"/i.exec(tag)?.[1] ?? 'text').toLowerCase();
    if (['submit', 'image', 'button', 'reset'].includes(type)) continue;
    const name = /\bname="([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) {
      continue;
    }
    fields[name] = decodeHtml(/\bvalue="([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  for (const s of formHtml.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const body = s[2] ?? '';
    const selected =
      /<option[^>]*\bselected\b[^>]*value="([^"]*)"/i.exec(body) ??
      /<option[^>]*value="([^"]*)"/i.exec(body);
    fields[s[1] as string] = selected?.[1] ?? '';
  }
  // Textareas are deliberately NOT submitted: the form's keyword textarea carries
  // a placeholder that, when posted, filters the result search down to zero.
  return fields;
}

export function buildResultSearchBody(
  formHtml: string,
  annonceType: string = ANNONCE_TYPE_RESULTAT_DEFINITIF,
): string {
  const fields = parseFormFields(formHtml);
  fields[`${ADV}$annonceType`] = annonceType;
  fields[`${ADV}$lancerRecherche`] = 'Lancer la recherche';
  return new URLSearchParams(fields).toString();
}

/** The scanned result-notice download URL on a result-consultation detail page. */
export function extractAvisDownloadUrl(
  detailHtml: string,
  baseUrl: string,
): string | null {
  const m =
    /EntrepriseDownloadAvisJAL&(?:amp;)?refConsultation=(\d+)&(?:amp;)?orgAcronyme=([A-Za-z0-9_]+)&(?:amp;)?idAvis=(\d+)/.exec(
      detailHtml,
    );
  if (!m) return null;
  return `${originOf(baseUrl)}/index.php?page=entreprise.EntrepriseDownloadAvisJAL&refConsultation=${m[1]}&orgAcronyme=${m[2]}&idAvis=${m[3]}`;
}

export interface ResultNotice {
  attributaire: string | null;
  acheteur: string | null;
  montantMad: number | null;
  estimationMad: number | null;
  objet: string | null;
  lisible: boolean;
}

/** Parses the vision LLM's JSON answer about a scanned result notice. */
export function parseResultNoticeJson(text: string): ResultNotice | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : typeof v === 'string'
        ? parseMoneyMad(v)
        : null;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  return {
    attributaire: str(obj['attributaire']),
    acheteur: str(obj['acheteur']),
    montantMad: num(obj['montant_attribue_mad']),
    estimationMad: num(obj['estimation_mad']),
    objet: str(obj['objet']),
    lisible: obj['lisible'] !== false,
  };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
