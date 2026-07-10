// Exact-value tests for the three BTP engines — the expected numbers replicate
// the source app's Excel-compliance rules (ROUND vs TRUNC at each stage).
import { describe, expect, it } from 'vitest';
import {
  computeBordereau,
  computeDecompte,
  computeMarcheTtcInternal,
  computeProgressPct,
  round2,
  toDecimal,
  trunc2,
} from './btp-finance.domain';
import { computeLignePartiel, computeMetreTotals, POIDS_ACIER } from './btp-metre.domain';
import {
  calculateDecompteRevision,
  calculateMonthCoefficient,
  getDaysInMonthForPeriod,
  validateFormula,
} from './btp-revision.domain';
import { computeDelaiInfo, computePenalite } from './btp-registres.domain';
import { computeCoutsTerrain, coutPointage, parseAcquisition } from './btp-terrain.domain';

describe('btp-finance rounding primitives', () => {
  it('trunc2 cuts, round2 rounds half-up', () => {
    expect(trunc2(toDecimal(10.999)).toNumber()).toBe(10.99);
    expect(round2(toDecimal(10.995)).toNumber()).toBe(11);
    expect(round2(toDecimal(10.994)).toNumber()).toBe(10.99);
  });
});

describe('computeBordereau', () => {
  const lignes = [
    { numero: 1, designation: 'Béton', unite: 'M³', quantite: 10, prixUnitaire: 100.5 },
    { numero: 2, designation: 'Acier', unite: 'KG', quantite: 3, prixUnitaire: 33.333 },
  ];

  it('per-line montant is ROUND(q×pu, 2); totals follow HT→TVA(TRUNC)→TTC(ROUND)', () => {
    const result = computeBordereau(lignes);
    expect(result.lignes[0]!.montant).toBe(1005);
    expect(result.lignes[1]!.montant).toBe(100); // 99.999 → 100.00
    expect(result.montantHt).toBe(1105); // round2(1104.999)
    expect(result.montantTva).toBe(220.99); // trunc2(220.9998)
    expect(result.montantTtc).toBe(1325.99); // round2(1104.999 + 220.99)
  });

  it('marché TTC for the retenue cap is Σ(q×pu)×1.2 at full precision', () => {
    expect(computeMarcheTtcInternal(lignes).toNumber()).toBeCloseTo(1325.9988, 4);
  });
});

describe('computeDecompte', () => {
  const bordereau = [
    {
      id: 'b-ligne-1',
      numero: 1,
      designation: 'Béton',
      unite: 'M³',
      quantite: 100,
      prixUnitaire: 50,
    },
  ];

  it('cumulative quantity → HT → TVA(TRUNC) → TTC(ROUND) → retenue MIN → acompte', () => {
    const result = computeDecompte({
      bordereauLignes: bordereau,
      cumulativeQuantites: new Map([['b-ligne-1', 40]]),
      tauxTva: 20,
      tauxRetenue: 10,
      isDernier: false,
      priorAcomptes: [],
      anneeCourante: 2026,
    });
    expect(result.totalHt).toBe(2000);
    expect(result.montantTva).toBe(400);
    expect(result.totalTtc).toBe(2400);
    // retenue = MIN(trunc2(2400×10%)=240, trunc2(6000×7%)=420) = 240
    expect(result.retenueGarantie).toBe(240);
    expect(result.montantAcompte).toBe(2160);
    expect(result.travauxNonTermines).toBe(2400);
    expect(result.travauxTermines).toBe(0);
  });

  it('caps the retenue at 7% of the whole marché TTC', () => {
    const result = computeDecompte({
      bordereauLignes: bordereau,
      cumulativeQuantites: new Map([['b-ligne-1', 100]]), // 100% réalisé
      tauxTva: 20,
      tauxRetenue: 10,
      isDernier: false,
      priorAcomptes: [],
      anneeCourante: 2026,
    });
    // TTC cumulé = 6000; 10% = 600 > cap 7%×6000 = 420 → 420.
    expect(result.retenueGarantie).toBe(420);
  });

  it('splits prior acomptes by fiscal year (antérieurs vs précédents)', () => {
    const result = computeDecompte({
      bordereauLignes: bordereau,
      cumulativeQuantites: new Map([['b-ligne-1', 60]]),
      tauxTva: 20,
      tauxRetenue: 10,
      isDernier: false,
      priorAcomptes: [
        { montantAcompte: 1000, annee: 2025 },
        { montantAcompte: 500, annee: 2026 },
      ],
      anneeCourante: 2026,
    });
    expect(result.depensesAnterieures).toBe(1000);
    expect(result.decomptesPrecedents).toBe(500);
    // TTC 3600, retenue min(360, 420)=360 → acompte 3600−360−1000−500 = 1740.
    expect(result.montantAcompte).toBe(1740);
  });

  it('applies the révision only on the décompte dernier (TRUNC 2)', () => {
    const result = computeDecompte({
      bordereauLignes: bordereau,
      cumulativeQuantites: new Map([['b-ligne-1', 40]]),
      tauxTva: 20,
      tauxRetenue: 10,
      isDernier: true,
      priorAcomptes: [],
      anneeCourante: 2026,
      revisionCoefficient: 0.0177,
    });
    // HT 2000 → révision interne 35.4 → TRUNC 35.40; HT effectif 2035.4;
    // TVA trunc2(407.08)=407.08; TTC round2(2442.48)=2442.48.
    expect(result.revisionMontant).toBe(35.4);
    expect(result.montantTva).toBe(407.08);
    expect(result.totalTtc).toBe(2442.48);
    expect(result.travauxTermines).toBe(2442.48);
    expect(result.travauxNonTermines).toBe(0);
  });

  it('progress % = dernier TTC ÷ marché TTC × 100', () => {
    expect(computeProgressPct(2400, bordereau)).toBe(40);
  });
});

