// TVA marocaine — périodes de déclaration (SIMPL-TVA), échéances et calcul de
// la TVA due. Régime mensuel (CA taxable N-1 ≥ 1 M MAD ou option) ; régime
// trimestriel sinon. Télédéclaration + télépaiement obligatoires : échéance =
// fin du mois suivant la période (art. 108/110/111 CGI). Depuis le 1/1/2026
// deux taux subsistent (20 % normal — les travaux BTP en relèvent — et 10 %
// réduit) ; les écritures portent la TVA réelle de chaque pièce.
import { round2, toDecimal } from './compta-fiscal.domain';

export type RegimeTva = 'mensuel' | 'trimestriel';

/** Clés de période d'une année: '2026-01'…'2026-12' ou '2026-T1'…'2026-T4'. */
export function tvaPeriodeKeys(annee: number, regime: RegimeTva): string[] {
  if (regime === 'trimestriel') {
    return [1, 2, 3, 4].map((t) => `${annee}-T${t}`);
  }
  return Array.from({ length: 12 }, (_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`);
}

function parsePeriode(periodeKey: string): { annee: number; finPeriodeMois: number } {
  const trimestriel = periodeKey.includes('-T');
  const [anneeStr = '0', suffixe = ''] = periodeKey.split('-');
  const annee = Number(anneeStr);
  const finPeriodeMois = trimestriel ? Number(suffixe.slice(1)) * 3 : Number(suffixe);
  return { annee, finPeriodeMois };
}

/** Dernier jour du mois suivant la fin de la période — échéance SIMPL-TVA. */
export function tvaEcheance(periodeKey: string): Date {
  const { annee, finPeriodeMois } = parsePeriode(periodeKey);
  const mois = finPeriodeMois + 1; // 13 => janvier de l'année suivante
  return mois > 12 ? new Date(annee + 1, mois - 12, 0) : new Date(annee, mois, 0);
}

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const;

/** Libellé humain d'une clé de période ('janvier 2026', 'T1 2026'). */
export function tvaPeriodeLabel(periodeKey: string): string {
  if (periodeKey.includes('-T')) {
    const [annee, t] = periodeKey.split('-');
    return `${t} ${annee}`;
  }
  const [annee = '', mois = ''] = periodeKey.split('-');
  return `${MOIS_FR[Number(mois) - 1] ?? mois} ${annee}`;
}

/** Bornes [début, fin] d'une clé de période (dates civiles). */
export function tvaPeriodeBornes(periodeKey: string): { debut: Date; fin: Date } {
  const { annee, finPeriodeMois } = parsePeriode(periodeKey);
  const debutMois = periodeKey.includes('-T') ? finPeriodeMois - 2 : finPeriodeMois;
  return {
    debut: new Date(annee, debutMois - 1, 1),
    fin: new Date(annee, finPeriodeMois, 0),
  };
}

export interface TvaComputation {
  tvaCollectee: number;
  tvaDeductibleCharges: number;
  tvaDeductibleImmo: number;
  creditAnterieur: number;
  /** TVA nette à verser (0 si crédit). */
  tvaDue: number;
  /** Crédit reporté sur la période suivante (0 si TVA due). */
  creditNouveau: number;
}

/** TVA due = collectée − déductibles − crédit antérieur (négatif ⇒ crédit). */
export function computeTvaDue(input: {
  tvaCollectee: number;
  tvaDeductibleCharges: number;
  tvaDeductibleImmo: number;
  creditAnterieur: number;
}): TvaComputation {
  const net = toDecimal(input.tvaCollectee)
    .minus(input.tvaDeductibleCharges)
    .minus(input.tvaDeductibleImmo)
    .minus(input.creditAnterieur);
  return {
    tvaCollectee: round2(toDecimal(input.tvaCollectee)),
    tvaDeductibleCharges: round2(toDecimal(input.tvaDeductibleCharges)),
    tvaDeductibleImmo: round2(toDecimal(input.tvaDeductibleImmo)),
    creditAnterieur: round2(toDecimal(input.creditAnterieur)),
    tvaDue: net.greaterThan(0) ? round2(net) : 0,
    creditNouveau: net.lessThan(0) ? round2(net.negated()) : 0,
  };
}

/**
 * Pré-remplissage depuis les écritures de la période : la TVA facturée vit au
 * crédit de 4455*, la TVA récupérable au débit de 34551* (immobilisations) et
 * 34552* (charges). Les contre-passations se compensent naturellement.
 */
export function computeTvaFromLignes(
  lignes: ReadonlyArray<{ compteCode: string; debit: number; credit: number }>,
): { collectee: number; deductibleCharges: number; deductibleImmo: number } {
  let collectee = toDecimal(0);
  let charges = toDecimal(0);
  let immo = toDecimal(0);
  for (const ligne of lignes) {
    if (ligne.compteCode.startsWith('4455')) {
      collectee = collectee.plus(ligne.credit).minus(ligne.debit);
    } else if (ligne.compteCode.startsWith('34551')) {
      immo = immo.plus(ligne.debit).minus(ligne.credit);
    } else if (ligne.compteCode.startsWith('34552') || ligne.compteCode === '3455') {
      charges = charges.plus(ligne.debit).minus(ligne.credit);
    }
  }
  return {
    collectee: round2(collectee),
    deductibleCharges: round2(charges),
    deductibleImmo: round2(immo),
  };
}
