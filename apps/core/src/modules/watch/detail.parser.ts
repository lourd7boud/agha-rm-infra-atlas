/**
 * Stage-2 acquisition — the consultation detail page (Atexo MPE).
 *
 * The listing only yields stubs. Each consultation has a GET-accessible detail
 * page whose URL we can build from the (refConsultation, orgAcronyme) pair found
 * in the listing HTML. That detail page publishes the WHOLE structured metadata
 * block in its raw server HTML — every field is present (display:none until the
 * "+" toggle is clicked, but in the bytes an anonymous GET receives). datao
 * harvests exactly this published block first and only reaches for the DCE/LLM
 * for what it cannot find here.
 *
 * This parser therefore extracts the full published block (buyer entity, type
 * de procédure, mode de passation, lieu d'exécution, estimation, caution,
 * qualifications, agréments, domaines d'activité, adresses, prix des plans,
 * réservé PME, variante, réunion, visites des lieux, contact administratif,
 * nombre de lots, deadline). We match each detail back to a stored tender by
 * `reference`, avoiding fragile row-by-row table parsing.
 *
 * NOTE on estimation: the value is NOT under a plain `_estimation` span (that id
 * does not exist). It lives in a configurable "ReferentielZoneText" repeater —
 * a titre span ("Estimation (en Dhs TTC)") paired by ctl-index with a
 * labelReferentielZoneText value span. We pair them by index and pick the one
 * whose titre mentions estimation.
 */

const SUMMARY = 'idEntrepriseConsultationSummary';

/**
 * Schema version of the harvested detail block. Bump whenever parseDetailPage's
 * field set changes so the DB backfill (findDetailBackfillTargets) re-crawls rows
 * that were stamped by an older parser and picks up the newly-added fields.
 * v1 = {reference,objet,categorie,caution,estimation-broken}. v2 = full block.
 */
export const DETAIL_VERSION = 2;

export interface DetailLink {
  refConsultation: string;
  orgAcronyme: string;
  detailUrl: string;
}

/** One scheduled site visit published under "Visites des lieux". */
export interface PortalVisite {
  date: string | null;
  adresse: string | null;
}

/** The administrative contact block (the portal even publishes a télécopieur). */
export interface PortalContact {
  nom: string | null;
  email: string | null;
  telephone: string | null;
  telecopieur: string | null;
}

/**
 * Every field the consultation detail page publishes. The first five keys are
 * the legacy set (kept for the detail crawler's amount/reference logic); the
 * rest are the newly-harvested published metadata.
 */
export interface DetailFields {
  reference: string | null;
  objet: string | null;
  categorie: string | null;
  cautionProvisoireMad: number | null;
  estimationMad: number | null;
  // Newly harvested published metadata ↓
  buyerEntity: string | null;
  typeAnnonce: string | null;
  typeProcedure: string | null;
  modePassation: string | null;
  location: string | null;
  deadline: string | null;
  domainesActivite: string | null;
  adresseRetrait: string | null;
  adresseDepot: string | null;
  lieuOuverturePlis: string | null;
  prixAcquisitionPlansMad: number | null;
  reserveAuxPme: boolean | null;
  qualifications: string | null;
  agrements: string | null;
  prospectus: string | null;
  reunion: string | null;
  variante: boolean | null;
  lotCount: number | null;
  visites: PortalVisite[];
  contact: PortalContact;
}

