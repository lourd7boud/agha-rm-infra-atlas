// Tests à valeurs exactes des moteurs compta — mêmes conventions que les
// specs BTP : chaque règle fiscale vérifiée au centime. Les dates sont
// comparées en calendrier LOCAL (les échéances sont des dates civiles).
import { describe, expect, it } from 'vitest';
import {
  classifyEcheance,
  computeAcomptesIs,
  computeCotisationMinimale,
  computeCss,
  computeIs,
  computeSoldeIs,
  generateEcheancierFiscal,
  generateObligationsLegales,
} from './compta-fiscal.domain';
import {
  computeTvaDue,
  computeTvaFromLignes,
  tvaEcheance,
  tvaPeriodeBornes,
  tvaPeriodeKeys,
} from './compta-tva.domain';
import { cnssEcheance, computeCotisations, computeIrMensuel } from './compta-social.domain';
import { planAmortissement, situationFinExercice } from './compta-amortissement.domain';
import {
  ComptaValidationError,
  computeBalance,
  computeEtatsSynthese,
  validateEcriture,
} from './compta-livres.domain';

/** Date civile locale — évite le décalage UTC de toISOString. */
function jour(date: Date | undefined): string {
  if (!date) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

describe('IS & cotisation minimale', () => {
  it('applique le taux standard sous 100 M et 35 % au-delà', () => {
    expect(computeIs(500_000, 20)).toBe(100_000);
    expect(computeIs(120_000_000, 20)).toBe(42_000_000);
    expect(computeIs(-50_000, 20)).toBe(0);
  });

  it('cotisation minimale 0,25 % avec plancher 3 000 DH', () => {
    expect(computeCotisationMinimale(10_000_000, 0.25)).toBe(25_000);
    expect(computeCotisationMinimale(500_000, 0.25)).toBe(3_000);
    expect(computeCotisationMinimale(0, 0.25)).toBe(3_000);
  });

  it('4 acomptes de 25 % de max(IS, CM) N-1 aux fins de trimestre civil', () => {
    const acomptes = computeAcomptesIs({ annee: 2026, isN1: 80_000, cotisationMinimaleN1: 25_000 });
    expect(acomptes.map((a) => a.montant)).toEqual([20_000, 20_000, 20_000, 20_000]);
    expect(acomptes.map((a) => jour(a.dateEcheance))).toEqual([
      '2026-03-31',
      '2026-06-30',
      '2026-09-30',
      '2026-12-31',
    ]);
  });

  it('solde IS = max(IS, CM) − acomptes', () => {
    expect(
      computeSoldeIs({ isCalcule: 90_000, cotisationMinimale: 25_000, acomptesVerses: 80_000 }),
    ).toEqual({ impotDu: 90_000, reliquat: 10_000 });
    expect(
      computeSoldeIs({ isCalcule: 10_000, cotisationMinimale: 25_000, acomptesVerses: 30_000 }),
    ).toEqual({ impotDu: 25_000, reliquat: -5_000 });
  });

  it('CSS par tranche appliquée au bénéfice entier', () => {
    expect(computeCss(800_000)).toBe(0);
    expect(computeCss(3_000_000)).toBe(45_000);
    expect(computeCss(8_000_000)).toBe(200_000);
    expect(computeCss(20_000_000)).toBe(700_000);
    expect(computeCss(50_000_000)).toBe(2_500_000);
  });
});

describe('échéancier fiscal & statuts', () => {
  it("génère l'année fiscale complète (21 échéances)", () => {
    const specs = generateEcheancierFiscal(2026);
    expect(specs).toHaveLength(21);
    const liasse = specs.find((s) => s.type === 'liasse_fiscale');
    expect(jour(liasse?.dateEcheance)).toBe('2026-03-31');
    const irJanvier = specs.find((s) => s.type === 'ir_salaires' && s.periodeKey === '2026-01');
    expect(jour(irJanvier?.dateEcheance)).toBe('2026-02-28');
    const irDecembre = specs.find((s) => s.type === 'ir_salaires' && s.periodeKey === '2026-12');
    expect(jour(irDecembre?.dateEcheance)).toBe('2027-01-31');
  });

  it('obligations légales : liasse, AG et dépôt greffe sur N+1', () => {
    const obligations = generateObligationsLegales(2026);
    const ag = obligations.find((o) => o.type === 'ag_annuelle');
    expect(jour(ag?.dateEcheance)).toBe('2027-06-30');
  });

  it("classifyEcheance suit retard/urgent/proche selon aujourd'hui", () => {
    const today = new Date(2026, 6, 10);
    expect(classifyEcheance(new Date(2026, 6, 5), 'a_declarer', today)).toBe('en_retard');
    expect(classifyEcheance(new Date(2026, 6, 15), 'a_declarer', today)).toBe('urgent');
    expect(classifyEcheance(new Date(2026, 7, 5), 'a_declarer', today)).toBe('proche');
    expect(classifyEcheance(new Date(2026, 10, 30), 'a_venir', today)).toBe('a_venir');
    expect(classifyEcheance(new Date(2026, 6, 5), 'payee', today)).toBe('fait');
  });
});

describe('TVA', () => {
  it('périodes mensuelles et trimestrielles', () => {
    expect(tvaPeriodeKeys(2026, 'mensuel')).toHaveLength(12);
    expect(tvaPeriodeKeys(2026, 'trimestriel')).toEqual([
      '2026-T1',
      '2026-T2',
      '2026-T3',
      '2026-T4',
    ]);
  });

  it('échéance = fin du mois suivant la période (SIMPL)', () => {
    expect(jour(tvaEcheance('2026-01'))).toBe('2026-02-28');
    expect(jour(tvaEcheance('2026-12'))).toBe('2027-01-31');
    expect(jour(tvaEcheance('2026-T1'))).toBe('2026-04-30');
    expect(jour(tvaEcheance('2026-T4'))).toBe('2027-01-31');
  });

  it('bornes de période', () => {
    const t2 = tvaPeriodeBornes('2026-T2');
    expect(jour(t2.debut)).toBe('2026-04-01');
    expect(jour(t2.fin)).toBe('2026-06-30');
  });

  it('TVA due vs crédit reporté', () => {
    expect(
      computeTvaDue({
        tvaCollectee: 100_000,
        tvaDeductibleCharges: 40_000,
        tvaDeductibleImmo: 10_000,
        creditAnterieur: 0,
      }).tvaDue,
    ).toBe(50_000);
    const credit = computeTvaDue({
      tvaCollectee: 10_000,
      tvaDeductibleCharges: 15_000,
      tvaDeductibleImmo: 0,
      creditAnterieur: 2_000,
    });
    expect(credit.tvaDue).toBe(0);
    expect(credit.creditNouveau).toBe(7_000);
  });

  it('pré-remplissage depuis les lignes 4455 / 34551 / 34552', () => {
    expect(
      computeTvaFromLignes([
        { compteCode: '4455', debit: 0, credit: 200 },
        { compteCode: '34552', debit: 80, credit: 0 },
        { compteCode: '34551', debit: 30, credit: 0 },
        { compteCode: '6121', debit: 400, credit: 0 },
      ]),
    ).toEqual({ collectee: 200, deductibleCharges: 80, deductibleImmo: 30 });
  });
});

describe('CNSS / AMO / IR', () => {
  it('cotisations 2026 exactes (masse 100 000, plafonnée 60 000)', () => {
    const r = computeCotisations({ masseSalariale: 100_000, massePlafonnee: 60_000 });
    expect(r.detail['allocationsFamiliales']?.patronal).toBe(6_400);
    expect(r.detail['prestationsCourtTerme']).toEqual({ patronal: 630, salarial: 312 });
    expect(r.detail['prestationsLongTerme']).toEqual({ patronal: 4_758, salarial: 2_376 });
    expect(r.detail['amo']).toEqual({ patronal: 2_260, salarial: 2_260 });
    expect(r.detail['participationAmo']?.patronal).toBe(1_850);
    expect(r.detail['formationProfessionnelle']?.patronal).toBe(1_600);
    expect(r.partPatronale).toBe(17_498);
    expect(r.partSalariale).toBe(4_948);
    expect(r.total).toBe(22_446);
  });

  it('échéance DAMANCOM le 10 du mois suivant', () => {
    expect(jour(cnssEcheance('2026-01'))).toBe('2026-02-10');
    expect(jour(cnssEcheance('2026-12'))).toBe('2027-01-10');
  });

  it('IR mensuel estimatif — brut 10 000 DH sans charges de famille', () => {
    const r = computeIrMensuel({ brutMensuel: 10_000 });
    expect(r.cotisationsSalariales).toBe(494.8);
    expect(r.rni).toBe(7_005.2);
    expect(r.ir).toBe(601.56);
  });

  it('IR nul sous le seuil exonéré', () => {
    expect(computeIrMensuel({ brutMensuel: 3_000 }).ir).toBe(0);
  });
});

describe('amortissement linéaire prorata temporis', () => {
  it('plan complet — 100 000 à 20 %, mise en service 15/03/2026', () => {
    const plan = planAmortissement({
      valeurHt: 100_000,
      tauxAmortissement: 20,
      dateMiseEnService: new Date(2026, 2, 15),
    });
    expect(plan).toHaveLength(6);
    expect(plan[0]).toEqual({ annee: 2026, dotation: 16_666.67, cumul: 16_666.67, vnc: 83_333.33 });
    expect(plan[1]?.dotation).toBe(20_000);
    expect(plan[5]).toEqual({ annee: 2031, dotation: 3_333.33, cumul: 100_000, vnc: 0 });
  });

  it("situation à une fin d'exercice", () => {
    const immo = {
      valeurHt: 100_000,
      tauxAmortissement: 20,
      dateMiseEnService: new Date(2026, 2, 15),
    };
    expect(situationFinExercice(immo, 2027)).toEqual({ cumul: 36_666.67, vnc: 63_333.33 });
    expect(situationFinExercice(immo, 2025)).toEqual({ cumul: 0, vnc: 100_000 });
  });
});

describe('écritures & états', () => {
  it('valide une écriture équilibrée', () => {
    expect(
      validateEcriture([
        { compteCode: '3421', debit: 1_200, credit: 0 },
        { compteCode: '7124', debit: 0, credit: 1_000 },
        { compteCode: '4455', debit: 0, credit: 200 },
      ]),
    ).toEqual({ totalDebit: 1_200, totalCredit: 1_200 });
  });

  it('rejette déséquilibre, ligne unique, compte rubrique et double sens', () => {
    expect(() =>
      validateEcriture([
        { compteCode: '3421', debit: 100, credit: 0 },
        { compteCode: '7124', debit: 0, credit: 90 },
      ]),
    ).toThrow(ComptaValidationError);
    expect(() => validateEcriture([{ compteCode: '3421', debit: 100, credit: 0 }])).toThrow(
      ComptaValidationError,
    );
    expect(() =>
      validateEcriture([
        { compteCode: '71', debit: 0, credit: 100 },
        { compteCode: '3421', debit: 100, credit: 0 },
      ]),
    ).toThrow(ComptaValidationError);
    expect(() =>
      validateEcriture([
        { compteCode: '3421', debit: 100, credit: 100 },
        { compteCode: '7124', debit: 100, credit: 100 },
      ]),
    ).toThrow(ComptaValidationError);
  });

  it('balance + états de synthèse équilibrés', () => {
    const lignes = [
      { compteCode: '3421', debit: 12_000, credit: 0 },
      { compteCode: '7124', debit: 0, credit: 10_000 },
      { compteCode: '4455', debit: 0, credit: 2_000 },
      { compteCode: '6121', debit: 4_000, credit: 0 },
      { compteCode: '34552', debit: 800, credit: 0 },
      { compteCode: '4411', debit: 0, credit: 4_800 },
    ];
    const intitules = new Map([
      ['3421', { intitule: 'Clients', classe: 3 }],
      ['7124', { intitule: 'Travaux', classe: 7 }],
    ]);
    const balance = computeBalance(lignes, intitules);
    expect(balance.find((r) => r.compteCode === '3421')?.soldeDebiteur).toBe(12_000);

    const etats = computeEtatsSynthese(balance);
    expect(etats.cpc.produitsExploitation).toBe(10_000);
    expect(etats.cpc.chargesExploitation).toBe(4_000);
    expect(etats.cpc.resultatNet).toBe(6_000);
    expect(etats.bilan.totalActif).toBe(12_800);
    expect(etats.bilan.totalPassif).toBe(12_800);
  });
});
