import { describe, expect, it } from 'vitest';
import { AGHA_RADAR_PROFILE, scoreTender, type RadarTenderInput } from './radar-scoring.domain';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const inDays = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

const base: RadarTenderInput = {
  category: 'Travaux',
  region: 'Drâa-Tafilalet',
  ville: 'Errachidia',
  location: 'Commune de Boudnib',
  deadlineAt: inDays(20),
  estimationMad: 800_000,
  createdAt: daysAgo(1),
};

describe('scoreTender — moteur radar', () => {
  it('opportunité locale idéale = score très élevé + raisons positives', () => {
    const r = scoreTender(AGHA_RADAR_PROFILE, base, NOW);
    expect(r.expire).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.breakdown.categorie).toBe(1);
    expect(r.breakdown.proximite).toBe(1); // Boudnib dans location
    expect(r.breakdown.delai).toBe(1); // 20 j
    expect(r.breakdown.taille).toBe(1); // 800k dans la fourchette
    expect(r.reasons[0]).toContain('Cœur de métier');
    // Pas de dimension concurrence sans intel acheteur.
    expect(r.breakdown.concurrence).toBeUndefined();
  });

  it('Services lointain de grande taille = score faible + drapeaux', () => {
    const r = scoreTender(
      AGHA_RADAR_PROFILE,
      {
        ...base,
        category: 'Services',
        region: 'Dakhla-Oued Ed-Dahab',
        ville: 'Dakhla',
        location: 'Dakhla',
        estimationMad: 25_000_000,
      },
      NOW,
    );
    // Fit médiocre (métier + géo + taille) domine → moitié du score de l'idéal
    // local; le bon délai/fraîcheur l'empêche de toucher le fond.
    expect(r.score).toBeLessThan(50);
    expect(r.breakdown.categorie).toBe(0.3);
    expect(r.breakdown.proximite).toBe(0.25);
    expect(r.breakdown.taille).toBe(0.2);
    expect(r.reasons.some((x) => x.includes('faible'))).toBe(true);
  });

  it('date limite dépassée = score 0 et flag expire', () => {
    const r = scoreTender(AGHA_RADAR_PROFILE, { ...base, deadlineAt: daysAgo(1) }, NOW);
    expect(r.expire).toBe(true);
    expect(r.score).toBe(0);
    expect(r.reasons[0]).toContain('Date limite dépassée');
  });

  it('proximité: home region (sans ville) > limitrophe > lointaine > inconnue', () => {
    const reg = (region: string | null, ville: string | null) =>
      scoreTender(AGHA_RADAR_PROFILE, { ...base, region, ville, location: null }, NOW).breakdown
        .proximite;
    expect(reg('Drâa-Tafilalet', 'Tinghir')).toBe(0.9); // home region, ville hors mots-clés
    expect(reg('Souss-Massa', 'Agadir')).toBe(0.55); // limitrophe
    expect(reg('Dakhla-Oued Ed-Dahab', 'Dakhla')).toBe(0.25); // lointaine
    expect(reg(null, null)).toBe(0.4); // inconnue = neutre
  });

  it('délai: rampe 0.2→0.6→1→0.75', () => {
    const d = (n: number) =>
      scoreTender(AGHA_RADAR_PROFILE, { ...base, deadlineAt: inDays(n) }, NOW).breakdown.delai;
    expect(d(2)).toBe(0.2); // < 3 j (trop juste)
    expect(d(5)).toBe(0.6); // 3–7 j
    expect(d(20)).toBe(1); // 7–45 j (idéal)
    expect(d(60)).toBe(0.75); // très loin
  });

  it('concurrence: présente uniquement avec intel, renormalise le total', () => {
    const withIntel = scoreTender(
      AGHA_RADAR_PROFILE,
      { ...base, buyerIntel: { nbDevisMoyen: 3, tauxInfructueux: 0 } },
      NOW,
    );
    expect(withIntel.breakdown.concurrence).toBe(1); // 3 devis = concurrence faible = bon
    // Un acheteur très concurrentiel tire le signal vers le bas.
    const crowded = scoreTender(
      AGHA_RADAR_PROFILE,
      { ...base, buyerIntel: { nbDevisMoyen: 20, tauxInfructueux: 0 } },
      NOW,
    );
    expect(crowded.breakdown.concurrence!).toBeLessThan(0.4);
    expect(crowded.score).toBeLessThan(withIntel.score);
  });

  it('catégorie inconnue = neutre 0.4', () => {
    const r = scoreTender(AGHA_RADAR_PROFILE, { ...base, category: null }, NOW);
    expect(r.breakdown.categorie).toBe(0.4);
  });
});
