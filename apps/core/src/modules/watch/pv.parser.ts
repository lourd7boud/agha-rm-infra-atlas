import { parseMoneyMad } from './detail.parser';

/**
 * Stage-3b acquisition — extrait de procès-verbal (annonceType=5, Atexo MPE).
 *
 * Where the "résultat définitif" notice (annonceType=4) shows only the winner,
 * the PV extract lists the WHOLE field: every soumissionnaire, their montant,
 * who was retained, and — crucially — the administrative estimation. Reading it
 * fills the recovered-rebate calibration (winner + estimation) AND builds the
 * competitor database (every bidder's price). The document is a scanned image,
 * so a vision LLM reads it; these pure helpers parse the model's JSON answer.
 *
 * Reuses the v4 search/notice plumbing (buildResultSearchBody with
 * ANNONCE_TYPE_EXTRAIT_PV, extractAvisDownloadUrl) — see result.parser.
 */

export interface PvBidder {
  name: string;
  montantMad: number | null;
  isWinner: boolean;
}

export interface ExtraitPv {
  acheteur: string | null;
  objet: string | null;
  estimationMad: number | null;
  soumissionnaires: PvBidder[];
  lisible: boolean;
}

export const EXTRAIT_PV_VISION_PROMPT =
  "Ceci est un extrait de procès-verbal (PV) de jugement d'un marché public " +
  'marocain (image scannée). Il liste TOUS les soumissionnaires et leurs ' +
  'montants. Extrais STRICTEMENT en JSON, sans aucun texte autour: ' +
  '{"acheteur": maître d\'ouvrage / acheteur public ou null, ' +
  '"objet": objet du marché (court) ou null, ' +
  '"estimation_mad": estimation administrative du maître d\'ouvrage en dirhams (number) ou null, ' +
  '"soumissionnaires": [{"nom": raison sociale du soumissionnaire (string), ' +
  '"montant_mad": montant de son offre en dirhams — lis avec PRÉCISION la virgule ' +
  'décimale; les espaces sont des séparateurs de milliers, PAS la virgule ' +
  '(ex: "1 177 913,89" = 1177913.89, surtout pas un milliard) (number) ou null, ' +
  '"retenu": true si ce soumissionnaire est l\'attributaire retenu, false sinon}], ' +
  '"lisible": true si l\'image est lisible sinon false}. ' +
  'Inclus CHAQUE soumissionnaire, y compris ceux écartés. Ne fabrique aucun montant.';

/** Parses the vision LLM's JSON answer about a scanned PV extract. */
export function parseExtraitPvJson(text: string): ExtraitPv | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>;
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

  const rawList = Array.isArray(obj['soumissionnaires'])
    ? obj['soumissionnaires']
    : [];
  const soumissionnaires: PvBidder[] = [];
  for (const entry of rawList) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = str(e['nom']);
    if (!name) continue; // a bidder with no company name is unusable
    soumissionnaires.push({
      name,
      montantMad: num(e['montant_mad']),
      isWinner: e['retenu'] === true,
    });
  }

  // A correctly-read PV has exactly one attributaire. If the vision flags more
  // than one retenu, keep the winner only on the lowest-montant entry so a
  // single tender can never contribute two winners to the rebate sample.
  const winners = soumissionnaires.filter((s) => s.isWinner);
  const keptWinner =
    winners.length > 1
      ? [...winners].sort(
          (a, b) => (a.montantMad ?? Infinity) - (b.montantMad ?? Infinity),
        )[0]
      : winners[0];
  const reconciled =
    winners.length > 1
      ? soumissionnaires.map((s) => ({ ...s, isWinner: s === keptWinner }))
      : soumissionnaires;

  return {
    acheteur: str(obj['acheteur']),
    objet: str(obj['objet']),
    estimationMad: num(obj['estimation_mad']),
    soumissionnaires: reconciled,
    lisible: obj['lisible'] !== false,
  };
}
