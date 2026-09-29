// Détails du métré — helpers partagés entre l'éditeur (MetreEditor) et le
// panneau « Périodes précédentes » (PreviousPeriodes). Les mesures des
// périodes antérieures arrivent déjà, telles qu'enregistrées, dans le contexte
// du métré (previousByLigne, chargé en une passe côté serveur) : ces helpers
// ne font que préparer l'affichage en lecture seule — aucun impact sur le
// partiel courant, le cumul, le % de réalisation, la TVA ni la retenue.
import {
  computeLignePartielClient,
  round2Client,
  type MetreCalcType,
  type MetreContext,
  type MetreLigne,
} from '@/lib/btp-shared';

/** Une période antérieure d'un prix, telle que servie par l'API métré. */
export type MetrePreviousPeriode = MetreContext['previousByLigne'][string][number];

export interface MetreDetailColumn {
  field: keyof MetreLigne;
  label: string;
  /** Info-bulle (saisie et lecture seule) : sens exact du champ. */
  hint?: string;
  /** Valeur affichée quand le champ est absent (défaut effectif du moteur). */
  fallback?: number;
}

/** Colonnes dimensionnelles par type d'unité — miroir de l'éditeur de saisie. */
export const DIMENSION_COLUMNS: Record<MetreCalcType, MetreDetailColumn[]> = {
  volume: [
    { field: 'nombreSemblables', label: 'Nb semblables' },
    { field: 'longueur', label: 'Longueur' },
    { field: 'largeur', label: 'Largeur' },
    { field: 'profondeur', label: 'Profondeur' },
  ],
  surface: [
    { field: 'nombreSemblables', label: 'Nb semblables' },
    { field: 'longueur', label: 'Longueur' },
    { field: 'largeur', label: 'Largeur' },
  ],
  lineaire: [
    { field: 'nombreSemblables', label: 'Nb semblables' },
    { field: 'longueur', label: 'Longueur' },
  ],
  poids: [
    {
      field: 'nombre',
      label: 'Nombre',
      hint: 'Nombre de barres ou de pièces de ferraillage dans UN seul élément (ex. 4 barres par poteau).',
    },
    {
      field: 'nombreElements',
      label: "Nombre d’éléments",
      hint:
        'Nombre d’éléments structurels identiques répétés (ex. 8 poteaux, 6 poutres). ' +
        'Vide = 1 · quantité = Nombre × Nombre d’éléments × Longueur × poids du Ø.',
      fallback: 1,
    },
    { field: 'longueur', label: 'Longueur (ml)' },
    { field: 'diametre', label: 'Ø (mm)' },
  ],
  unite: [{ field: 'nombre', label: 'Nombre' }],
};

/**
 * Valeur affichée d'une colonne de mesure : la donnée enregistrée, ou son
 * défaut effectif (fallback) quand elle est absente — ainsi une mesure
 * enregistrée avant l'ajout du « Nombre d’éléments » affiche bien 1, la
 * répétition réellement appliquée par le moteur.
 */
export function fmtMetreColumn(col: MetreDetailColumn, ligne: MetreLigne): string {
  const value = ligne[col.field] as number | undefined;
  return fmtMetreValue(value ?? col.fallback);
}

/**
 * Partiel d'une mesure d'une période précédente. La valeur enregistrée par le
 * moteur avec le métré (ligne.partiel) est la source de vérité — elle n'est
 * jamais recalculée à partir du total de la période. Seules les lignes
 * historiques sans partiel stocké retombent sur la formule du moteur à partir
 * de leurs dimensions enregistrées (cas legacy : le multiplicateur
 * nombreElements d'une sous-section n'est alors plus disponible ici).
 */
export function previousLignePartiel(unite: string, ligne: MetreLigne): number {
  const stored = ligne.partiel;
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  return round2Client(computeLignePartielClient(unite, ligne));
}

/** Vrai si au moins une période précédente porte des mesures détaillées. */
export function hasPreviousLignes(previous: MetrePreviousPeriode[]): boolean {
  return previous.some((periode) => periode.lignes.length > 0);
}

/** Quantité de mesure (2 à 4 décimales, format FR) ; « — » si absente. */
export function fmtMetreQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** Valeur d'une colonne dimensionnelle (jusqu'à 4 décimales) ; « — » si vide. */
export function fmtMetreValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('fr-MA', { maximumFractionDigits: 4 });
}
