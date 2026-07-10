// Domaine Terrain + Acquisition — logique pure (zéro I/O).
//
// 1. Modes d'obtention d'un marché par NOTRE société (décret 2-22-431 pour le
//    public: AO ouvert/restreint/présélection, concours, négocié; bons de
//    commande plafonnés à 500 000 DH TTC/an/nature — art. 91; sous-traitance
//    notifiée au maître d'ouvrage; groupement conjoint/solidaire; privé).
// 2. Moteur des coûts réels terrain: main d'œuvre (pointage) + matériel +
//    consommations + dépenses → coût total vs décompte cumulé → marge.
import { z } from 'zod';

// ─── Notre entreprise (autofill quand NOUS sommes l'attributaire) ────────────
export const NOTRE_ENTREPRISE = {
  societe: 'AGHA RM INFRA',
  formeJuridique: 'SARL AU',
  rc: '20823',
  cnss: '6984871',
  patente: '19280379',
  identifiantFiscal: '73070479',
  ice: '003939552000065',
  siege: 'Garage N°3 SN Allal Ben Abdellah Centre Boudnib',
} as const;

export const MODES_OBTENTION = [
  'ao_direct',
  'bon_commande',
  'sous_traitance',
  'groupement',
  'marche_prive',
] as const;
export type ModeObtention = (typeof MODES_OBTENTION)[number];

export const BON_COMMANDE_PLAFOND_MAD = 500_000; // décret 2-22-431, art. 91

// ─── Payloads acquisition par mode ───────────────────────────────────────────
const aoDirectSchema = z.object({
  modePassation: z
    .enum([
      'ao_ouvert',
      'ao_restreint',
      'ao_preselection',
      'concours',
      'negocie_publicite',
      'negocie_sans_publicite',
    ])
    .default('ao_ouvert'),
  caractere: z
    .enum(['ordinaire', 'cadre', 'reconductible', 'tranches_conditionnelles'])
    .default('ordinaire'),
  lot: z.string().max(100).optional(),
  cautionProvisoireMad: z.number().nonnegative().optional(),
  cautionDefinitivePct: z.number().min(0).max(100).default(3),
  retenueGarantiePct: z.number().min(0).max(100).default(7),
});

const bonCommandeSchema = z.object({
  numeroBc: z.string().min(1).max(100),
  dateBc: z.string().max(20).optional(),
  ordonnateur: z.string().max(300).optional(),
  montantBcMad: z
    .number()
    .positive()
    .max(BON_COMMANDE_PLAFOND_MAD, {
      message: `Un bon de commande est plafonné à ${BON_COMMANDE_PLAFOND_MAD.toLocaleString('fr-MA')} DH TTC (décret 2-22-431, art. 91)`,
    })
    .optional(),
});

const sousTraitanceSchema = z.object({
  titulaire: z.object({
    societe: z.string().min(1).max(300),
    rc: z.string().max(100).optional(),
    ice: z.string().max(50).optional(),
    contact: z.string().max(200).optional(),
    telephone: z.string().max(50).optional(),
  }),
  marchePrincipalRef: z.string().min(1).max(200),
  maitreOuvrageFinal: z.string().max(300).optional(),
  montantPartMad: z.number().nonnegative().optional(),
  pourcentagePart: z.number().min(0).max(100).optional(),
  contratRef: z.string().max(200).optional(),
  contratDate: z.string().max(20).optional(),
  // CCAG-T: la sous-traitance est notifiée au maître d'ouvrage (agrément).
  agrementMo: z.boolean().default(false),
  agrementDate: z.string().max(20).optional(),
  delaiPaiementJours: z.number().int().min(0).max(365).optional(),
});

