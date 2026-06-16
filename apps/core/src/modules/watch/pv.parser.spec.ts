import { describe, expect, it } from 'vitest';
import { parseExtraitPvJson } from './pv.parser';

const PV_JSON = JSON.stringify({
  acheteur: 'ORMVA du Souss Massa',
  objet: "travaux d'irrigation",
  estimation_mad: 1_000_000,
  soumissionnaires: [
    { nom: 'STE ALPHA', montant_mad: 820000, retenu: true },
    { nom: 'STE BETA', montant_mad: '910 000,50', retenu: false },
    { nom: 'STE GAMMA', montant_mad: null, retenu: false },
  ],
  lisible: true,
});

describe('parseExtraitPvJson', () => {
  it('parses the buyer, objet, estimation and every bidder', () => {
    const pv = parseExtraitPvJson(`some preamble ${PV_JSON} trailing`);
    expect(pv).not.toBeNull();
    expect(pv?.acheteur).toBe('ORMVA du Souss Massa');
    expect(pv?.estimationMad).toBe(1_000_000);
    expect(pv?.soumissionnaires).toHaveLength(3);
  });

  it('flags the retained bidder as the winner', () => {
    const pv = parseExtraitPvJson(PV_JSON);
    const winner = pv?.soumissionnaires.find((s) => s.isWinner);
    expect(winner?.name).toBe('STE ALPHA');
    expect(winner?.montantMad).toBe(820_000);
    expect(pv?.soumissionnaires.filter((s) => s.isWinner)).toHaveLength(1);
  });

  it('reads the Moroccan decimal comma on a string montant', () => {
    const pv = parseExtraitPvJson(PV_JSON);
    const beta = pv?.soumissionnaires.find((s) => s.name === 'STE BETA');
    expect(beta?.montantMad).toBe(910_000.5);
  });

  it('keeps a bidder with an unreadable montant (null) rather than dropping it', () => {
    const pv = parseExtraitPvJson(PV_JSON);
    const gamma = pv?.soumissionnaires.find((s) => s.name === 'STE GAMMA');
    expect(gamma).toBeDefined();
    expect(gamma?.montantMad).toBeNull();
  });

  it('skips entries without a company name', () => {
    const json = JSON.stringify({
      soumissionnaires: [
        { nom: '', montant_mad: 100 },
        { montant_mad: 200 },
        { nom: 'STE REELLE', montant_mad: 300, retenu: true },
      ],
      lisible: true,
    });
    const pv = parseExtraitPvJson(json);
    expect(pv?.soumissionnaires).toHaveLength(1);
    expect(pv?.soumissionnaires[0]?.name).toBe('STE REELLE');
  });

  it('keeps a single winner when the PV mis-flags two as retenu', () => {
    const json = JSON.stringify({
      soumissionnaires: [
        { nom: 'STE A', montant_mad: 900000, retenu: true },
        { nom: 'STE B', montant_mad: 800000, retenu: true }, // lower → real winner
        { nom: 'STE C', montant_mad: 1000000, retenu: false },
      ],
      lisible: true,
    });
    const pv = parseExtraitPvJson(json);
    const winners = pv?.soumissionnaires.filter((s) => s.isWinner);
    expect(winners).toHaveLength(1);
    expect(winners?.[0]?.name).toBe('STE B');
  });

  it('returns null on non-JSON and respects lisible=false', () => {
    expect(parseExtraitPvJson('illisible, aucune donnée')).toBeNull();
    const blurry = parseExtraitPvJson(
      JSON.stringify({ soumissionnaires: [], lisible: false }),
    );
    expect(blurry?.lisible).toBe(false);
  });
});
