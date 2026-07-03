/**
 * Catalogue matériaux — the canonical, curated list of Moroccan construction
 * materials that powers the visual grid on /stock. This is the single source of
 * truth for BOTH the browsable catalogue (names, units, categories, images) and
 * image resolution; the stock DB only holds the subset of materials a worker has
 * actually activated (given stock + a price), joined back to this list by `code`.
 *
 * Images are bundled SVG illustrations under apps/web/public/materials — never
 * external URLs — so they load instantly, work offline on-site, and never rot.
 * Each material points at an illustration slug (`img`); a per-category emblem is
 * the guaranteed fallback when a dedicated illustration is not yet drawn.
 *
 * Prices are deliberately absent: cost varies by supplier/date across Morocco,
 * so the worker enters the montant when adding stock (see /stock quick-add).
 */

export type MaterialCategoryKey =
  | 'ciment-liants'
  | 'acier-ferraillage'
  | 'granulats'
  | 'beton-prefa'
  | 'briques-maconnerie'
  | 'etancheite-isolation'
  | 'plomberie-sanitaire'
  | 'electricite'
  | 'bois-coffrage'
  | 'alu-vitrage'
  | 'peinture-enduits'
  | 'carrelage-revetements'
  | 'quincaillerie'
  | 'vrd-assainissement'
  | 'outillage-epi';

/** One catalogue entry — a browsable material, not yet necessarily in the DB. */
export interface CatalogueMaterial {
  /** Stable natural key; the stock upsert is idempotent on it. */
  code: string;
  /** French designation as used on Moroccan sites. */
  designation: string;
  /** Unit of measure (sac, m3, tonne, u, ml, m2, kg…). */
  unit: string;
  category: MaterialCategoryKey;
  /** Illustration slug → /materials/<img>.svg (category emblem as fallback). */
  img: string;
}

/** A category header: label + accent classes reused from the design tokens. */
export interface MaterialCategory {
  key: MaterialCategoryKey;
  label: string;
  /** Tailwind text-* accent token. */
  accentText: string;
  /** Tailwind soft-bg accent token. */
  accentBg: string;
}

export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = [
  { key: 'ciment-liants', label: 'Ciment & liants', accentText: 'text-ochre', accentBg: 'bg-ochre-soft' },
  { key: 'acier-ferraillage', label: 'Acier & ferraillage', accentText: 'text-clay', accentBg: 'bg-clay-soft' },
  { key: 'granulats', label: 'Granulats & sables', accentText: 'text-teal', accentBg: 'bg-teal-soft' },
  { key: 'beton-prefa', label: 'Béton & préfabriqué', accentText: 'text-cyan', accentBg: 'bg-cyan-soft' },
  { key: 'briques-maconnerie', label: 'Briques & maçonnerie', accentText: 'text-clay', accentBg: 'bg-clay-soft' },
  { key: 'etancheite-isolation', label: 'Étanchéité & isolation', accentText: 'text-emerald', accentBg: 'bg-emerald-soft' },
  { key: 'plomberie-sanitaire', label: 'Plomberie & sanitaire', accentText: 'text-cyan', accentBg: 'bg-cyan-soft' },
  { key: 'electricite', label: 'Électricité', accentText: 'text-ochre', accentBg: 'bg-ochre-soft' },
  { key: 'bois-coffrage', label: 'Bois & coffrage', accentText: 'text-ochre', accentBg: 'bg-ochre-soft' },
  { key: 'alu-vitrage', label: 'Aluminium & vitrage', accentText: 'text-teal', accentBg: 'bg-teal-soft' },
  { key: 'peinture-enduits', label: 'Peinture & enduits', accentText: 'text-emerald', accentBg: 'bg-emerald-soft' },
  { key: 'carrelage-revetements', label: 'Carrelage & revêtements', accentText: 'text-cyan', accentBg: 'bg-cyan-soft' },
  { key: 'quincaillerie', label: 'Quincaillerie & fixations', accentText: 'text-clay', accentBg: 'bg-clay-soft' },
  { key: 'vrd-assainissement', label: 'VRD & assainissement', accentText: 'text-teal', accentBg: 'bg-teal-soft' },
  { key: 'outillage-epi', label: 'Outillage & EPI', accentText: 'text-emerald', accentBg: 'bg-emerald-soft' },
];

