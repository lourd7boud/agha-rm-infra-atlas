import { describe, expect, test } from 'vitest';
import { buildBpuProposal, type BpuLineInput } from './bpu-pricing.domain';

const LINES: BpuLineInput[] = [
  { designation: 'Béton B25 pour ouvrages', quantite: 100, unite: 'm3' },
  { designation: 'Acier HA pour armatures', quantite: 5000, unite: 'kg' },
  { designation: 'Installation de chantier', quantite: 1, unite: 'forfait' },
];

describe('buildBpuProposal', () => {
  test('scales LLM prices so the total lands on estimation × (1 − rabais)', () => {
    const proposal = buildBpuProposal(LINES, [1200, 14, 80_000], {
      estimationMad: 1_000_000,
      rabaisPct: 10,
    });
    expect(proposal.methode).toBe('calibre_estimation');
    expect(proposal.targetTotalMad).toBe(900_000);
    // Total must land on the target to the dirham.
    expect(Math.abs(proposal.totalMad - 900_000)).toBeLessThanOrEqual(1);
    // Relative structure preserved: béton line ≈ 1200/14 ratio vs acier.
    const beton = proposal.lines[0]!;
    const acier = proposal.lines[1]!;
    expect(beton.prixUnitaireMad / acier.prixUnitaireMad).toBeCloseTo(1200 / 14, 1);
    // Every montant = prix × quantité.
    for (const line of proposal.lines) {
      expect(line.montantMad).toBeCloseTo(line.prixUnitaireMad * line.quantite, 2);
    }
  });

  test('keeps LLM prices unscaled when no estimation exists, with a warning', () => {
    const proposal = buildBpuProposal(LINES, [1200, 14, 80_000], {});
    expect(proposal.methode).toBe('prix_ia_non_calibres');
    expect(proposal.targetTotalMad).toBeNull();
    expect(proposal.lines[0]!.prixUnitaireMad).toBe(1200);
    expect(proposal.avertissements.some((w) => w.includes('non calibrés'))).toBe(true);
  });

  test('fills missing line prices with the median and warns', () => {
    const proposal = buildBpuProposal(LINES, [1200, null, 80_000], {});
    // median of [1200, 80000] = 40600
    expect(proposal.lines[1]!.prixUnitaireMad).toBe(40_600);
    expect(proposal.avertissements.some((w) => w.includes('1 ligne'))).toBe(true);
  });

  test('falls back to uniform distribution when no LLM price is usable', () => {
    const proposal = buildBpuProposal(LINES, [null, null, null], {
      estimationMad: 510_100,
      rabaisPct: 0,
    });
    expect(proposal.methode).toBe('repartition_uniforme');
    // 510100 / 5101 unités = 100 MAD/unité partout.
    expect(proposal.lines[0]!.prixUnitaireMad).toBeCloseTo(100, 0);
    expect(Math.abs(proposal.totalMad - 510_100)).toBeLessThanOrEqual(1);
  });

  test('treats missing quantities as forfait (1)', () => {
    const proposal = buildBpuProposal(
      [{ designation: 'Étude géotechnique' }],
      [50_000],
      { estimationMad: 100_000, rabaisPct: 0 },
    );
    expect(proposal.lines[0]!.quantite).toBe(1);
    expect(proposal.totalMad).toBe(100_000);
  });

  test('throws on an empty BPU', () => {
    expect(() => buildBpuProposal([], [], {})).toThrow('BPU vide');
  });

  test('throws when there is neither estimation nor any usable price', () => {
    expect(() => buildBpuProposal(LINES, [null, null, null], {})).toThrow(
      'Aucune base de prix',
    );
  });

  test('rabais reduces the target below the estimation', () => {
    const withRabais = buildBpuProposal(LINES, [1000, 10, 50_000], {
      estimationMad: 2_000_000,
      rabaisPct: 15,
    });
    expect(withRabais.targetTotalMad).toBe(1_700_000);
    expect(withRabais.rabaisPct).toBe(15);
  });
});
