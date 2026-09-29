import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { BordereauLigne, Metre, MetreContext } from '@/lib/btp-shared';
import { MetreEditor } from './MetreEditor';

// Rendu réel (SSR) de l'éditeur de métré : les lignes acier (KG) exposent deux
// comptages distincts — « Nombre » (barres dans UN élément) et « Nombre
// d’éléments » (éléments identiques répétés) —, les autres unités ne les
// reçoivent pas, et le partiel affiché suit la formule du moteur.

const ACIER: BordereauLigne = {
  id: 'b1',
  numero: 1,
  designation: 'Fourniture et pose des aciers',
  unite: 'KG',
  quantite: 1000,
  prixUnitaire: 12,
  montant: 12000,
};

const BETON: BordereauLigne = {
  id: 'b2',
  numero: 2,
  designation: 'Béton armé dosé à 350 kg/m³',
  unite: 'M³',
  quantite: 40,
  prixUnitaire: 900,
  montant: 36000,
};

function metre(
  lignes: Metre['lignes'],
  { bordereauLigneId = 'b1', unite = 'KG' }: { bordereauLigneId?: string; unite?: string } = {},
): Metre {
  return {
    id: `m-${bordereauLigneId}`,
    projectId: 'p1',
    periodeId: 'per1',
    bordereauLigneId,
    designationBordereau: null,
    unite,
    sections: [],
    sousSections: [],
    lignes,
    totalPartiel: 0,
    totalCumule: 0,
    quantiteBordereau: 0,
    pourcentageRealisation: 0,
  };
}

function context(lignes: BordereauLigne[], metres: Metre[] = []): MetreContext {
  return {
    periode: {
      id: 'per1',
      projectId: 'p1',
      numero: 1,
      libelle: null,
      dateDebut: '2026-01-01',
      dateFin: '2026-01-31',
      tauxTva: 20,
      tauxRetenue: 7,
      isDecompteDernier: false,
      statut: 'en_cours',
      observations: null,
    },
    bordereau: { projectId: 'p1', lignes },
    metres,
    previousByLigne: {},
  };
}

function render(contextValue: MetreContext) {
  return renderToStaticMarkup(
    createElement(MetreEditor, {
      projectId: 'p1',
      periodeId: 'per1',
      context: contextValue,
      action: vi.fn(),
    }),
  );
}

