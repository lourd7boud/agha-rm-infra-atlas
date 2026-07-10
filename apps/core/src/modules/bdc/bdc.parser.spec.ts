// Fixtures réelles du portail (10/07/2026) — valeurs exactes vérifiées live.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBdcDetail, parseBdcListe, parseDateFr } from './bdc.parser';
import { computeReponse, seedLignesFromArticles } from './bdc-pricing.domain';

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
