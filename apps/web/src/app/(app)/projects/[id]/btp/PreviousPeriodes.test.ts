import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { MetrePreviousPeriode } from '@/lib/metre-details';
import { PreviousPeriodeTable, PreviousPeriodes } from './PreviousPeriodes';

// Rendu réel (SSR) du résumé repliable et du tableau de détails : le résumé
// actuel reste visible, les détails sont masqués par défaut et strictement en
// lecture seule.

/** React insère des séparateurs <!-- --> entre nœuds texte en SSR. */
function plain(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

const P1: MetrePreviousPeriode = {
  periodeNumero: 1,
  totalPartiel: 122.26,
  lignes: [
    {
      id: 'l1',
      designation: 'FDOX BASSIN',
      nombreSemblables: 1,
      longueur: 12.6,
      largeur: 12.6,
      profondeur: 0.6,
      partiel: 95.26,
    },
    {
      id: 'l2',
      designation: 'FDOX CONDUITE',
      nombreSemblables: 1,
      longueur: 600,
      largeur: 0.4,
      profondeur: 0.4,
      partiel: 96,
    },
  ],
};

describe('PreviousPeriodes — résumé replié', () => {
  test('conserve le résumé actuel (période, nb de mesures, partiel) et masque les détails', () => {
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodes, { unite: 'M³', previous: [P1] }),
    );
    const text = plain(html);
    expect(text).toContain('Périodes précédentes (lecture seule)');
    expect(text).toContain('P1');
    expect(text).toContain('2 mesure(s)');
    expect(text).toContain('partiel 122,26');
    expect(text).toContain('Afficher les détails');
    expect(text).not.toContain('Masquer les détails');
    expect(html).not.toContain('<table');
    expect(text).not.toContain('FDOX BASSIN');
  });

  test('une commande de dépliage par période garnie, aucune pour une période vide', () => {
    const previous: MetrePreviousPeriode[] = [
      P1,
      { periodeNumero: 2, totalPartiel: 0, lignes: [] },
    ];
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodes, { unite: 'M³', previous }),
    );
    const text = plain(html);
    expect(text.match(/Afficher les détails/g)?.length).toBe(1);
    expect(text).toContain('P1');
    expect(text).toContain('P2');
    expect(text).toContain('0 mesure(s)');
    expect(text).toContain('partiel 0,00');
  });

  test('ne rend rien sans période précédente (pas de section détails)', () => {
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodes, { unite: 'M³', previous: [] }),
    );
    expect(html).toBe('');
  });

  test('signale l’absence de mesures détaillées sans masquer le résumé', () => {
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodes, {
        unite: 'M³',
        previous: [{ periodeNumero: 3, totalPartiel: 0, lignes: [] }],
      }),
    );
    const text = plain(html);
    expect(text).toContain('P3');
    expect(text).toContain('Aucune mesure détaillée enregistrée pour ces périodes.');
    expect(html).not.toContain('<table');
  });
});

describe('PreviousPeriodeTable — lecture seule', () => {
  test('affiche toutes les mesures enregistrées, jamais un total agrégé en un seul bloc', () => {
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodeTable, { unite: 'M³', periode: P1 }),
    );
    const text = plain(html);
    expect(text).toContain('FDOX BASSIN');
    expect(text).toContain('FDOX CONDUITE');
    expect(text).toContain('12,6');
    expect(text).toContain('600');
    expect(text).toContain('95,26');
    expect(text).toContain('96,00');
    expect(html.match(/<tr/g)?.length).toBe(3); // en-tête + 2 mesures
  });

  test('n’expose aucun champ éditable (ni input, ni select, ni formulaire)', () => {
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodeTable, { unite: 'M³', periode: P1 }),
    );
    expect(html).not.toMatch(/<(input|select|textarea|form)\b/);
  });

  test('tolère les données manquantes (« — ») et les désignations longues', () => {
    const designationLongue =
      "Fourniture et pose de canalisation en béton armé Ø 400 mm y compris toutes sujétions de raccordement";
    const periode: MetrePreviousPeriode = {
      periodeNumero: 2,
      totalPartiel: 0,
      lignes: [{ id: 'l3', designation: designationLongue }, { id: 'l4' }],
    };
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodeTable, { unite: 'U', periode }),
    );
    const text = plain(html);
    expect(text).toContain(designationLongue);
    expect(text.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test('colonnes dépendantes de l’unité (poids : Nombre / Nombre d’éléments / Longueur / Ø)', () => {
    const periode: MetrePreviousPeriode = {
      periodeNumero: 1,
      totalPartiel: 53.28,
      lignes: [
        { id: 'a1', designation: 'Acier HA', nombre: 10, longueur: 6, diametre: 12, partiel: 53.28 },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodeTable, { unite: 'KG', periode }),
    );
    const text = plain(html);
    expect(text).toContain('Nombre');
    expect(text).toContain('Nombre d’éléments');
    expect(text).toContain('Longueur (ml)');
    expect(text).toContain('Ø (mm)');
    expect(text).not.toContain('Profondeur');
    expect(text).toContain('53,28');
    expect(text).toContain('Partiel'); // en-tête et libellés inchangés
  });

  test('mesure acier répétée : colonnes Nombre et Nombre d’éléments affichées séparément', () => {
    const periode: MetrePreviousPeriode = {
      periodeNumero: 1,
      totalPartiel: 255.74,
      lignes: [
        {
          id: 'a2',
          designation: 'Armatures verticales',
          nombre: 4,
          nombreElements: 8,
          longueur: 3,
          diametre: 12,
          partiel: 85.25,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodeTable, { unite: 'KG', periode }),
    );
    const text = plain(html);
    expect(text).toContain('Armatures verticales');
    expect(text).toContain('85,25'); // partiel enregistré, jamais recalculé ici
    expect(text).toContain('>4<'); // Nombre = 4 barres dans l'élément
    expect(text).toContain('>8<'); // Nombre d'éléments = 8 exemplaires
    expect(html).not.toMatch(/<(input|select|textarea)\b/);
  });

  test('mesure acier antérieure au champ : « Nombre d’éléments » affiché à 1', () => {
    const periode: MetrePreviousPeriode = {
      periodeNumero: 1,
      totalPartiel: 53.28,
      lignes: [
        {
          id: 'a3',
          designation: 'Acier HA',
          nombre: 10,
          longueur: 6,
          diametre: 12,
          partiel: 53.28,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(PreviousPeriodeTable, { unite: 'KG', periode }),
    );
    expect(plain(html)).toContain('>1<'); // défaut moteur, aucune donnée réinterprétée
  });
});