const groupementSchema = z.object({
  typeGroupement: z.enum(['conjoint', 'solidaire']),
  notreRole: z.enum(['mandataire', 'membre']),
  mandataireSociete: z.string().max(300).optional(),
  membres: z
    .array(
      z.object({
        societe: z.string().min(1).max(300),
        ice: z.string().max(50).optional(),
        partPct: z.number().min(0).max(100).optional(),
        montantPartMad: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(20),
  conventionDate: z.string().max(20).optional(),
  notrePartPct: z.number().min(0).max(100).optional(),
  notrePartMad: z.number().nonnegative().optional(),
});

const marchePriveSchema = z.object({
  client: z.object({
    nom: z.string().min(1).max(300),
    ice: z.string().max(50).optional(),
    telephone: z.string().max(50).optional(),
    adresse: z.string().max(500).optional(),
  }),
  devisRef: z.string().max(200).optional(),
  devisDate: z.string().max(20).optional(),
  contratRef: z.string().max(200).optional(),
  acomptePct: z.number().min(0).max(100).optional(),
  retenueGarantiePct: z.number().min(0).max(100).optional(),
  modalitesPaiement: z.string().max(1000).optional(),
});

const ACQUISITION_SCHEMAS: Record<ModeObtention, z.ZodTypeAny> = {
  ao_direct: aoDirectSchema,
  bon_commande: bonCommandeSchema,
  sous_traitance: sousTraitanceSchema,
  groupement: groupementSchema,
  marche_prive: marchePriveSchema,
};

/** Valide le payload acquisition pour un mode donné (défauts appliqués). */
export function parseAcquisition(
  mode: ModeObtention,
  payload: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: z.ZodError } {
  const parsed = ACQUISITION_SCHEMAS[mode].safeParse(payload ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error };
  return { ok: true, value: parsed.data as Record<string, unknown> };
}

export const MODE_OBTENTION_LABELS: Record<ModeObtention, string> = {
  ao_direct: 'Marché public — adjudicataire',
  bon_commande: 'Bon de commande',
  sous_traitance: 'Sous-traitance',
  groupement: 'Groupement',
  marche_prive: 'Marché privé',
};

// ─── Saisie terrain: enums & catégories ──────────────────────────────────────
export const METEO_VALUES = ['soleil', 'nuageux', 'pluie', 'vent', 'canicule', 'froid'] as const;

export const DEPENSE_CATEGORIES = [
  'carburant',
  'materiaux',
  'location_materiel',
  'main_oeuvre',
  'transport',
  'petit_outillage',
  'reparation',
  'repas',
  'administratif',
  'taxes',
  'autre',
] as const;
export type DepenseCategorie = (typeof DEPENSE_CATEGORIES)[number];

export const DEPENSE_METHODES = ['especes', 'carte', 'virement', 'cheque', 'credit'] as const;

// ─── Moteur coûts réels ──────────────────────────────────────────────────────
export interface CoutsTerrainInput {
  mainOeuvreMad: number;
  materielMad: number;
  consommationsMad: number;
  depensesMad: number;
  /** Dernier décompte TTC cumulé (0 si aucun). */
  decompteCumuleTtcMad: number;
  montantMarcheMad: number;
}

export interface CoutsTerrain {
  mainOeuvreMad: number;
  materielMad: number;
  consommationsMad: number;
  depensesMad: number;
  totalMad: number;
  decompteCumuleTtcMad: number;
  /** Décompte cumulé − coûts réels (positif = marge brute). */
  margeBruteMad: number;
  /** Part de chaque poste dans le coût total (0 quand total = 0). */
  repartitionPct: {
    mainOeuvre: number;
    materiel: number;
    consommations: number;
    depenses: number;
  };
  /** Coûts réels / montant marché (indicateur de dérive budget). */
  coutSurMarchePct: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function computeCoutsTerrain(input: CoutsTerrainInput): CoutsTerrain {
  const total = r2(
    input.mainOeuvreMad + input.materielMad + input.consommationsMad + input.depensesMad,
  );
  const pct = (part: number): number => (total > 0 ? r2((part / total) * 100) : 0);
  return {
    mainOeuvreMad: r2(input.mainOeuvreMad),
    materielMad: r2(input.materielMad),
    consommationsMad: r2(input.consommationsMad),
    depensesMad: r2(input.depensesMad),
    totalMad: total,
    decompteCumuleTtcMad: r2(input.decompteCumuleTtcMad),
    margeBruteMad: r2(input.decompteCumuleTtcMad - total),
    repartitionPct: {
      mainOeuvre: pct(input.mainOeuvreMad),
      materiel: pct(input.materielMad),
      consommations: pct(input.consommationsMad),
      depenses: pct(input.depensesMad),
    },
    coutSurMarchePct:
      input.montantMarcheMad > 0 ? r2((total / input.montantMarcheMad) * 100) : 0,
  };
}

/** Jours ouvrés/mois retenus pour convertir un salaire mensuel en taux jour. */
export const WORKING_DAYS_PER_MONTH = 26;

/** Coût d'un pointage: jours × taux jour effectif (mois → /26). */
export function coutPointage(
  daysWorked: number,
  rateType: string | null,
  rateAmountMad: number | null,
): number {
  if (!rateAmountMad || rateAmountMad <= 0) return 0;
  const tauxJour = rateType === 'mois' ? rateAmountMad / WORKING_DAYS_PER_MONTH : rateAmountMad;
  return r2(daysWorked * tauxJour);
}
