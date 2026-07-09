import { describe, expect, test } from 'vitest';
import {
  cumulativeQuantities,
  generateAttachement,
  generateDecompteFromMetres,
  type BordereauLine,
  type MetreContribution,
} from './decompte-generation.domain';

const bordereau: BordereauLine[] = [
  { key: '1', prixNo: 1, unite: 'M³', designation: 'A', quantite: 100, prixUnitaire: 100 },
  { key: '2', prixNo: 2, unite: 'M²', designation: 'B', quantite: 50, prixUnitaire: 200 },
];

describe('cumulativeQuantities', () => {
  test('sums métré partiels over périodes ≤ current, excludes later périodes', () => {
    const metres: MetreContribution[] = [
      { bordereauLigneKey: '1', periodeNumero: 1, totalPartiel: 30 },
      { bordereauLigneKey: '1', periodeNumero: 2, totalPartiel: 20 },
      { bordereauLigneKey: '1', periodeNumero: 3, totalPartiel: 999 }, // future, excluded
      { bordereauLigneKey: '2', periodeNumero: 1, totalPartiel: 10 },
    ];
    const c = cumulativeQuantities(metres, 2);
    expect(c.get('1')).toBe(50); // 30 + 20 (not 999)
    expect(c.get('2')).toBe(10);
  });
});

describe('generateDecompteFromMetres', () => {
  const metres: MetreContribution[] = [
    { bordereauLigneKey: '1', periodeNumero: 1, totalPartiel: 30 },
    { bordereauLigneKey: '1', periodeNumero: 2, totalPartiel: 20 },
    { bordereauLigneKey: '2', periodeNumero: 1, totalPartiel: 10 },
  ];

  test('quantities from métré cumul; HT/TVA/TTC + retenue (10% cap binds)', () => {
    const d = generateDecompteFromMetres({
      bordereau,
      metres,
      currentPeriodeNumero: 2,
      tauxTva: 20,
      isDernier: false,
      depensesExercicesAnterieurs: 0,
      decomptesPrecedents: 0,
    });
    expect(d.lignes[0]?.quantiteRealisee).toBe(50);
    expect(d.lignes[0]?.montantHT).toBe(5000);
    expect(d.lignes[1]?.quantiteRealisee).toBe(10);
    expect(d.totalHtMad).toBe(7000);
    expect(d.montantTvaMad).toBe(1400);
    expect(d.totalTtcMad).toBe(8400);
    expect(d.montantMarcheTtcMad).toBe(24000); // (100·100 + 50·200)·1.2
    // retenue = MIN(TRUNC(8400·10%)=840, TRUNC(24000·7%)=1680) = 840
    expect(d.retenueGarantieMad).toBe(840);
    expect(d.netAPayerMad).toBe(7560); // 8400 − 840
    expect(d.travauxNonTerminesMad).toBe(8400);
  });

  test('7% marché cap binds when realized work exceeds the marché', () => {
    // line 1 métré cumul 200 → HT 20000, TTC 24000; marché TTC only 12000+12000=24000
    const heavy: MetreContribution[] = [
      { bordereauLigneKey: '1', periodeNumero: 1, totalPartiel: 200 },
    ];
    const d = generateDecompteFromMetres({
      bordereau,
      metres: heavy,
      currentPeriodeNumero: 1,
      tauxTva: 20,
      isDernier: true,
      depensesExercicesAnterieurs: 0,
      decomptesPrecedents: 0,
    });
    expect(d.totalTtcMad).toBe(24000); // 20000 HT + 4000 TVA
    // retenue = MIN(TRUNC(24000·10%)=2400, TRUNC(24000·7%)=1680) = 1680
    expect(d.retenueGarantieMad).toBe(1680);
    expect(d.travauxTerminesMad).toBe(24000); // isDernier
  });

  test('retenue is 10% of the ROUNDED TTC (reconciles to the printed décompte)', () => {
    // qté 0.23 × 4348.20 = 1000.086 → TVA trunc 200.01 → TTC round 1200.10.
    // Retenue must be TRUNC(1200.10×10%)=120.01, NOT TRUNC(1200.096×10%)=120.00,
    // so it equals 10% of the SHOWN TTC. Large marché → the 10% branch binds.
    const d = generateDecompteFromMetres({
      bordereau: [
        { key: '1', prixNo: 1, unite: 'M³', designation: 'A', quantite: 100, prixUnitaire: 4348.2 },
      ],
      metres: [{ bordereauLigneKey: '1', periodeNumero: 1, totalPartiel: 0.23 }],
      currentPeriodeNumero: 1,
      tauxTva: 20,
      isDernier: false,
      depensesExercicesAnterieurs: 0,
      decomptesPrecedents: 0,
    });
    expect(d.totalTtcMad).toBe(1200.1);
    expect(d.retenueGarantieMad).toBe(120.01);
    expect(d.netAPayerMad).toBe(1080.09);
  });

  test('subtracts previous payments from the acompte', () => {
    const d = generateDecompteFromMetres({
      bordereau,
      metres,
      currentPeriodeNumero: 2,
      tauxTva: 20,
      isDernier: false,
      depensesExercicesAnterieurs: 1000,
      decomptesPrecedents: 2000,
    });
    expect(d.netAPayerMad).toBe(4560); // 8400 − 840 − 1000 − 2000
  });
});

describe('generateAttachement', () => {
  test('cumulative quantities only, drops zero lines', () => {
    const metres: MetreContribution[] = [
      { bordereauLigneKey: '1', periodeNumero: 1, totalPartiel: 30 },
    ];
    const a = generateAttachement(bordereau, metres, 1);
    expect(a).toHaveLength(1); // line 2 has 0 → dropped
    expect(a[0]).toMatchObject({ prixNo: 1, unite: 'M³', quantiteCumulee: 30 });
  });
});
