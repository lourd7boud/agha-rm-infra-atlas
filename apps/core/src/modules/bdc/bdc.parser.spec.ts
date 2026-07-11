// Fixtures réelles du portail (10/07/2026) — valeurs exactes vérifiées live.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseBdcDetail,
  parseBdcListe,
  parseBdcResultats,
  parseDateFr,
  parseMontantMad,
} from './bdc.parser';
import {
  appliquerPropositions,
  computeReponse,
  proposerPrixPourLignes,
  scoreDesignations,
  seedLignesFromArticles,
  tokenize,
  type PriceCandidate,
} from './bdc-pricing.domain';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseBdcListe', () => {
  const liste = parseBdcListe(fixture('bdc-liste.html'));

  it('lit le total et les cartes', () => {
    expect(liste.total).toBe(1478);
    expect(liste.items.length).toBeGreaterThanOrEqual(6);
  });

  it('parse la première carte (référence, statut badge, acheteur, échéance, lieu)', () => {
    const first = liste.items[0]!;
    expect(first.portalId).toBe(316430);
    expect(first.reference).toBe('6/2026');
    expect(first.statut).toBe('annule');
    expect(first.acheteur).toBe('Commune IZEMMOUREN');
    expect(first.objet).toContain('ABRIS');
    expect(first.lieu).toBe('AL HOCEIMA');
    expect(first.dateLimite?.toISOString()).toBe('2027-03-16T13:00:00.000Z'); // 14:00 UTC+1
  });

  it('les cartes sans badge sont en_cours', () => {
    expect(liste.items.some((i) => i.statut === 'en_cours')).toBe(true);
  });
});

describe('parseBdcDetail', () => {
  const detail = parseBdcDetail(fixture('bdc-detail.html'));

  it('parse la fiche', () => {
    expect(detail.reference).toBe('CONS33/2026');
    expect(detail.acheteur).toBe('CAISSE NATIONALE DE SECURITE SOCIALE');
    expect(detail.categorie).toBe('Fournitures');
    expect(detail.dateLimite?.toISOString()).toBe('2026-07-22T09:00:00.000Z'); // 10:00 UTC+1
    expect(detail.datePublication?.toISOString()).toBe('2026-07-08T14:17:00.000Z');
  });

  it('parse les pièces jointes', () => {
    expect(detail.pieces).toHaveLength(1);
    expect(detail.pieces[0]!.downloadPath).toBe(
      '/bdc/entreprise/consultation/download/362084/50552993',
    );
  });

  it('parse les articles structurés (unité, quantité, TVA)', () => {
    expect(detail.articles).toHaveLength(1);
    const article = detail.articles[0]!;
    expect(article.numero).toBe(1);
    expect(article.unite).toBe('U');
    expect(article.quantite).toBe(150);
    expect(article.tvaPct).toBe(20);
    expect(article.caracteristiques.split('\n').length).toBeGreaterThanOrEqual(4);
  });
});

describe('parseBdcResultats (intelligence concurrents)', () => {
  const resultats = parseBdcResultats(fixture('bdc-resultats.html'));

  it('lit le total du gisement et les cartes', () => {
    expect(resultats.total).toBe(303733);
    expect(resultats.items.length).toBe(10);
  });

  it('parse un résultat ATTRIBUÉ (gagnant + montant + concurrence)', () => {
    const simac = resultats.items.find((r) => r.attributaire === 'SIMAC')!;
    expect(simac.reference).toBe('008/2026CRIMA');
    expect(simac.acheteur).toBe('Commune rurale de RIMA');
    expect(simac.issue).toBe('attribue');
    expect(simac.nbDevis).toBe(16);
    expect(simac.montantTtc).toBe(9930);
    expect(simac.dateResultat?.toISOString()).toBe('2026-07-10T22:28:00.000Z'); // 23:28 UTC+1
  });

  it('parse un résultat INFRUCTUEUX (pas de gagnant, concurrence connue)', () => {
    const infructueux = resultats.items.find((r) => r.reference === '7/6/FNC/2026')!;
    expect(infructueux.issue).toBe('infructueux');
    expect(infructueux.attributaire).toBeNull();
    expect(infructueux.montantTtc).toBeNull();
    expect(infructueux.nbDevis).toBe(12);
  });
});

describe('parseMontantMad', () => {
  it('gère espaces/NBSP milliers et virgule décimale', () => {
    expect(parseMontantMad('9 930,00 MAD')).toBe(9930);
    expect(parseMontantMad(`1${String.fromCharCode(0x00a0)}234${String.fromCharCode(0x202f)}567,89`)).toBe(1234567.89);
    expect(parseMontantMad('n/a')).toBeNull();
    expect(parseMontantMad(null)).toBeNull();
  });
});

describe('parseDateFr', () => {
  it('gère date seule et date+heure (heure marocaine UTC+1)', () => {
    expect(parseDateFr('01/02/2026')?.toISOString()).toBe('2026-01-31T23:00:00.000Z');
    expect(parseDateFr('01/02/2026 12:30')?.toISOString()).toBe('2026-02-01T11:30:00.000Z');
    expect(parseDateFr('bad')).toBeNull();
  });
});