/** "7 000,00 MAD" / "1 250 000,50 Dhs" → number (MAD), or null. */
export function parseMoneyMad(text: string | null | undefined): number | null {
  if (!text) return null;
  // Drop currency words and any non [digit , . space] noise, keep separators.
  const cleaned = text
    .replace(/ /g, ' ')
    .replace(/mad|dhs?|dirhams?|ttc|ht/gi, '')
    .trim();
  const m = /\d[\d .]*(?:,\d+)?/.exec(cleaned);
  if (!m) return null;
  // French format: space = thousands separator, comma = decimal.
  const normalized = m[0].replace(/[ ]/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Canonical GET detail/consultation URL from a (refConsultation, orgAcronyme) pair. */
export function buildDetailUrl(
  refConsultation: string,
  orgAcronyme: string,
  origin: string,
): string {
  return `${origin}/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=${refConsultation}&orgAcronyme=${orgAcronyme}`;
}

/** Matches one consultation detail link; tolerates `&amp;` from serialized HTML. */
const DETAIL_LINK_SOURCE =
  'EntrepriseDetailsConsultation&(?:amp;)?refConsultation=(\\d+)&(?:amp;)?orgAcronyme=([A-Za-z0-9_]+)';

/**
 * Reused (non-global) matcher for the single-match path. Kept distinct from the
 * per-call global regex in extractDetailLinks, whose stateful lastIndex must not
 * be shared.
 */
const DETAIL_LINK_REGEX = new RegExp(DETAIL_LINK_SOURCE);

/**
 * First consultation detail link in an HTML fragment, as a buildable GET URL.
 * Used to attach the canonical sourceUrl to a single listing row (the live
 * reference anchor is a `javascript:popUp(...)` with no usable href, but each
 * row also carries the détails/retraits links that embed the ref+org pair).
 */
export function firstDetailLink(html: string, baseUrl: string): DetailLink | null {
  const match = DETAIL_LINK_REGEX.exec(html);
  if (!match) return null;
  const refConsultation = match[1] as string;
  const orgAcronyme = match[2] as string;
  return {
    refConsultation,
    orgAcronyme,
    detailUrl: buildDetailUrl(refConsultation, orgAcronyme, safeOrigin(baseUrl)),
  };
}

/**
 * All distinct consultations referenced by the listing HTML, as buildable GET
 * detail URLs. Robust against the listing's table markup: it scans the whole
 * page for the detail-link query, not individual rows.
 */
export function extractDetailLinks(html: string, baseUrl: string): DetailLink[] {
  const origin = safeOrigin(baseUrl);
  const re = new RegExp(DETAIL_LINK_SOURCE, 'g');
  const seen = new Set<string>();
  const links: DetailLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const refConsultation = match[1] as string;
    const orgAcronyme = match[2] as string;
    const key = `${refConsultation}:${orgAcronyme}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      refConsultation,
      orgAcronyme,
      detailUrl: buildDetailUrl(refConsultation, orgAcronyme, origin),
    });
  }
  return links;
}

function safeOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'https://www.marchespublics.gov.ma';
  }
}

/** Decode the small set of HTML entities that appear in Atexo summary values. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)));
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : '';
}

/** Decode entities, collapse whitespace, trim; empty → null. */
function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const out = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return out.length > 0 ? out : null;
}

/**
 * Text of a labelled summary span `<... id="...SUMMARY_<field>">VALUE</...>`,
 * for values with no inner tags. Anchored on `"` after the field so
 * `lieuxExecutions` never captures `lieuxExecutionSuite`.
 */
function fieldText(html: string, field: string): string | null {
  const re = new RegExp(`id="[^"]*${SUMMARY}_${field}"[^>]*>([^<]*)`, 'i');
  return clean(re.exec(html)?.[1]);
}

/** Strip every tag from a fragment then clean — for list-valued spans (`<ul><li>`). */
function stripTags(fragment: string): string | null {
  return clean(fragment.replace(/<[^>]*>/g, ' '));
}

/**
 * Rich (may contain inner tags) value of a summary span. Used for the fields the
 * portal renders as a `<ul><li>` list: domaines d'activité, qualifications,
 * agréments. Non-greedy up to the closing `</span>`.
 */
function fieldRich(html: string, field: string): string | null {
  const re = new RegExp(
    `id="[^"]*${SUMMARY}_${field}"[^>]*>([\\s\\S]*?)</span>`,
    'i',
  );
  const inner = re.exec(html)?.[1];
  return inner === undefined ? null : stripTags(inner);
}

/** "Oui"/"Non" (case-insensitive) → boolean, else null. */
function parseOuiNon(value: string | null): boolean | null {
  if (!value) return null;
  if (/^oui$/i.test(value)) return true;
  if (/^non$/i.test(value)) return false;
  return null;
}

function parseIntOrNull(value: string | null): number | null {
  if (!value) return null;
  const m = /-?\d+/.exec(value);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Estimation lives in a "ReferentielZoneText" repeater: a titre span paired by
 * ctl-index with a labelReferentielZoneText value span (and a mirrored hidden
 * oldValue input). Pick the repeater whose titre mentions "estimation".
 */
function parseReferentielEstimation(html: string): number | null {
  const titreRe = /RepeaterReferentielZoneText_ctl(\d+)_titre"[^>]*>([^<]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = titreRe.exec(html))) {
    if (!/estimation/i.test(m[2] ?? '')) continue;
    const ctl = m[1]!;
    const labelRe = new RegExp(
      `RepeaterReferentielZoneText_ctl${ctl}_labelReferentielZoneText"[^>]*>([^<]*)`,
      'i',
    );
    const fromLabel = parseMoneyMad(labelRe.exec(html)?.[1]);
    if (fromLabel != null) return fromLabel;
    const oldRe = new RegExp(
      `RepeaterReferentielZoneText_ctl${ctl}_oldValue"[^>]*value="([^"]*)"`,
      'i',
    );
    const fromOld = parseMoneyMad(oldRe.exec(html)?.[1]);
    if (fromOld != null) return fromOld;
  }
  return null;
}

/** Réservé PME/TPE — idRefRadio RepeaterReferentielRadio label holds Oui/Non. */
function parseReserveAuxPme(html: string): boolean | null {
  const re =
    /RepeaterReferentielRadio_ctl\d+_labelReferentielRadio"[^>]*>([^<]*)/i;
  return parseOuiNon(clean(re.exec(html)?.[1]));
}

/** All published site visits (repeaterVisitesLieux ctl-indexed date + adresse). */
function parseVisites(html: string): PortalVisite[] {
  const dateRe = /repeaterVisitesLieux_ctl(\d+)_dateVisites"[^>]*>([^<]*)/gi;
  const visites: PortalVisite[] = [];
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(html))) {
    const ctl = m[1]!;
    const date = clean(m[2]);
    const adrRe = new RegExp(
      `repeaterVisitesLieux_ctl${ctl}_adresseVisites"[^>]*>([^<]*)`,
      'i',
    );
    const adresse = clean(adrRe.exec(html)?.[1]);
    if (date || adresse) visites.push({ date, adresse });
  }
  return visites;
}

/** Extract the publishable fields from a consultation detail page. */
export function parseDetailPage(html: string): DetailFields {
  const modePassationRaw = fieldText(html, 'modePassation');
  return {
    reference: fieldText(html, 'reference'),
    objet: fieldText(html, 'objet'),
    categorie: fieldText(html, 'categoriePrincipale'),
    cautionProvisoireMad: parseMoneyMad(fieldText(html, 'cautionProvisoire')),
    estimationMad: parseReferentielEstimation(html),
    buyerEntity: fieldText(html, 'entiteAchat'),
    typeAnnonce: fieldText(html, 'annonce'),
    typeProcedure: fieldText(html, 'typeProcedure'),
    // Published as " | Sur offre de prix" — drop the leading separator.
    modePassation: modePassationRaw
      ? modePassationRaw.replace(/^\|\s*/, '').trim() || null
      : null,
    location: fieldText(html, 'lieuxExecutions'),
    deadline: fieldText(html, 'dateHeureLimiteRemisePlis'),
    domainesActivite: fieldRich(html, 'domainesActivite'),
    adresseRetrait: fieldText(html, 'adresseRetraitDossiers'),
    adresseDepot: fieldText(html, 'adresseDepotOffres'),
    lieuOuverturePlis: fieldText(html, 'lieuOuverturePlis'),
    prixAcquisitionPlansMad: parseMoneyMad(fieldText(html, 'prixAcquisitionPlan')),
    reserveAuxPme: parseReserveAuxPme(html),
    qualifications: fieldRich(html, 'qualification'),
    agrements: fieldRich(html, 'agrements'),
    prospectus: fieldText(html, 'dateEchantillons'),
    reunion: fieldText(html, 'dateReunion'),
    variante: parseOuiNon(fieldText(html, 'varianteValeur')),
    lotCount: parseIntOrNull(fieldText(html, 'nbrLots')),
    visites: parseVisites(html),
    contact: {
      nom: fieldText(html, 'contactAdministratif'),
      email: fieldText(html, 'email'),
      telephone: fieldText(html, 'telephone'),
      telecopieur: fieldText(html, 'telecopieur'),
    },
  };
}
