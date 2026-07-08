/**
 * Matériel & engins — inspections / checklists (contrôles machine).
 *
 * Pure, I/O-free. An inspection is a checklist run against a machine (before a
 * chantier, on return, périodique, sécurité). Each item is ok / defaut / na; the
 * overall result is derived — any défaut makes the inspection non_conforme. New
 * inspections seed their items from INSPECTION_TEMPLATES for the chosen type.
 */

/** When/why an inspection is run. */
export const INSPECTION_TYPES = [
  'avant_affectation',
  'retour_chantier',
  'periodique',
  'securite',
] as const;

export type InspectionType = (typeof INSPECTION_TYPES)[number];

/**
 * Overall verdict. 'reserves' is available for manual use; the auto-computed
 * result is only conforme / non_conforme.
 */
export const INSPECTION_RESULTS = [
  'conforme',
  'reserves',
  'non_conforme',
] as const;

export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

/** Per-item verdict: conforme, défaut constaté, or non applicable. */
export const INSPECTION_ITEM_STATUSES = ['ok', 'defaut', 'na'] as const;

export type InspectionItemStatus = (typeof INSPECTION_ITEM_STATUSES)[number];

/** Default checklist seeded per inspection type. */
export const INSPECTION_TEMPLATES: Record<InspectionType, readonly string[]> = {
  avant_affectation: [
    'Niveaux (huile moteur, liquide de refroidissement)',
    'Pneus / chenilles',
    'Freins et direction',
    'Éclairage et signalisation',
    'Circuit hydraulique (fuites)',
    'Sécurités et extincteur',
  ],
  retour_chantier: [
    'État général / carrosserie',
    'Niveaux et fuites',
    'Pneus / chenilles',
    'Relevé du compteur (heures/km)',
    'Propreté / nettoyage',
  ],
  periodique: [
    'Vidange et filtres',
    'Courroies et durites',
    'Batterie',
    'Circuit hydraulique',
    'Freins et direction',
    'Structure / soudures',
  ],
  securite: [
    'Extincteur',
    'Ceinture / structure ROPS-FOPS',
    'Avertisseur de recul',
    'Gyrophare',
    "Arrêt d'urgence",
  ],
};

/** Minimal shape the summary/result readers need from an item. */
export interface InspectionItemLike {
  status: InspectionItemStatus;
}

export interface InspectionItemSummary {
  ok: number;
  defaut: number;
  na: number;
  total: number;
}

/** Tallies items by status. */
export function inspectionItemSummary(
  items: readonly InspectionItemLike[],
): InspectionItemSummary {
  const summary: InspectionItemSummary = { ok: 0, defaut: 0, na: 0, total: 0 };
  for (const item of items) {
    summary[item.status] += 1;
    summary.total += 1;
  }
  return summary;
}

/**
 * Derives the overall result: any item with a défaut makes the whole inspection
 * non_conforme; otherwise (all ok / na, or empty) it is conforme.
 */
export function inspectionOverallResult(
  items: readonly InspectionItemLike[],
): InspectionResult {
  return items.some((item) => item.status === 'defaut')
    ? 'non_conforme'
    : 'conforme';
}