describe('computeReponse (moteur de chiffrage)', () => {
  it('calcule HT/TVA/TTC avec marge sur coûts', () => {
    const totaux = computeReponse(
      [
        {
          idx: 0,
          designation: 'Drapeau',
          unite: 'U',
          quantite: 150,
          tvaPct: 20,
          prixUnitaireHt: 100,
          source: 'catalogue',
          margeAppliquee: true,
        },
      ],
      20,
    );
    // 100 × 1.2 = 120 PV, × 150 = 18000 HT, TVA 3600, TTC 21600
    expect(totaux.lignes[0]!.prixVenteHt).toBe(120);
    expect(totaux.totalHt).toBe(18000);
    expect(totaux.totalTva).toBe(3600);
    expect(totaux.totalTtc).toBe(21600);
    expect(totaux.lignesNonChiffrees).toBe(0);
  });

  it('prix ferme (sans marge) + compte les lignes non chiffrées', () => {
    const totaux = computeReponse(
      [
        { idx: 0, designation: 'A', unite: 'U', quantite: 2, tvaPct: 20, prixUnitaireHt: 50, source: 'manuel', margeAppliquee: false },
        { idx: 1, designation: 'B', unite: 'U', quantite: 5, tvaPct: 20, prixUnitaireHt: 0, source: 'manuel' },
      ],
      30,
    );
    expect(totaux.lignes[0]!.prixVenteHt).toBe(50);
    expect(totaux.totalHt).toBe(100);
    expect(totaux.lignesNonChiffrees).toBe(1);
  });

  it('seedLignesFromArticles amorce à 0 avec TVA reprise', () => {
    const lignes = seedLignesFromArticles([
      { designation: 'X', unite: 'm²', quantite: 12, tvaPct: 20 },
      { designation: 'Y', unite: null, quantite: null, tvaPct: null },
    ]);
    expect(lignes[0]!.prixUnitaireHt).toBe(0);
    expect(lignes[0]!.quantite).toBe(12);
    expect(lignes[1]!.quantite).toBe(1);
    expect(lignes[1]!.tvaPct).toBe(20);
  });
});

describe('proposition automatique de prix (matching)', () => {
  it('tokenize: accents, stopwords BTP, frontières lettre/chiffre, pluriels', () => {
    expect(tokenize('Fourniture de Béton armé C25/30 en fondation')).toEqual([
      'beton', 'arme', '25', '30', 'fondation',
    ]);
    // CPJ45 ≡ CPJ 45, 50kg ≡ 50 kg, sacs ≡ sac — variations réelles du BTP.
    expect(tokenize('Ciment CPJ45 sacs 50kg')).toEqual(tokenize('ciment cpj 45 sac 50 kg'));
    expect(tokenize('   ')).toEqual([]);
  });

  it('scoreDesignations: 0 sans intersection, ~1 identique', () => {
    expect(scoreDesignations(tokenize('ciment cpj45'), tokenize('sable de mer'))).toBe(0);
    const same = scoreDesignations(tokenize('ciment cpj45 sac 50kg'), tokenize('Ciment CPJ45 sac 50 kg'));
    expect(same).toBeGreaterThan(0.85);
  });

  it('proposer: choisit le bon candidat, respecte le seuil, marque la provenance', () => {
    const lignes = seedLignesFromArticles([
      { designation: 'Ciment CPJ 45 en sacs de 50 kg', unite: 'SAC', quantite: 100, tvaPct: 20 },
      { designation: 'Objet introuvable zzz', unite: 'U', quantite: 1, tvaPct: 20 },
    ]);
    const candidates: PriceCandidate[] = [
      { designation: 'Sable de concassage 0/5', prixHt: 120, source: 'catalogue', sourceRef: 'LF Sable' },
      { designation: 'Ciment CPJ45 — sac 50kg', unite: 'sac', prixHt: 68, source: 'catalogue', sourceRef: 'LF Ciment' },
      { designation: 'Ciment colle', prixHt: 90, source: 'historique', sourceRef: 'BPU 54/2025' },
    ];
    const proposals = proposerPrixPourLignes(
      lignes,
      [
        { designation: 'Ciment CPJ 45 en sacs de 50 kg', unite: 'SAC' },
        { designation: 'Objet introuvable zzz', unite: 'U' },
      ],
      candidates,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.idx).toBe(0);
    expect(proposals[0]!.prixUnitaireHt).toBe(68);
    expect(proposals[0]!.source).toBe('catalogue');
    expect(proposals[0]!.margeAppliquee).toBe(true); // coût fournisseur → marge
    expect(proposals[0]!.score).toBeGreaterThanOrEqual(0.42);
  });

  it('appliquer: ne touche jamais un prix déjà saisi', () => {
    const lignes = [
      { idx: 0, designation: 'A', quantite: 1, tvaPct: 20, prixUnitaireHt: 55, source: 'manuel' as const },
      { idx: 1, designation: 'B', quantite: 1, tvaPct: 20, prixUnitaireHt: 0, source: 'manuel' as const },
    ];
    const next = appliquerPropositions(lignes, [
      { idx: 0, prixUnitaireHt: 99, source: 'historique', sourceRef: 'X', margeAppliquee: false, score: 0.9 },
      { idx: 1, prixUnitaireHt: 42, source: 'historique', sourceRef: 'BPU 07/2026', margeAppliquee: false, score: 0.8 },
    ]);
    expect(next[0]!.prixUnitaireHt).toBe(55); // intouché
    expect(next[1]!.prixUnitaireHt).toBe(42);
    expect(next[1]!.sourceRef).toBe('BPU 07/2026');
    expect(lignes[1]!.prixUnitaireHt).toBe(0); // immutabilité
  });
});
