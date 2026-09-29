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
import { computeLignePartiel, computeMetreTotals, normaliseNombreElements, POIDS_ACIER } from './btp-metre.domain';
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

// « Nombre d'éléments » (nombreElements) d'une ligne de ferraillage : le nombre
// d'éléments structurels identiques répétés (8 poteaux, 6 poutres…), distinct du
// « Nombre » qui reste le nombre de barres DANS un seul élément. Défaut = 1,
// donc tout métré antérieur au champ garde exactement son résultat.
describe("métré — nombre d'éléments par ligne (acier)", () => {
  it('normaliseNombreElements : entier ≥ 1, tout le reste retombe à 1', () => {
    expect(normaliseNombreElements(undefined)).toBe(1);
    expect(normaliseNombreElements(null)).toBe(1);
    expect(normaliseNombreElements(Number.NaN)).toBe(1);
    expect(normaliseNombreElements(0)).toBe(1);
    expect(normaliseNombreElements(-8)).toBe(1);
    expect(normaliseNombreElements(1)).toBe(1);
    expect(normaliseNombreElements(8)).toBe(8);
    expect(normaliseNombreElements(20)).toBe(20);
    expect(normaliseNombreElements(2.7)).toBe(2); // décimal tronqué
    expect(normaliseNombreElements(0.9)).toBe(1);
  });

  it('nombreElements = 1 (ou absent) → calcul historique inchangé', () => {
    const legacy = computeLignePartiel('KG', { id: 'l1', nombre: 4, longueur: 3, diametre: 12 });
    expect(
      computeLignePartiel('KG', {
        id: 'l1',
        nombre: 4,
        nombreElements: 1,
        longueur: 3,
        diametre: 12,
      }),
    ).toBe(legacy);
    expect(legacy).toBeCloseTo(10.656, 10); // 4 × 3 × 0,888
    // Ancienne ligne sans partiel stocké : la formule reste la formule d'avant.
    expect(
      computeLignePartiel('KG', { id: 'l2', nombre: 10, longueur: 12, diametre: 8 }),
    ).toBeCloseTo(47.4, 10);
  });

  it('vide, 0, négatif, NaN, décimal : ramenés à 1 · champ ignoré hors acier', () => {
    const base = { nombre: 4, longueur: 3, diametre: 12 };
    const expected = 4 * 1 * 3 * 0.888;
    for (const nombreElements of [undefined, 0, -5, Number.NaN, 1, 0.5]) {
      expect(computeLignePartiel('KG', { id: 'e', ...base, nombreElements })).toBeCloseTo(
        expected,
        10,
      );
    }
    expect(computeLignePartiel('KG', { id: 'e', ...base, nombreElements: 2.9 })).toBeCloseTo(
      4 * 2 * 3 * 0.888,
      10,
    );
    // Les unités non acier n'ont pas de « Nombre d'éléments » : le champ y est ignoré.
    expect(
      computeLignePartiel('M³', {
        id: 'v1',
        longueur: 2,
        largeur: 3,
        profondeur: 0.5,
        nombreElements: 9,
      }),
    ).toBe(3);
    expect(computeLignePartiel('U', { id: 'u1', nombre: 5, nombreElements: 9 })).toBe(5);
    expect(
      computeLignePartiel('ML', {
        id: 'ml1',
        nombreSemblables: 2,
        longueur: 12.6,
        nombreElements: 9,
      }),
    ).toBeCloseTo(25.2, 10);
  });
});

// Les trois scénarios de terrain du cahier des charges : répétition d'éléments
// identiques sur du ferraillage (kg = Nombre × Nombre d'éléments × Longueur ×
// poids du Ø), plus la composition avec le facteur d'élément des sous-sections.
describe("métré — scénarios de répétition (kg d'acier)", () => {
  it('exemple utilisateur : 4 barres × 8 éléments × 3 m en Ø12 = 85,248 → 85,25', () => {
    const kg = computeLignePartiel('KG', {
      id: 'e1',
      nombre: 4,
      nombreElements: 8,
      longueur: 3,
      diametre: 12,
    });
    expect(kg).toBeCloseTo(85.248, 10);
    expect(round2(toDecimal(kg)).toNumber()).toBe(85.25);
  });

  it('poteaux : 8 barres × 10 poteaux × 3,5 m en Ø12', () => {
    expect(
      computeLignePartiel('KG', {
        id: 'p1',
        designation: 'Armatures verticales',
        nombre: 8,
        nombreElements: 10,
        longueur: 3.5,
        diametre: 12,
      }),
    ).toBeCloseTo(248.64, 10);
  });

  it('poutres : 4 barres × 6 poutres × 5 m en Ø16', () => {
    expect(
      computeLignePartiel('KG', {
        id: 'p2',
        designation: 'Armatures longitudinales',
        nombre: 4,
        nombreElements: 6,
        longueur: 5,
        diametre: 16,
      }),
    ).toBeCloseTo(189.36, 10);
  });

  it('étriers : 25 étriers × 4 kms × 2,16 m en Ø8', () => {
    expect(
      computeLignePartiel('KG', {
        id: 'p3',
        designation: 'Étriers',
        nombre: 25,
        nombreElements: 4,
        longueur: 2.16,
        diametre: 8,
      }),
    ).toBeCloseTo(85.32, 10);
  });

  it('en tonnes (T) la répétition s’applique avant la division par 1000', () => {
    const kg = computeLignePartiel('KG', {
      id: 't1',
      nombre: 4,
      nombreElements: 8,
      longueur: 3,
      diametre: 12,
    });
    expect(
      computeLignePartiel('T', {
        id: 't1',
        nombre: 4,
        nombreElements: 8,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(kg / 1000, 10);
  });

  it('nombreSemblables (kg) et nombre d’éléments se multiplient', () => {
    expect(
      computeLignePartiel('KG', {
        id: 's1',
        nombreSemblables: 2,
        nombre: 4,
        nombreElements: 8,
        longueur: 3,
        diametre: 12,
      }),
    ).toBeCloseTo(85.248 * 2, 10);
  });

  it('computeMetreTotals : le facteur de sous-section se compose avec celui de la ligne', () => {
    const totals = computeMetreTotals(
      'KG',
      [{ id: 'ss1', titre: 'Poteaux', nombreElements: 3 }],
      [
        { id: 'l1', subSectionId: 'ss1', nombre: 4, nombreElements: 8, longueur: 3, diametre: 12 },
        { id: 'l2', subSectionId: 'ss1', nombre: 10, longueur: 12, diametre: 8 },
      ],
    );
    expect(totals.lignes[0]!.partiel).toBeCloseTo(85.248 * 3, 10);
    expect(totals.lignes[1]!.partiel).toBeCloseTo(47.4 * 3, 10);
    expect(totals.totalPartiel).toBe(397.94); // round2(255,744 + 142,2)
  });

  it('computeMetreTotals : sans nombre d’éléments, total identique à l’ancien calcul', () => {
    const totals = computeMetreTotals(
      'KG',
      [{ id: 'ss2', titre: 'Semelles', nombreElements: 2 }],
      [{ id: 'l3', subSectionId: 'ss2', nombre: 10, longueur: 12, diametre: 8 }],
    );
    expect(totals.lignes[0]!.partiel).toBeCloseTo(94.8, 10); // 47,4 × 2
    expect(totals.totalPartiel).toBe(94.8);
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
