// Moteur de chiffrage d'un bon de commande — pur (zéro I/O). L'agent chargé
// propose un prix par article, applique une marge, et on calcule HT/TVA/TTC.
// La provenance de chaque prix est tracée (source) pour l'audit et
// l'apprentissage: catalogue interne, BPU d'un marché passé, saisie manuelle.

export type PrixSource = 'manuel' | 'catalogue' | 'historique' | 'estimation';

export interface LigneReponseInput {
  /** Index 0-based dans le tableau `articles` de l'avis. */
  idx: number;
  designation: string;
  unite?: string | null;
  quantite: number;
  tvaPct: number;
  /** Prix unitaire HORS TAXE proposé. 0 = pas encore chiffré. */
  prixUnitaireHt: number;
  source: PrixSource;
  sourceRef?: string | null;
  /** true si prixUnitaireHt est un COÛT à majorer par la marge globale;
   *  false si c'est déjà un prix de vente ferme. */
  margeAppliquee?: boolean;
  note?: string | null;
}

export interface LigneReponse extends LigneReponseInput {
  unite: string | null;
  prixVenteHt: number;
  montantHt: number;
  montantTva: number;
  montantTtc: number;
}

export interface ReponseTotaux {
  lignes: LigneReponse[];
  totalHt: number;
  totalTva: number;
  totalTtc: number;
  /** Lignes encore à 0 — l'agent n'a pas fini de chiffrer. */
  lignesNonChiffrees: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Calcule les totaux d'une réponse. `margePct` s'applique aux lignes dont
 * `margeAppliquee` est vrai (coût → prix de vente = coût × (1 + marge/100)).
 */
export function computeReponse(lignes: LigneReponseInput[], margePct: number): ReponseTotaux {
  const facteur = 1 + (Number.isFinite(margePct) ? margePct : 0) / 100;
  let totalHt = 0;
  let totalTva = 0;
  let lignesNonChiffrees = 0;

  const computed = lignes.map((ligne): LigneReponse => {
    const base = ligne.prixUnitaireHt > 0 ? ligne.prixUnitaireHt : 0;
    if (base <= 0) lignesNonChiffrees += 1;
    const prixVenteHt = r2(ligne.margeAppliquee ? base * facteur : base);
    const montantHt = r2(prixVenteHt * ligne.quantite);
    const montantTva = r2(montantHt * (ligne.tvaPct / 100));
    totalHt = r2(totalHt + montantHt);
    totalTva = r2(totalTva + montantTva);
    return {
      ...ligne,
      unite: ligne.unite ?? null,
      prixVenteHt,
      montantHt,
      montantTva,
      montantTtc: r2(montantHt + montantTva),
    };
  });

  return {
    lignes: computed,
    totalHt,
    totalTva,
    totalTtc: r2(totalHt + totalTva),
    lignesNonChiffrees,
  };
}

// ── Proposition automatique (Niveau 2) ──────────────────────────────────────
// L'agent rapproche chaque article non chiffré des prix connus: catalogue
// fournisseurs (= COÛT → marge appliquée) et historique société (BPU de
// marchés, devis, réponses BDC passées = PRIX DE VENTE fermes).

export interface PriceCandidate {
  designation: string;
  unite?: string | null;
  prixHt: number;
  source: Extract<PrixSource, 'catalogue' | 'historique'>;
  sourceRef: string;
}

export interface PriceProposal {
  idx: number;
  prixUnitaireHt: number;
  source: Extract<PrixSource, 'catalogue' | 'historique'>;
  sourceRef: string;
  margeAppliquee: boolean;
  /** Score de confiance 0..1 (arrondi 2 décimales). */
  score: number;
}

/** Mots vides FR courants des désignations BTP — bruit pour le matching. */
const STOPWORDS = new Set([
  'les', 'des', 'une', 'aux', 'ou', 'et', 'de', 'du', 'la', 'le', 'un', 'au', 'en',
  'pour', 'avec', 'sur', 'par', 'dans', 'type', 'genre', 'dont', 'ses', 'son', 'sa',
  'fourniture', 'fournitures', 'pose', 'achat', 'divers', 'diverses', 'tous', 'toutes',
  'similaire', 'equivalent', 'qualite', 'premiere',
]);

/**
 * Minuscules sans accents, frontières lettre↔chiffre séparées (CPJ45 ≡ CPJ 45,
 * 50kg ≡ 50 kg), pluriels simples repliés (sacs → sac). Tokens ≥3 lettres ou
 * porteurs de chiffres.
 */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ');
  for (const raw of normalized.split(' ')) {
    let token = raw.trim();
    if (!token) continue;
    if (token.length < 3 && !/\d/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    // Pluriel FR trivial — replie « sacs/tubes/drapeaux » vers le singulier.
    if (token.length >= 4 && !/\d/.test(token)) {
      if (token.endsWith('aux')) token = `${token.slice(0, -3)}al`;
      else if (token.endsWith('s')) token = token.slice(0, -1);
    }
    seen.add(token);
  }
  return [...seen];
}

/**
 * Similarité de deux désignations: 70 % couverture de l'article (combien de
 * ses tokens le candidat couvre) + 30 % Jaccard (pénalise le hors-sujet).
 */
export function scoreDesignations(articleTokens: string[], candidateTokens: string[]): number {
  if (articleTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  let inter = 0;
  for (const token of articleTokens) if (candidateSet.has(token)) inter += 1;
  if (inter === 0) return 0;
  const union = new Set([...articleTokens, ...candidateTokens]).size;
  return 0.7 * (inter / articleTokens.length) + 0.3 * (inter / union);
}

const normUnite = (u: string | null | undefined): string =>
  (u ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const r2s = (n: number): number => Math.round(n * 100) / 100;

/** Seuil d'acceptation par défaut — en dessous, mieux vaut laisser à 0. */
export const PROPOSAL_MIN_SCORE = 0.42;

/**
 * Propose un prix pour chaque ligne NON chiffrée (prixUnitaireHt ≤ 0).
 * `articles` (même index) enrichit le texte matché avec les spécifications.
 */
export function proposerPrixPourLignes(
  lignes: readonly LigneReponseInput[],
  articles: ReadonlyArray<{
    designation: string;
    caracteristiques?: string | null;
    unite?: string | null;
  }>,
  candidates: readonly PriceCandidate[],
  minScore = PROPOSAL_MIN_SCORE,
): PriceProposal[] {
  const pool = candidates
    .filter((c) => c.prixHt > 0 && c.designation.trim().length >= 3)
    .map((c) => ({ c, tokens: tokenize(c.designation), unite: normUnite(c.unite) }));
  if (pool.length === 0) return [];

  const proposals: PriceProposal[] = [];
  for (const ligne of lignes) {
    if (ligne.prixUnitaireHt > 0) continue;
    const article = articles[ligne.idx];
    const specsHead = (article?.caracteristiques ?? '').split('\n').slice(0, 2).join(' ');
    const tokens = tokenize(`${ligne.designation} ${specsHead}`);
    if (tokens.length === 0) continue;
    const ligneUnite = normUnite(ligne.unite ?? article?.unite);

    let best: { score: number; entry: (typeof pool)[number] } | null = null;
    for (const entry of pool) {
      let score = scoreDesignations(tokens, entry.tokens);
      if (score <= 0) continue;
      if (ligneUnite && entry.unite && ligneUnite === entry.unite) score += 0.08;
      if (!best || score > best.score) best = { score, entry };
    }
    if (best && best.score >= minScore) {
      proposals.push({
        idx: ligne.idx,
        prixUnitaireHt: best.entry.c.prixHt,
        source: best.entry.c.source,
        sourceRef: best.entry.c.sourceRef,
        margeAppliquee: best.entry.c.source === 'catalogue',
        score: r2s(Math.min(1, best.score)),
      });
    }
  }
  return proposals;
}

/** Applique les propositions aux lignes (immutables) — jamais sur un prix saisi. */
export function appliquerPropositions(
  lignes: readonly LigneReponseInput[],
  proposals: readonly PriceProposal[],
): LigneReponseInput[] {
  const byIdx = new Map(proposals.map((p) => [p.idx, p]));
  return lignes.map((ligne) => {
    const proposal = byIdx.get(ligne.idx);
    if (!proposal || ligne.prixUnitaireHt > 0) return { ...ligne };
    return {
      ...ligne,
      prixUnitaireHt: proposal.prixUnitaireHt,
      source: proposal.source,
      sourceRef: proposal.sourceRef,
      margeAppliquee: proposal.margeAppliquee,
    };
  });
}

/**
 * Amorce une réponse à partir des articles de l'avis: une ligne par article,
 * prix à 0 (à chiffrer), TVA reprise de l'avis (20 % par défaut).
 */
export function seedLignesFromArticles(
  articles: Array<{
    designation: string;
    unite: string | null;
    quantite: number | null;
    tvaPct: number | null;
  }>,
): LigneReponseInput[] {
  return articles.map((article, idx) => ({
    idx,
    designation: article.designation,
    unite: article.unite,
    quantite: article.quantite && article.quantite > 0 ? article.quantite : 1,
    tvaPct: article.tvaPct ?? 20,
    prixUnitaireHt: 0,
    source: 'manuel',
    margeAppliquee: false,
  }));
}