describe('métré engine', () => {
  it('volume = L×l×P × nombreSemblables', () => {
    expect(
      computeLignePartiel('M³', {
        id: '1',
        longueur: 2,
        largeur: 3,
        profondeur: 0.5,
        nombreSemblables: 2,
      }),
    ).toBe(6);
  });

  it('poids KG = nombre × longueur × poids(diamètre); T divides by 1000', () => {
    expect(POIDS_ACIER[8]).toBe(0.395);
    expect(
      computeLignePartiel('KG', { id: '1', nombre: 10, longueur: 12, diametre: 8 }),
    ).toBeCloseTo(47.4, 10);
    expect(
      computeLignePartiel('T', { id: '1', nombre: 10, longueur: 12, diametre: 8 }),
    ).toBeCloseTo(0.0474, 10);
  });

  it('manual partiel passes through when no dimensions are given', () => {
    expect(computeLignePartiel('M³', { id: '1', partiel: 12.34 })).toBe(12.34);
  });

  it('sous-section nombreElements multiplies poids lignes; total is ROUND 2', () => {
    const totals = computeMetreTotals(
      'KG',
      [{ id: 'ss1', titre: 'Poteaux', nombreElements: 3 }],
      [
        { id: 'l1', subSectionId: 'ss1', nombre: 10, longueur: 12, diametre: 8 }, // 47.4 ×3
        { id: 'l2', partiel: 0.005 }, // manual
      ],
    );
    expect(totals.lignes[0]!.partiel).toBeCloseTo(142.2, 10);
    expect(totals.totalPartiel).toBe(142.21); // round2(142.205)
  });

  it('unknown unités fall back to Nombre', () => {
    expect(computeLignePartiel('FF', { id: '1', nombre: 2 })).toBe(2);
  });
});

describe('révision engine', () => {
  const formula = { name: 'Test', fixedPart: 0.15, weights: { At: 0.35, Cs: 0.5 } };

  it('month coefficient = TRUNC(fixed + Σ w·TRUNC(ratio,4) − 1, 4)', () => {
    const result = calculateMonthCoefficient({ At: 105, Cs: 110 }, { At: 100, Cs: 100 }, formula);
    // 0.15 + 0.35×1.05 + 0.5×1.1 = 1.0675 → 0.0675
    expect(result.display).toBe(0.0675);
    expect(result.breakdown.indexContributions.At!.ratio).toBe(1.05);
  });

  it('day counting inside a période span', () => {
    const start = new Date(2026, 0, 15);
    const end = new Date(2026, 1, 10);
    expect(getDaysInMonthForPeriod('2026-01', start, end)).toBe(17);
    expect(getDaysInMonthForPeriod('2026-02', start, end)).toBe(10);
  });

  it('full décompte révision: weighted coefficient + TRUNC(montant×coef, 2)', () => {
    const result = calculateDecompteRevision({
      montantAReviser: 10000,
      periodStart: new Date(2026, 0, 1),
      periodEnd: new Date(2026, 0, 31),
      baseIndexes: { At: 100, Cs: 100 },
      monthlyIndexes: new Map([['2026-01', { At: 105, Cs: 110 }]]),
      formula,
    });
    expect(result.coefficient).toBe(0.0675);
    expect(result.montantRevision).toBe(675);
    expect(result.missingMonths).toEqual([]);
  });

  it('validateFormula requires fixed + Σ weights = 1', () => {
    expect(validateFormula(formula).valid).toBe(true);
    expect(validateFormula({ ...formula, fixedPart: 0.2 }).valid).toBe(false);
  });
});

