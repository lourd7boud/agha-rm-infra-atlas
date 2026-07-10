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
