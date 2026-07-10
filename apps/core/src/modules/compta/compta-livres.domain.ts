// Livres comptables — validation d'écriture (partie double), balance générale
// et états de synthèse simplifiés (Bilan / CPC) agrégés depuis les lignes.
// Le CGNC place le bilan sur les classes 1-5 et le CPC sur les classes 6-7 ;
// le résultat de la période = produits (7) − charges (6), présenté au passif.
import { round2, toDecimal } from './compta-fiscal.domain';

export interface LigneInput {
  compteCode: string;
  libelle?: string;
  debit: number;
  credit: number;
  tiers?: string;
}

export class ComptaValidationError extends Error {}

/**
 * Règles de saisie du journal (loi 9-88 / CGNC) : au moins deux lignes, des
 * comptes de détail (≥ 4 caractères), chaque ligne mouvemente un seul sens
 * (montant strictement positif), et Σ débits = Σ crédits au centime.
 */
export function validateEcriture(lignes: readonly LigneInput[]): {
  totalDebit: number;
  totalCredit: number;
} {
  if (lignes.length < 2) {
    throw new ComptaValidationError('Une écriture comporte au moins deux lignes.');
  }
  let totalDebit = toDecimal(0);
  let totalCredit = toDecimal(0);
  for (const ligne of lignes) {
    if (!ligne.compteCode || ligne.compteCode.length < 4) {
      throw new ComptaValidationError(
        `Compte « ${ligne.compteCode} » : la saisie se fait sur un compte de détail (4 chiffres et plus).`,
      );
    }
    const debit = toDecimal(ligne.debit);
    const credit = toDecimal(ligne.credit);
    if (debit.isNegative() || credit.isNegative()) {
      throw new ComptaValidationError('Les montants négatifs sont interdits (contre-passez).');
    }
    const unSens = debit.greaterThan(0) !== credit.greaterThan(0);
    if (!unSens) {
      throw new ComptaValidationError(
        `Ligne « ${ligne.compteCode} » : chaque ligne porte un débit OU un crédit strictement positif.`,
      );
    }
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
  }
  const d = round2(totalDebit);
  const c = round2(totalCredit);
  if (d !== c) {
    throw new ComptaValidationError(
      `Écriture déséquilibrée : débits ${d.toFixed(2)} ≠ crédits ${c.toFixed(2)}.`,
    );
  }
  return { totalDebit: d, totalCredit: c };
}

// ── Balance générale ─────────────────────────────────────────────────────────

export interface BalanceRow {
  compteCode: string;
  intitule: string;
  classe: number;
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

/** Agrège des lignes (déjà filtrées par période/exercice) en balance à 6 colonnes. */
export function computeBalance(
  lignes: ReadonlyArray<{ compteCode: string; debit: number; credit: number }>,
  intitules: ReadonlyMap<string, { intitule: string; classe: number }>,
): BalanceRow[] {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const ligne of lignes) {
    const entry = totals.get(ligne.compteCode) ?? { debit: 0, credit: 0 };
    entry.debit = round2(toDecimal(entry.debit).plus(ligne.debit));
    entry.credit = round2(toDecimal(entry.credit).plus(ligne.credit));
    totals.set(ligne.compteCode, entry);
  }
  return [...totals.entries()]
    .map(([compteCode, { debit, credit }]) => {
      const meta = intitules.get(compteCode);
      const solde = round2(toDecimal(debit).minus(credit));
      return {
        compteCode,
        intitule: meta?.intitule ?? compteCode,
        classe: meta?.classe ?? Number(compteCode[0] ?? 0),
        totalDebit: debit,
        totalCredit: credit,
        soldeDebiteur: solde > 0 ? solde : 0,
        soldeCrediteur: solde < 0 ? round2(toDecimal(solde).negated()) : 0,
      };
    })
    .sort((a, b) => a.compteCode.localeCompare(b.compteCode));
}

// ── États de synthèse (modèle simplifié) ─────────────────────────────────────

export interface EtatPoste {
  label: string;
  /** Préfixes de comptes agrégés dans ce poste. */
  prefixes: string[];
  montant: number;
}

export interface EtatsSynthese {
  cpc: {
    produitsExploitation: number;
    chargesExploitation: number;
    resultatExploitation: number;
    produitsFinanciers: number;
    chargesFinancieres: number;
    resultatFinancier: number;
    produitsNonCourants: number;
    chargesNonCourantes: number;
    resultatNonCourant: number;
    impotsResultats: number;
    resultatNet: number;
    postesCharges: EtatPoste[];
    postesProduits: EtatPoste[];
  };
  bilan: {
    actifImmobilise: number;
    actifCirculant: number;
    tresorerieActif: number;
    totalActif: number;
    financementPermanent: number;
    passifCirculant: number;
    tresoreriePassif: number;
    resultatPeriode: number;
    totalPassif: number;
  };
}

