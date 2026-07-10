// Moteur fiscal marocain — IS, cotisation minimale, échéancier des
// déclarations & obligations légales annuelles. Règles du CGI en vigueur
// (post-convergence LF 2023) : taux IS unifié paramétrable (défaut 20 %,
// 35 % au-delà de 100 M MAD de bénéfice net), acomptes provisionnels =
// 4 × 25 % de l'impôt de référence N-1 (max(IS, CM)), cotisation minimale
// 0,25 % des produits imposables (plancher 3 000 DH), régularisation dans
// les 3 mois suivant la clôture. Tout montant est arrondi au centime.
import Decimal from 'decimal.js';

export function toDecimal(value: number | string | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value || 0);
}

export function round2(value: Decimal | number): number {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** Seuil du taux supérieur d'IS (bénéfice net fiscal, MAD). */
export const IS_SEUIL_GRANDE_ENTREPRISE = 100_000_000;
/** Taux IS applicable au-delà du seuil (LF 2023 → cible 2026). */
export const IS_TAUX_GRANDE_ENTREPRISE = 35;
/** Plancher légal de la cotisation minimale (CGI art. 144). */
export const COTISATION_MINIMALE_PLANCHER = 3_000;

/** IS théorique sur un résultat fiscal (0 si déficit). */
export function computeIs(resultatFiscal: number, tauxStandard: number): number {
  if (resultatFiscal <= 0) return 0;
  const taux =
    resultatFiscal >= IS_SEUIL_GRANDE_ENTREPRISE ? IS_TAUX_GRANDE_ENTREPRISE : tauxStandard;
  return round2(toDecimal(resultatFiscal).times(taux).dividedBy(100));
}

/**
 * Cotisation minimale : base = produits d'exploitation imposables (CA +
 * produits accessoires + produits financiers imposables + subventions),
 * plancher 3 000 DH même en l'absence de chiffre d'affaires.
 */
export function computeCotisationMinimale(baseProduits: number, taux: number): number {
  const cm = round2(toDecimal(Math.max(baseProduits, 0)).times(taux).dividedBy(100));
  return Math.max(cm, COTISATION_MINIMALE_PLANCHER);
}

export interface AcompteIs {
  numero: 1 | 2 | 3 | 4;
  montant: number;
  /** Fin du 3e/6e/9e/12e mois de l'exercice en cours. */
  dateEcheance: Date;
}

/**
 * Acomptes provisionnels de l'exercice N : 4 × 25 % de l'impôt de référence
 * de N-1 (le plus élevé de l'IS et de la cotisation minimale), exigibles
 * avant la fin des 3e, 6e, 9e et 12e mois de l'exercice.
 */
export function computeAcomptesIs(params: {
  annee: number;
  isN1: number;
  cotisationMinimaleN1: number;
}): AcompteIs[] {
  const reference = Math.max(params.isN1, params.cotisationMinimaleN1, 0);
  const acompte = round2(toDecimal(reference).dividedBy(4));
  const finMois = (mois: number) => new Date(params.annee, mois, 0); // day 0 => dernier jour du mois précédent
  return [
    { numero: 1, montant: acompte, dateEcheance: finMois(3) },
    { numero: 2, montant: acompte, dateEcheance: finMois(6) },
    { numero: 3, montant: acompte, dateEcheance: finMois(9) },
    { numero: 4, montant: acompte, dateEcheance: finMois(12) },
  ];
}

/**
 * Régularisation de l'exercice N (dans les 3 mois après clôture) :
 * impôt dû = max(IS, CM) ; reliquat = impôt dû − acomptes versés
 * (négatif = excédent imputable sur les acomptes suivants).
 */
export function computeSoldeIs(params: {
  isCalcule: number;
  cotisationMinimale: number;
  acomptesVerses: number;
}): { impotDu: number; reliquat: number } {
  const impotDu = Math.max(params.isCalcule, params.cotisationMinimale);
  return { impotDu, reliquat: round2(toDecimal(impotDu).minus(params.acomptesVerses)) };
}

/**
 * Contribution sociale de solidarité sur les bénéfices (prorogée 2026-2028
 * par la LF 2026) : due dès 1 M MAD de bénéfice net fiscal, au taux (appliqué
 * au bénéfice ENTIER) de 1,5 % [1-5M[, 2,5 % [5-10M[, 3,5 % [10-40M[ et 5 %
 * au-delà. Déclarée et payée avec la liasse (3 mois après clôture).
 */
export function computeCss(beneficeNetFiscal: number): number {
  if (beneficeNetFiscal < 1_000_000) return 0;
  const taux =
    beneficeNetFiscal >= 40_000_000
      ? 5
      : beneficeNetFiscal >= 10_000_000
        ? 3.5
        : beneficeNetFiscal >= 5_000_000
          ? 2.5
          : 1.5;
  return round2(toDecimal(beneficeNetFiscal).times(taux).dividedBy(100));
}

/**
 * Veille réglementaire — nouveautés à surveiller (LF 2026 & réformes en
 * cours), affichée telle quelle sur le tableau de bord comptable.
 */
export const VEILLE_REGLEMENTAIRE: ReadonlyArray<{
  titre: string;
  detail: string;
  impact: 'important' | 'a_suivre';
}> = [
  {
    titre: 'TVA — deux taux depuis le 01/01/2026',
    detail:
      'Fin de la réforme LF2024 : 20 % (normal, dont travaux BTP) et 10 % (réduit). Les taux 7 % et 14 % sont supprimés.',
    impact: 'important',
  },
  {
    titre: 'Retenue à la source TVA — attestation de régularité fiscale',
    detail:
      "Sans attestation de régularité fiscale de moins de 6 mois, l'État/CT/EEP retiennent 100 % de la TVA sur les décomptes de travaux. Garder l'ARF valide en permanence.",
    impact: 'important',
  },
  {
    titre: 'RAS 5 % sur les loyers versés aux personnes morales (01/07/2026)',
    detail:
      "LF2026 : l'État, les CT/EEP et les sociétés (CA ≥ 500 M DH, seuils abaissés en 2027/2028) retiennent 5 % sur les loyers — imputable sur l'IS du bailleur.",
    impact: 'a_suivre',
  },
  {
    titre: 'Contribution sociale de solidarité prorogée 2026-2028',
    detail:
      'Due dès 1 M MAD de bénéfice net fiscal : 1,5 % à 5 % selon la tranche, payable avec la liasse.',
    impact: 'a_suivre',
  },
  {
    titre: 'Facture électronique (e-invoicing DGI)',
    detail:
      'Cadre acté (UBL 2.1, pré-validation DGI), décret d’application non publié — se préparer sans date butoir arrêtée. LF2026 : comptabilité sous format électronique normalisé + adresse e-mail à déclarer à la DGI.',
    impact: 'a_suivre',
  },
  {
    titre: 'IR salaires — barème 2026 & charges de famille',
    detail:
      'Exonération jusqu’à 40 000 DH/an, taux marginal 37 % au-delà de 180 000 DH ; réduction pour charges de famille portée à 600 DH/an par personne (max 6).',
    impact: 'a_suivre',
  },
  {
    titre: 'CNSS — majorations adoucies depuis avril 2025',
    detail:
      'Déclaration et paiement avant le 10 du mois suivant (DAMANCOM) ; retard : 3 % le premier mois puis 0,5 % par mois.',
    impact: 'a_suivre',
  },
];

// ── Échéancier des déclarations fiscales d'une année civile ──────────────────

export interface DeclarationSpec {
  type: string;
  annee: number;
  periodeKey: string;
  label: string;
  dateEcheance: Date;
  note?: string;
}

function dernierJourDuMois(annee: number, mois1a12: number): Date {
  return new Date(annee, mois1a12, 0);
}

/**
 * Déclarations à échéance PENDANT l'année civile `annee` pour une société à
 * exercice calendaire soumise à l'IS (les périodes TVA et CNSS ont leurs
 * propres tables). L'IR est mensuel : retenues du mois M à verser avant la
 * fin du mois M+1 (télépaiement SIMPL-IR).
 */
export function generateEcheancierFiscal(annee: number): DeclarationSpec[] {
  const specs: DeclarationSpec[] = [];
  // Solde IS + liasse fiscale de l'exercice N-1 — 3 mois après clôture.
  specs.push({
    type: 'liasse_fiscale',
    annee,
    periodeKey: '',
    label: `Déclaration du résultat fiscal ${annee - 1} (liasse — SIMPL-IS)`,
    dateEcheance: new Date(annee, 2, 31),
  });
  specs.push({
    type: 'is_solde',
    annee,
    periodeKey: '',
    label: `Solde de l'IS ${annee - 1} (régularisation)`,
    dateEcheance: new Date(annee, 2, 31),
  });
  specs.push({
    type: 'css',
    annee,
    periodeKey: '',
    label: `Contribution sociale de solidarité ${annee - 1} (si bénéfice ≥ 1 M)`,
    dateEcheance: new Date(annee, 2, 31),
  });
  // Acomptes provisionnels de l'exercice N.
  for (const numero of [1, 2, 3, 4] as const) {
    specs.push({
      type: `is_acompte_${numero}`,
      annee,
      periodeKey: '',
      label: `Acompte provisionnel IS n°${numero}/${annee}`,
      dateEcheance: dernierJourDuMois(annee, numero * 3),
    });
  }
  // IR sur salaires — mensuel, fin du mois suivant.
  for (let mois = 1; mois <= 12; mois += 1) {
    const periodeKey = `${annee}-${String(mois).padStart(2, '0')}`;
    specs.push({
      type: 'ir_salaires',
      annee,
      periodeKey,
      label: `IR sur salaires ${periodeKey}`,
      dateEcheance:
        mois === 12 ? dernierJourDuMois(annee + 1, 1) : dernierJourDuMois(annee, mois + 1),
    });
  }
  // Déclaration annuelle des traitements et salaires (état 9421).
  specs.push({
    type: 'etat_9421',
    annee,
    periodeKey: '',
    label: `Déclaration annuelle des traitements et salaires ${annee - 1}`,
    dateEcheance: new Date(annee, 1, 28),
  });
  // Taxe professionnelle — selon rôle ; échéance usuelle 31 janvier.
  specs.push({
    type: 'tp',
    annee,
    periodeKey: '',
    label: `Taxe professionnelle ${annee} (selon rôle)`,
    dateEcheance: new Date(annee, 0, 31),
    note: 'Payable selon la date de mise en recouvrement du rôle.',
  });
  return specs;
}

// ── Obligations légales annuelles (checklist de l'exercice) ──────────────────

export interface ObligationSpec {
  type: string;
  label: string;
  dateEcheance: Date;
}

/** Obligations de l'exercice `annee` (échéances sur N et N+1). */
export function generateObligationsLegales(annee: number): ObligationSpec[] {
  return [
    {
      type: 'inventaire',
      label: `Inventaire physique annuel ${annee} (loi 9-88)`,
      dateEcheance: new Date(annee, 11, 31),
    },
    {
      type: 'liasse_fiscale',
      label: `Dépôt de la liasse fiscale ${annee} (SIMPL — 3 mois après clôture)`,
      dateEcheance: new Date(annee + 1, 2, 31),
    },
    {
      type: 'ag_annuelle',
      label: `Assemblée générale ordinaire (approbation des comptes ${annee})`,
      dateEcheance: new Date(annee + 1, 5, 30),
    },
    {
      type: 'depot_greffe',
      label: `Dépôt des états de synthèse ${annee} au greffe du tribunal`,
      dateEcheance: new Date(annee + 1, 6, 30),
    },
    {
      type: 'attestation_fiscale',
      label: `Renouvellement de l'attestation de régularité fiscale (marchés publics)`,
      dateEcheance: new Date(annee, 11, 31),
    },
  ];
}

/** Statut de vie d'une échéance à la date du jour (pour l'affichage). */
export function classifyEcheance(
  dateEcheance: Date,
  statut: string,
  today: Date = new Date(),
): 'fait' | 'en_retard' | 'urgent' | 'proche' | 'a_venir' {
  if (statut === 'payee' || statut === 'declaree' || statut === 'fait' || statut === 'na') {
    return 'fait';
  }
  const jours = Math.floor((dateEcheance.getTime() - today.getTime()) / 86_400_000);
  if (jours < 0) return 'en_retard';
  if (jours <= 7) return 'urgent';
  if (jours <= 30) return 'proche';
  return 'a_venir';
}