const CATEGORY_LABEL = new Map<MaterialCategoryKey, string>(
  MATERIAL_CATEGORIES.map((category) => [category.key, category.label]),
);

/** French label for a category key (falls back to the key itself). */
export function categoryLabel(key: MaterialCategoryKey): string {
  return CATEGORY_LABEL.get(key) ?? key;
}

// ── The catalogue ────────────────────────────────────────────────────────────
// ~150 references across the 15 families above. Codes are stable; designations
// match Moroccan site usage. `img` reuses one illustration across a visual family
// (all fers à béton share `fer-beton`, all PVC evac share `tube-pvc`, …).

export const MATERIALS_CATALOG: readonly CatalogueMaterial[] = [
  // ── Ciment & liants ──────────────────────────────────────────────────────
  { code: 'CIM-CPJ45', designation: 'Ciment CPJ 45', unit: 'sac', category: 'ciment-liants', img: 'sac-ciment' },
  { code: 'CIM-CPJ35', designation: 'Ciment CPJ 35', unit: 'sac', category: 'ciment-liants', img: 'sac-ciment' },
  { code: 'CIM-CPA55', designation: 'Ciment CPA 55', unit: 'sac', category: 'ciment-liants', img: 'sac-ciment' },
  { code: 'CIM-BLANC', designation: 'Ciment blanc', unit: 'sac', category: 'ciment-liants', img: 'sac-ciment' },
  { code: 'CIM-REFRAC', designation: 'Ciment réfractaire', unit: 'sac', category: 'ciment-liants', img: 'sac-ciment' },
  { code: 'LIA-CHAUX-H', designation: 'Chaux hydraulique (NHL)', unit: 'sac', category: 'ciment-liants', img: 'sac-chaux' },
  { code: 'LIA-CHAUX-V', designation: 'Chaux vive', unit: 'sac', category: 'ciment-liants', img: 'sac-chaux' },
  { code: 'LIA-PLATRE', designation: 'Plâtre de construction', unit: 'sac', category: 'ciment-liants', img: 'sac-platre' },
  { code: 'LIA-PLATRE-F', designation: 'Plâtre de finition', unit: 'sac', category: 'ciment-liants', img: 'sac-platre' },
  { code: 'LIA-MORTIER', designation: "Mortier prêt à l'emploi", unit: 'sac', category: 'ciment-liants', img: 'sac-mortier' },
  { code: 'LIA-COLLE-CAR', designation: 'Colle à carrelage', unit: 'sac', category: 'ciment-liants', img: 'seau-colle-carrelage' },
  { code: 'LIA-ENDUIT', designation: 'Enduit de façade (monocouche)', unit: 'sac', category: 'ciment-liants', img: 'sac-enduit' },
  { code: 'LIA-LISSAGE', designation: 'Enduit de lissage', unit: 'sac', category: 'ciment-liants', img: 'sac-enduit' },

  // ── Acier & ferraillage ──────────────────────────────────────────────────
  { code: 'ACI-HA6', designation: 'Fer à béton HA Ø6', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-HA8', designation: 'Fer à béton HA Ø8', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-HA10', designation: 'Fer à béton HA Ø10', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-HA12', designation: 'Fer à béton HA Ø12', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-HA14', designation: 'Fer à béton HA Ø14', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-HA16', designation: 'Fer à béton HA Ø16', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-HA20', designation: 'Fer à béton HA Ø20', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-RL6', designation: 'Rond lisse Ø6', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-RL8', designation: 'Rond lisse Ø8', unit: 'barre', category: 'acier-ferraillage', img: 'fer-beton' },
  { code: 'ACI-TS', designation: 'Treillis soudé', unit: 'panneau', category: 'acier-ferraillage', img: 'treillis-soude' },
  { code: 'ACI-FIL', designation: "Fil d'attache (recuit)", unit: 'kg', category: 'acier-ferraillage', img: 'fil-attache' },
  { code: 'ACI-IPN', designation: 'Poutrelle IPN', unit: 'ml', category: 'acier-ferraillage', img: 'profile-ipn' },
  { code: 'ACI-IPE', designation: 'Poutrelle IPE', unit: 'ml', category: 'acier-ferraillage', img: 'profile-ipn' },
  { code: 'ACI-CORN', designation: 'Cornière', unit: 'ml', category: 'acier-ferraillage', img: 'profile-ipn' },
  { code: 'ACI-TUBE', designation: 'Tube carré acier', unit: 'ml', category: 'acier-ferraillage', img: 'profile-ipn' },
  { code: 'ACI-TOLE', designation: 'Tôle galvanisée', unit: 'm2', category: 'acier-ferraillage', img: 'tole' },

  // ── Granulats & sables ───────────────────────────────────────────────────
  { code: 'GRA-SAB-RIV', designation: 'Sable de rivière', unit: 'm3', category: 'granulats', img: 'tas-sable' },
  { code: 'GRA-SAB-CON', designation: 'Sable de concassage 0/3', unit: 'm3', category: 'granulats', img: 'tas-sable' },
  { code: 'GRA-SAB-JAU', designation: 'Sable jaune', unit: 'm3', category: 'granulats', img: 'tas-sable' },
  { code: 'GRA-G38', designation: 'Gravette 3/8', unit: 'm3', category: 'granulats', img: 'tas-gravette' },
  { code: 'GRA-G815', designation: 'Gravette 8/15', unit: 'm3', category: 'granulats', img: 'tas-gravette' },
  { code: 'GRA-G1525', designation: 'Gravette 15/25', unit: 'm3', category: 'granulats', img: 'tas-gravette' },
  { code: 'GRA-TV', designation: 'Tout-venant (GNT 0/31.5)', unit: 'm3', category: 'granulats', img: 'tas-tout-venant' },
  { code: 'GRA-BALLAST', designation: 'Ballast', unit: 'm3', category: 'granulats', img: 'tas-gravette' },
  { code: 'GRA-CONC', designation: 'Gravier concassé', unit: 'm3', category: 'granulats', img: 'tas-gravette' },
  { code: 'GRA-TUF', designation: 'Tuf', unit: 'm3', category: 'granulats', img: 'tas-tout-venant' },

  // ── Béton & préfabriqué ──────────────────────────────────────────────────
  { code: 'BET-B25', designation: "Béton prêt à l'emploi B25", unit: 'm3', category: 'beton-prefa', img: 'camion-toupie' },
  { code: 'BET-B30', designation: "Béton prêt à l'emploi B30", unit: 'm3', category: 'beton-prefa', img: 'camion-toupie' },
  { code: 'BET-AGG20', designation: 'Aggloméré (parpaing) 20', unit: 'u', category: 'beton-prefa', img: 'parpaing' },
  { code: 'BET-AGG15', designation: 'Aggloméré (parpaing) 15', unit: 'u', category: 'beton-prefa', img: 'parpaing' },
  { code: 'BET-AGG10', designation: 'Aggloméré (parpaing) 10', unit: 'u', category: 'beton-prefa', img: 'parpaing' },
  { code: 'BET-HOUR12', designation: 'Hourdis (corps creux) 12', unit: 'u', category: 'beton-prefa', img: 'hourdis' },
  { code: 'BET-HOUR16', designation: 'Hourdis (corps creux) 16', unit: 'u', category: 'beton-prefa', img: 'hourdis' },
  { code: 'BET-POUT', designation: 'Poutrelle précontrainte', unit: 'ml', category: 'beton-prefa', img: 'hourdis' },
  { code: 'BET-PAVE', designation: 'Pavé autobloquant', unit: 'm2', category: 'beton-prefa', img: 'pave-autobloquant' },
  { code: 'BET-BORD', designation: 'Bordure de trottoir T2', unit: 'ml', category: 'beton-prefa', img: 'bordure-trottoir' },
  { code: 'BET-CANIV', designation: 'Caniveau béton', unit: 'ml', category: 'beton-prefa', img: 'bordure-trottoir' },
  { code: 'BET-BUSE', designation: 'Buse en béton Ø300', unit: 'ml', category: 'beton-prefa', img: 'buse-beton' },
  { code: 'BET-DALLE', designation: 'Dalle de compression', unit: 'm2', category: 'beton-prefa', img: 'hourdis' },
  { code: 'BET-CLAUS', designation: 'Claustra béton', unit: 'u', category: 'beton-prefa', img: 'parpaing' },

  // ── Briques & maçonnerie ─────────────────────────────────────────────────
  { code: 'BRI-6T', designation: 'Brique creuse 6 trous', unit: 'u', category: 'briques-maconnerie', img: 'brique-creuse' },
  { code: 'BRI-8T', designation: 'Brique creuse 8 trous', unit: 'u', category: 'briques-maconnerie', img: 'brique-creuse' },
  { code: 'BRI-12T', designation: 'Brique creuse 12 trous', unit: 'u', category: 'briques-maconnerie', img: 'brique-creuse' },
  { code: 'BRI-PLEINE', designation: 'Brique pleine', unit: 'u', category: 'briques-maconnerie', img: 'brique-pleine' },
  { code: 'BRI-REFRAC', designation: 'Brique réfractaire', unit: 'u', category: 'briques-maconnerie', img: 'brique-pleine' },
  { code: 'BRI-PAREM', designation: 'Brique de parement', unit: 'u', category: 'briques-maconnerie', img: 'brique-pleine' },

  // ── Étanchéité & isolation ───────────────────────────────────────────────
  { code: 'ETA-MEMB', designation: 'Membrane bitumineuse (rouleau)', unit: 'rouleau', category: 'etancheite-isolation', img: 'rouleau-membrane' },
  { code: 'ETA-FEUTRE', designation: 'Feutre bitumé', unit: 'rouleau', category: 'etancheite-isolation', img: 'rouleau-membrane' },
  { code: 'ETA-BITUME', designation: 'Bitume (fût)', unit: 'fût', category: 'etancheite-isolation', img: 'bidon-bitume' },
  { code: 'ETA-SIKA', designation: "Enduit d'étanchéité (type Sika)", unit: 'kg', category: 'etancheite-isolation', img: 'cartouche-mastic' },
  { code: 'ETA-MASTIC', designation: "Mastic d'étanchéité", unit: 'cartouche', category: 'etancheite-isolation', img: 'cartouche-mastic' },
  { code: 'ISO-PSE', designation: 'Polystyrène expansé (PSE)', unit: 'panneau', category: 'etancheite-isolation', img: 'panneau-polystyrene' },
  { code: 'ISO-XPS', designation: 'Polystyrène extrudé (XPS)', unit: 'panneau', category: 'etancheite-isolation', img: 'panneau-polystyrene' },
  { code: 'ISO-LDV', designation: 'Laine de verre', unit: 'rouleau', category: 'etancheite-isolation', img: 'laine-verre' },
  { code: 'ISO-LDR', designation: 'Laine de roche', unit: 'panneau', category: 'etancheite-isolation', img: 'laine-verre' },
  { code: 'ISO-POLYANE', designation: 'Film polyane', unit: 'rouleau', category: 'etancheite-isolation', img: 'film-polyane' },
  { code: 'ISO-GEO', designation: 'Géotextile', unit: 'm2', category: 'etancheite-isolation', img: 'film-polyane' },

  // ── Plomberie & sanitaire ────────────────────────────────────────────────
  { code: 'PLB-PVC100', designation: 'Tube PVC évacuation Ø100', unit: 'ml', category: 'plomberie-sanitaire', img: 'tube-pvc' },
  { code: 'PLB-PVC40', designation: 'Tube PVC évacuation Ø40', unit: 'ml', category: 'plomberie-sanitaire', img: 'tube-pvc' },
  { code: 'PLB-PPR20', designation: 'Tube PPR Ø20', unit: 'ml', category: 'plomberie-sanitaire', img: 'tube-ppr' },
  { code: 'PLB-PPR25', designation: 'Tube PPR Ø25', unit: 'ml', category: 'plomberie-sanitaire', img: 'tube-ppr' },
  { code: 'PLB-PER16', designation: 'Tube PER Ø16', unit: 'ml', category: 'plomberie-sanitaire', img: 'tube-ppr' },
  { code: 'PLB-CUIV', designation: 'Tube cuivre Ø14', unit: 'ml', category: 'plomberie-sanitaire', img: 'tube-cuivre' },
  { code: 'PLB-RAC', designation: 'Raccord PVC (coude / té)', unit: 'u', category: 'plomberie-sanitaire', img: 'raccord-pvc' },
  { code: 'PLB-WC', designation: 'Cuvette WC', unit: 'u', category: 'plomberie-sanitaire', img: 'cuvette-wc' },
  { code: 'PLB-LAVABO', designation: 'Lavabo', unit: 'u', category: 'plomberie-sanitaire', img: 'lavabo' },
  { code: 'PLB-ROB', designation: 'Robinet / mitigeur', unit: 'u', category: 'plomberie-sanitaire', img: 'robinet' },
  { code: 'PLB-CHAUFFE', designation: 'Chauffe-eau', unit: 'u', category: 'plomberie-sanitaire', img: 'chauffe-eau' },
  { code: 'PLB-VANNE', designation: "Vanne / robinet d'arrêt", unit: 'u', category: 'plomberie-sanitaire', img: 'robinet' },
  { code: 'PLB-SIPHON', designation: 'Siphon', unit: 'u', category: 'plomberie-sanitaire', img: 'raccord-pvc' },
  { code: 'PLB-RESERV', designation: "Réservoir d'eau (bâche)", unit: 'u', category: 'plomberie-sanitaire', img: 'chauffe-eau' },

  // ── Électricité ──────────────────────────────────────────────────────────
  { code: 'ELE-CAB15', designation: 'Câble U1000 R2V 3G1.5', unit: 'ml', category: 'electricite', img: 'rouleau-cable' },
  { code: 'ELE-CAB25', designation: 'Câble U1000 R2V 3G2.5', unit: 'ml', category: 'electricite', img: 'rouleau-cable' },
  { code: 'ELE-FIL15', designation: 'Fil H07 V-U 1.5', unit: 'ml', category: 'electricite', img: 'rouleau-cable' },
  { code: 'ELE-FIL25', designation: 'Fil H07 V-U 2.5', unit: 'ml', category: 'electricite', img: 'rouleau-cable' },
  { code: 'ELE-ICTA', designation: 'Gaine ICTA Ø20', unit: 'ml', category: 'electricite', img: 'gaine-icta' },
  { code: 'ELE-IRL', designation: 'Tube IRL', unit: 'ml', category: 'electricite', img: 'gaine-icta' },
  { code: 'ELE-DISJ', designation: 'Disjoncteur', unit: 'u', category: 'electricite', img: 'disjoncteur' },
  { code: 'ELE-DIFF', designation: 'Disjoncteur différentiel', unit: 'u', category: 'electricite', img: 'disjoncteur' },
  { code: 'ELE-TABLEAU', designation: 'Tableau électrique', unit: 'u', category: 'electricite', img: 'tableau-electrique' },
  { code: 'ELE-INTER', designation: 'Interrupteur', unit: 'u', category: 'electricite', img: 'interrupteur' },
  { code: 'ELE-PRISE', designation: 'Prise de courant', unit: 'u', category: 'electricite', img: 'prise' },
  { code: 'ELE-LED', designation: 'Ampoule LED', unit: 'u', category: 'electricite', img: 'ampoule-led' },
  { code: 'ELE-BOITE', designation: "Boîte d'encastrement", unit: 'u', category: 'electricite', img: 'boite-encastrement' },

  // ── Bois & coffrage ──────────────────────────────────────────────────────
  { code: 'BOI-COFF', designation: 'Bois de coffrage', unit: 'm2', category: 'bois-coffrage', img: 'planche-bois' },
  { code: 'BOI-PLANCHE', designation: 'Planche (bastaing)', unit: 'ml', category: 'bois-coffrage', img: 'planche-bois' },
  { code: 'BOI-MADRIER', designation: 'Madrier', unit: 'ml', category: 'bois-coffrage', img: 'madrier' },
  { code: 'BOI-CHEVRON', designation: 'Chevron', unit: 'ml', category: 'bois-coffrage', img: 'madrier' },
  { code: 'BOI-CP', designation: 'Contreplaqué (CTBX)', unit: 'panneau', category: 'bois-coffrage', img: 'contreplaque' },
  { code: 'BOI-MDF', designation: 'Panneau MDF', unit: 'panneau', category: 'bois-coffrage', img: 'contreplaque' },
  { code: 'BOI-AGGLO', designation: 'Panneau aggloméré', unit: 'panneau', category: 'bois-coffrage', img: 'contreplaque' },
  { code: 'BOI-PORTE', designation: 'Porte en bois', unit: 'u', category: 'bois-coffrage', img: 'porte-bois' },
  { code: 'BOI-PLINTHE', designation: 'Plinthe bois', unit: 'ml', category: 'bois-coffrage', img: 'planche-bois' },

  // ── Aluminium & vitrage ──────────────────────────────────────────────────
  { code: 'ALU-PROF', designation: 'Profilé aluminium', unit: 'ml', category: 'alu-vitrage', img: 'profile-alu' },
  { code: 'ALU-FEN', designation: 'Fenêtre aluminium', unit: 'u', category: 'alu-vitrage', img: 'fenetre-alu' },
  { code: 'ALU-PORTE', designation: 'Porte aluminium', unit: 'u', category: 'alu-vitrage', img: 'fenetre-alu' },
  { code: 'ALU-VERRE', designation: 'Verre (vitrage)', unit: 'm2', category: 'alu-vitrage', img: 'vitre-verre' },
  { code: 'ALU-DV', designation: 'Double vitrage', unit: 'm2', category: 'alu-vitrage', img: 'vitre-verre' },
  { code: 'ALU-MIROIR', designation: 'Miroir', unit: 'm2', category: 'alu-vitrage', img: 'vitre-verre' },
  { code: 'ALU-PLEXI', designation: 'Plexiglas', unit: 'm2', category: 'alu-vitrage', img: 'vitre-verre' },

  // ── Peinture & enduits ───────────────────────────────────────────────────
  { code: 'PEI-VINYL', designation: 'Peinture vinylique (intérieur)', unit: 'pot', category: 'peinture-enduits', img: 'pot-peinture' },
  { code: 'PEI-FACADE', designation: 'Peinture façade', unit: 'pot', category: 'peinture-enduits', img: 'pot-peinture' },
  { code: 'PEI-GLYCERO', designation: 'Peinture glycéro', unit: 'pot', category: 'peinture-enduits', img: 'pot-peinture' },
  { code: 'PEI-PRIMAIRE', designation: 'Sous-couche (primaire)', unit: 'pot', category: 'peinture-enduits', img: 'pot-peinture' },
  { code: 'PEI-VERNIS', designation: 'Vernis', unit: 'pot', category: 'peinture-enduits', img: 'bidon-diluant' },
  { code: 'PEI-DILUANT', designation: 'Diluant / white-spirit', unit: 'bidon', category: 'peinture-enduits', img: 'bidon-diluant' },
  { code: 'PEI-REBOUCH', designation: 'Enduit de rebouchage', unit: 'kg', category: 'peinture-enduits', img: 'seau-enduit' },
  { code: 'PEI-ROULEAU', designation: 'Rouleau + pinceau', unit: 'u', category: 'peinture-enduits', img: 'rouleau-pinceau' },

  // ── Carrelage & revêtements ──────────────────────────────────────────────
  { code: 'CAR-SOL', designation: 'Carrelage sol (grès)', unit: 'm2', category: 'carrelage-revetements', img: 'carrelage' },
  { code: 'CAR-MURAL', designation: 'Carrelage mural', unit: 'm2', category: 'carrelage-revetements', img: 'carrelage' },
  { code: 'CAR-FAIENCE', designation: 'Faïence', unit: 'm2', category: 'carrelage-revetements', img: 'faience' },
  { code: 'CAR-MARBRE', designation: 'Marbre', unit: 'm2', category: 'carrelage-revetements', img: 'marbre' },
  { code: 'CAR-GRANITO', designation: 'Granito / Terrazzo', unit: 'm2', category: 'carrelage-revetements', img: 'marbre' },
  { code: 'CAR-PARQUET', designation: 'Parquet', unit: 'm2', category: 'carrelage-revetements', img: 'parquet' },
  { code: 'CAR-PLINTHE', designation: 'Plinthe carrelage', unit: 'ml', category: 'carrelage-revetements', img: 'carrelage' },
  { code: 'CAR-ZELLIGE', designation: 'Zellige', unit: 'm2', category: 'carrelage-revetements', img: 'faience' },

  // ── Quincaillerie & fixations ────────────────────────────────────────────
  { code: 'QUI-VIS-B', designation: 'Vis à bois', unit: 'boîte', category: 'quincaillerie', img: 'vis' },
  { code: 'QUI-VIS-A', designation: 'Vis autoforeuse', unit: 'boîte', category: 'quincaillerie', img: 'vis' },
  { code: 'QUI-CLOU', designation: 'Clou', unit: 'kg', category: 'quincaillerie', img: 'clou' },
  { code: 'QUI-BOULON', designation: 'Boulon + écrou', unit: 'u', category: 'quincaillerie', img: 'boulon-ecrou' },
  { code: 'QUI-CHEVILLE', designation: 'Cheville', unit: 'boîte', category: 'quincaillerie', img: 'boulon-ecrou' },
  { code: 'QUI-TIGE', designation: 'Tige filetée', unit: 'u', category: 'quincaillerie', img: 'boulon-ecrou' },
  { code: 'QUI-SERRURE', designation: 'Serrure', unit: 'u', category: 'quincaillerie', img: 'serrure' },
  { code: 'QUI-CHARN', designation: 'Charnière / paumelle', unit: 'u', category: 'quincaillerie', img: 'serrure' },
  { code: 'QUI-POIGNEE', designation: 'Poignée de porte', unit: 'u', category: 'quincaillerie', img: 'serrure' },
  { code: 'QUI-CADENAS', designation: 'Cadenas', unit: 'u', category: 'quincaillerie', img: 'serrure' },
  { code: 'QUI-EQUERRE', designation: 'Équerre métallique', unit: 'u', category: 'quincaillerie', img: 'boulon-ecrou' },

  // ── VRD & assainissement ─────────────────────────────────────────────────
  { code: 'VRD-TAMPON', designation: 'Tampon fonte (regard)', unit: 'u', category: 'vrd-assainissement', img: 'tampon-fonte' },
  { code: 'VRD-REGARD', designation: 'Regard préfabriqué', unit: 'u', category: 'vrd-assainissement', img: 'buse-beton' },
  { code: 'VRD-PEHD', designation: 'Tuyau PEHD', unit: 'ml', category: 'vrd-assainissement', img: 'tuyau-pehd' },
  { code: 'VRD-PVC200', designation: 'Tuyau PVC assainissement Ø200', unit: 'ml', category: 'vrd-assainissement', img: 'tuyau-pehd' },
  { code: 'VRD-GRILLE', designation: 'Grille avaloir', unit: 'u', category: 'vrd-assainissement', img: 'tampon-fonte' },
  { code: 'VRD-GEOGRILLE', designation: 'Géogrille', unit: 'm2', category: 'vrd-assainissement', img: 'film-polyane' },

  // ── Outillage & EPI ──────────────────────────────────────────────────────
  { code: 'OUT-CASQUE', designation: 'Casque de chantier', unit: 'u', category: 'outillage-epi', img: 'casque-chantier' },
  { code: 'OUT-GANTS', designation: 'Gants de travail', unit: 'paire', category: 'outillage-epi', img: 'casque-chantier' },
  { code: 'OUT-BOTTES', designation: 'Bottes de sécurité', unit: 'paire', category: 'outillage-epi', img: 'casque-chantier' },
  { code: 'OUT-BROUETTE', designation: 'Brouette', unit: 'u', category: 'outillage-epi', img: 'brouette' },
  { code: 'OUT-TRUELLE', designation: 'Truelle', unit: 'u', category: 'outillage-epi', img: 'truelle' },
  { code: 'OUT-NIVEAU', designation: 'Niveau à bulle', unit: 'u', category: 'outillage-epi', img: 'truelle' },
  { code: 'OUT-METRE', designation: 'Mètre ruban', unit: 'u', category: 'outillage-epi', img: 'truelle' },
  { code: 'OUT-PELLE', designation: 'Pelle', unit: 'u', category: 'outillage-epi', img: 'truelle' },
  { code: 'OUT-PIOCHE', designation: 'Pioche', unit: 'u', category: 'outillage-epi', img: 'truelle' },
  { code: 'OUT-DISQUE', designation: 'Disque à meuler', unit: 'u', category: 'outillage-epi', img: 'brouette' },
];

// ── Image + grouping helpers ─────────────────────────────────────────────────

/** Bundled illustration for a material → /materials/<img>.svg. */
export function materialImageSrc(material: Pick<CatalogueMaterial, 'img'>): string {
  return `/materials/${material.img}.svg`;
}

/** Guaranteed per-category emblem → /materials/cat/<key>.svg (onError fallback). */
export function categoryEmblemSrc(category: MaterialCategoryKey): string {
  return `/materials/cat/${category}.svg`;
}

/** The catalogue split into its categories, in MATERIAL_CATEGORIES order. */
export function groupCatalogByCategory(): {
  category: MaterialCategory;
  materials: CatalogueMaterial[];
}[] {
  return MATERIAL_CATEGORIES.map((category) => ({
    category,
    materials: MATERIALS_CATALOG.filter((m) => m.category === category.key),
  }));
}

/** Total catalogue size — handy for the "Initialiser (N)" affordance. */
export const CATALOGUE_SIZE = MATERIALS_CATALOG.length;