describe('délais & pénalités', () => {
  it('délai effectif = OSC + mois + jours d’arrêt', () => {
    const info = computeDelaiInfo({
      ordreServiceDate: new Date(2026, 0, 1),
      delaiMois: 6,
      arrets: [{ dateArret: '2026-02-01', dateReprise: '2026-02-11' }],
      receptionProvisoire: null,
      receptionDefinitive: null,
      today: new Date(2026, 2, 1),
    });
    expect(info.delaiJours).toBe(180);
    expect(info.joursArret).toBe(10);
    expect(info.dateFinInitiale?.getMonth()).toBe(6); // juillet
    expect(info.dateFinEffective?.getDate()).toBe(11);
    expect(info.status).toBe('normal');
  });

  it('pénalité = base×taux×jours plafonnée à plafond%', () => {
    const small = computePenalite({
      baseCalcul: 1_000_000,
      taux: 0.001,
      nombreJours: 15,
      plafondPourcentage: 10,
    });
    expect(small.montantPenalite).toBe(15000);
    expect(small.montantApplique).toBe(15000);
    const capped = computePenalite({
      baseCalcul: 1_000_000,
      taux: 0.001,
      nombreJours: 150,
      plafondPourcentage: 10,
    });
    expect(capped.montantPenalite).toBe(150000);
    expect(capped.montantPlafond).toBe(100000);
    expect(capped.montantApplique).toBe(100000);
  });
});

describe('terrain — coûts réels & acquisition', () => {
  it('agrège les coûts, la répartition et la marge brute', () => {
    const couts = computeCoutsTerrain({
      mainOeuvreMad: 40_000,
      materielMad: 25_000,
      consommationsMad: 30_000,
      depensesMad: 5_000,
      decompteCumuleTtcMad: 150_000,
      montantMarcheMad: 400_500,
    });
    expect(couts.totalMad).toBe(100_000);
    expect(couts.margeBruteMad).toBe(50_000);
    expect(couts.repartitionPct.mainOeuvre).toBe(40);
    expect(couts.repartitionPct.depenses).toBe(5);
    expect(couts.coutSurMarchePct).toBe(24.97);
  });

  it('coût pointage: taux jour direct et salaire mensuel /26', () => {
    expect(coutPointage(1, 'jour', 150)).toBe(150);
    expect(coutPointage(0.5, 'jour', 150)).toBe(75);
    expect(coutPointage(1, 'mois', 5200)).toBe(200);
    expect(coutPointage(1, null, null)).toBe(0);
  });

  it('parseAcquisition: défauts ao_direct + plafond bon de commande', () => {
    const direct = parseAcquisition('ao_direct', {});
    expect(direct.ok).toBe(true);
    if (direct.ok) {
      expect(direct.value.modePassation).toBe('ao_ouvert');
      expect(direct.value.retenueGarantiePct).toBe(7);
    }
    const bcOk = parseAcquisition('bon_commande', { numeroBc: 'BC-12/2026', montantBcMad: 480000 });
    expect(bcOk.ok).toBe(true);
    const bcOver = parseAcquisition('bon_commande', {
      numeroBc: 'BC-13/2026',
      montantBcMad: 600000,
    });
    expect(bcOver.ok).toBe(false); // > 500 000 DH — décret 2-22-431 art. 91
  });

  it('parseAcquisition: groupement exige membres et type', () => {
    const bad = parseAcquisition('groupement', { typeGroupement: 'conjoint' });
    expect(bad.ok).toBe(false);
    const good = parseAcquisition('groupement', {
      typeGroupement: 'solidaire',
      notreRole: 'mandataire',
      membres: [{ societe: 'AGHA RM INFRA', partPct: 60 }, { societe: 'X BTP', partPct: 40 }],
    });
    expect(good.ok).toBe(true);
  });
});