/** React insère des séparateurs <!-- --> entre nœuds texte en SSR. */
function plain(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

describe('MetreEditor — ferraillage (KG) : deux comptages distincts', () => {
  const LIGNE_ACIER: Metre['lignes'] = [
    { id: 'l0', designation: 'Armatures', nombre: 4, longueur: 3, diametre: 12 },
  ];

  test('affiche les colonnes Nombre et Nombre d’éléments avec leurs infobulles', () => {
    const html = render(context([ACIER], [metre(LIGNE_ACIER)]));
    expect(html).toContain('Nombre d’éléments');
    expect(html).toContain('Longueur (ml)');
    expect(html).toContain('Ø (mm)');
    expect(html).toContain('barres ou de pièces de ferraillage dans UN seul élément');
    expect(html).toContain('éléments structurels identiques répétés');
    // Saisie entière uniquement (clavier numérique mobile) et défaut à 1.
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('placeholder="1"');
    expect(html).toContain('Nombre × Nombre d’éléments × Longueur × poids du Ø');
  });

  test('les unités non acier gardent leurs colonnes historiques', () => {
    const html = render(
      context(
        [ACIER, BETON],
        [
          metre(LIGNE_ACIER),
          metre([{ id: 'b2-l1', designation: 'Béton', longueur: 2, largeur: 3, profondeur: 0.5 }], {
            bordereauLigneId: 'b2',
            unite: 'M³',
          }),
        ],
      ),
    );
    expect(html).toContain('Nb semblables');
    expect(html).toContain('Profondeur');
    // Un seul champ intitulé « Nombre d’éléments » (celui de l'acier) : la table
    // béton (M³) ne reçoit que ses colonnes de volume.
    expect(html.match(/placeholder="1"/g)?.length).toBe(1);
  });
});

describe('MetreEditor — partiel acier calculé et répétition visible', () => {
  test('partiel et répétition affichés pour une mesure acier enregistrée', () => {
    const html = plain(
      render(
        context(
          [ACIER],
          [
            metre([
              {
                id: 'l1',
                designation: 'Armatures verticales',
                nombre: 4,
                nombreElements: 8,
                longueur: 3,
                diametre: 12,
                partiel: 85.25,
              },
            ]),
          ],
        ),
      ),
    );
    expect(html).toContain('Armatures verticales');
    expect(html).toContain('85,25'); // round2(4 × 8 × 3 × 0,888)
    expect(html).toContain('× 8 élément(s)'); // indicateur de répétition
    expect(html).toContain('4 barres × 8 élément(s) × 3 m × 0,888 kg/m = 85,25 kg');
    expect(render(context([ACIER], [
      metre([
        {
          id: 'l1',
          designation: 'Armatures verticales',
          nombre: 4,
          nombreElements: 8,
          longueur: 3,
          diametre: 12,
        },
      ]),
    ]))).toContain('value="8"'); // valeur bien réinjectée dans le formulaire
  });

  test('mesure antérieure au champ : partiel historique, aucun facteur de répétition', () => {
    const html = plain(
      render(
        context(
          [ACIER],
          [
            metre([
              {
                id: 'l2',
                designation: 'Aciers HA',
                nombre: 10,
                longueur: 12,
                diametre: 8,
                partiel: 47.4,
              },
            ]),
          ],
        ),
      ),
    );
    expect(html).toContain('47,40'); // 10 × 12 × 0,395 inchangé
    expect(html).toContain('10 barres × 1 élément(s) × 12 m × 0,395 kg/m = 47,40 kg');
    // Répétition = 1 : aucun badge, la quantité reste celle du calcul historique.
    expect(html).not.toContain('rounded-full bg-emerald-soft');
  });

  test('sous-section × ligne : les deux répétitions se multiplient (avertissement)', () => {
    const avecSousSection = metre([
      {
        id: 'l3',
        subSectionId: 'ss1',
        designation: 'Cadres',
        nombre: 25,
        nombreElements: 4,
        longueur: 2.16,
        diametre: 8,
      },
    ]);
    // La mesure doit vivre dans un lieu (section) pour que son élément s'affiche.
    avecSousSection.sections = [{ id: 'sec1', titre: 'Douar' }];
    avecSousSection.sousSections = [
      { id: 'ss1', sectionId: 'sec1', titre: 'Poutres', nombreElements: 3 },
    ];
    const html = plain(render(context([ACIER], [avecSousSection])));
    expect(html).toContain('× 4 × 3 élément(s)'); // badge : ligne × élément
    expect(html).toContain('les deux facteurs se multiplient');
    // 25 × 4 × 3 × 2,16 × 0,395 = 255,96 kg
    expect(html).toContain('25 barres × 12 élément(s) × 2,16 m × 0,395 kg/m = 255,96 kg');
  });
});

describe('MetreEditor — les autres unités ne bougent pas', () => {
  test('un métré M³ conserve sa formule et son total sans champ de répétition acier', () => {
    const html = plain(
      render(
        context(
          [BETON],
          [
            metre(
              [
                {
                  id: 'v1',
                  designation: 'Béton radier',
                  nombreSemblables: 2,
                  longueur: 2,
                  largeur: 3,
                  profondeur: 0.5,
                },
              ],
              { bordereauLigneId: 'b2', unite: 'M³' },
            ),
          ],
        ),
      ),
    );
    expect(html).toContain('Nb semblables');
    expect(html).toContain('Profondeur');
    expect(html).not.toContain('Nombre d’éléments');
    expect(html).not.toContain('Nombre × Nombre d’éléments');
    expect(html).toContain('6,00'); // 2 × 2 × 3 × 0,5 : total de la période
  });
});