function sumSolde(
  rows: readonly BalanceRow[],
  test: (code: string) => boolean,
  sens: 'debiteur' | 'crediteur',
): number {
  let total = toDecimal(0);
  for (const row of rows) {
    if (!test(row.compteCode)) continue;
    // Solde net signé dans le sens demandé (un compte de charge créditeur
    // vient en déduction, comme au CPC réel).
    const net = toDecimal(row.soldeDebiteur).minus(row.soldeCrediteur);
    total = total.plus(sens === 'debiteur' ? net : net.negated());
  }
  return round2(total);
}

const POSTES_CHARGES: ReadonlyArray<{ label: string; prefixes: string[] }> = [
  { label: 'Achats consommés de matières et fournitures', prefixes: ['611', '612'] },
  { label: 'Autres charges externes', prefixes: ['613', '614'] },
  { label: 'Impôts et taxes', prefixes: ['616'] },
  { label: 'Charges de personnel', prefixes: ['617'] },
  { label: 'Autres charges d’exploitation', prefixes: ['618'] },
  { label: 'Dotations d’exploitation', prefixes: ['619'] },
];

const POSTES_PRODUITS: ReadonlyArray<{ label: string; prefixes: string[] }> = [
  { label: 'Ventes de marchandises', prefixes: ['711'] },
  { label: 'Ventes de biens et services (travaux)', prefixes: ['712'] },
  { label: 'Variation de stocks de produits', prefixes: ['713'] },
  { label: 'Subventions, autres produits, reprises', prefixes: ['716', '718', '719'] },
];

/** Bilan + CPC simplifiés à partir de la balance (comptes de détail). */
export function computeEtatsSynthese(rows: readonly BalanceRow[]): EtatsSynthese {
  const detail = rows.filter((r) => r.compteCode.length >= 4);
  const par = (prefixes: string[], sens: 'debiteur' | 'crediteur') =>
    sumSolde(detail, (code) => prefixes.some((p) => code.startsWith(p)), sens);

  const chargesExploitation = par(['61'], 'debiteur');
  const produitsExploitation = par(['71'], 'crediteur');
  const chargesFinancieres = par(['63'], 'debiteur');
  const produitsFinanciers = par(['73'], 'crediteur');
  const chargesNonCourantes = par(['65'], 'debiteur');
  const produitsNonCourants = par(['75'], 'crediteur');
  const impotsResultats = par(['67'], 'debiteur');

  const resultatExploitation = round2(
    toDecimal(produitsExploitation).minus(chargesExploitation),
  );
  const resultatFinancier = round2(toDecimal(produitsFinanciers).minus(chargesFinancieres));
  const resultatNonCourant = round2(
    toDecimal(produitsNonCourants).minus(chargesNonCourantes),
  );
  const resultatNet = round2(
    toDecimal(resultatExploitation)
      .plus(resultatFinancier)
      .plus(resultatNonCourant)
      .minus(impotsResultats),
  );

  const actifImmobilise = par(['2'], 'debiteur');
  const actifCirculant = par(['3'], 'debiteur');
  const tresorerieActif = par(['51'], 'debiteur');
  const financementPermanent = par(['1'], 'crediteur');
  const passifCirculant = par(['44', '45'], 'crediteur');
  const tresoreriePassif = par(['55'], 'crediteur');

  return {
    cpc: {
      produitsExploitation,
      chargesExploitation,
      resultatExploitation,
      produitsFinanciers,
      chargesFinancieres,
      resultatFinancier,
      produitsNonCourants,
      chargesNonCourantes,
      resultatNonCourant,
      impotsResultats,
      resultatNet,
      postesCharges: POSTES_CHARGES.map((p) => ({
        ...p,
        montant: par(p.prefixes, 'debiteur'),
      })),
      postesProduits: POSTES_PRODUITS.map((p) => ({
        ...p,
        montant: par(p.prefixes, 'crediteur'),
      })),
    },
    bilan: {
      actifImmobilise,
      actifCirculant,
      tresorerieActif,
      totalActif: round2(
        toDecimal(actifImmobilise).plus(actifCirculant).plus(tresorerieActif),
      ),
      financementPermanent,
      passifCirculant,
      tresoreriePassif,
      resultatPeriode: resultatNet,
      totalPassif: round2(
        toDecimal(financementPermanent)
          .plus(passifCirculant)
          .plus(tresoreriePassif)
          .plus(resultatNet),
      ),
    },
  };
}
