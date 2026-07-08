/**
 * Marketplace catalogue — a faithful mirror of the lesfournisseurs.ma marketplace
 * (https://lesfournisseurs.ma/trade/browse), baked from its public catalog API
 * (api.lesfournisseurs.ma/public/catalog) into a static, offline-first module.
 *
 * Hierarchy: Catégorie -> Produit -> Variante. A variante is the purchasable leaf
 * (name, unit/measure, image, indicative price in MAD, and supplier offers). All
 * images are bundled locally under apps/web/public/lf/uploads — never external —
 * so they load instantly and never rot.
 *
 * This REPLACES the flat materials-catalog on /stock. When a worker adds a
 * variante to stock, its code/designation/unit/price feed the existing stock
 * quick-add (a purchase movement in @atlas/core), price prefilled + editable.
 *
 * Generated — do not edit by hand.
 */

export interface CatalogSupplierOffer {
  supplierName: string;
  supplierLogo: string | null;
  price: number | null;
  currencyCode: string;
  minOrderQuantity: number;
  quantityInStock: number;
}

export interface CatalogVariante {
  /** Source item UUID. */
  id: string;
  /** Stable stock code (idempotent natural key for the stock upsert). */
  code: string;
  name: string;
  description: string;
  /** Unit of measure code (M3, KG, M2, ML, PIECE, SAC, U…). */
  unit: string;
  /** Human measure label ("Mètre cube") when known. */
  measureName: string | null;
  /** Local /lf/uploads image path (null → falls back to product/category art). */
  image: string | null;
  /** Indicative unit price in MAD (null when unpriced); worker can override. */
  price: number | null;
  currencyCode: string;
  /** Marketplace stock signal (EN_STOCK | RUPTURE_DE_STOCK | null). */
  stockStatus: string | null;
  /** Competing supplier offers, cheapest first. */
  offers: CatalogSupplierOffer[];
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  image: string | null;
  /** Cheapest variante price in MAD, or null. */
  minPrice: number | null;
  currencyCode: string;
  variantes: CatalogVariante[];
}

export type CategoryAccent = 'ochre' | 'clay' | 'teal' | 'cyan' | 'emerald';

export interface CatalogCategory {
  id: string;
  name: string;
  position: number;
  image: string | null;
  accent: CategoryAccent;
  productCount: number;
  varianteCount: number;
  products: CatalogProduct[];
}

export const MARKETPLACE_CATALOG: readonly CatalogCategory[] =
[
  {
    "id": "d2635c22-867b-4e6a-a091-3ecdb7913a66",
    "name": "Structure",
    "position": 1,
    "image": "/lf/uploads/categories/gemini-generated-image-structure-beton-arme/gemini-generated-image-structure-beton-arme-1778154592300.jpg",
    "accent": "ochre",
    "productCount": 5,
    "varianteCount": 6,
    "products": [
      {
        "id": "efb70cea-300a-40ba-87be-97876f905567",
        "name": "Plancher Hourdis Agglos",
        "description": "",
        "image": "/lf/uploads/catalog/dalle-hourdis-agloo/dalle-hourdis-agloo-1778130718857.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "efb70cea-300a-40ba-87be-97876f905567",
            "code": "LF-PLANCHER-HOURDIS-AGGLO-EFB7",
            "name": "Plancher Hourdis Agglos",
            "description": "",
            "unit": "U",
            "measureName": null,
            "image": "/lf/uploads/catalog/dalle-hourdis-agloo/dalle-hourdis-agloo-1778130718857.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "e36f1a75-c6ca-4fc6-be03-7758535de692",
        "name": "Plancher Hourdis brique",
        "description": "",
        "image": "/lf/uploads/catalog/dalle-hourdis-brique/dalle-hourdis-brique-1778079041359.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "e36f1a75-c6ca-4fc6-be03-7758535de692",
            "code": "LF-PLANCHER-HOURDIS-BRIQU-E36F",
            "name": "Plancher Hourdis brique",
            "description": "",
            "unit": "U",
            "measureName": null,
            "image": "/lf/uploads/catalog/dalle-hourdis-brique/dalle-hourdis-brique-1778079041359.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "c2c45bd7-8c23-4eaf-9211-64154a8bb4ca",
        "name": "Plancher Poste tension",
        "description": "",
        "image": "/lf/uploads/catalog/dalle-poste-tension/dalle-poste-tension-1778153665638.jpg",
        "minPrice": 280,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "2739acf6-e8bb-4306-ab0b-0abb352c57f1",
            "code": "LF-DALLE-PLEINE-POST-TEND-2739",
            "name": "Dalle Pleine Post-Tendue",
            "description": "La dalle pleine post-tendue est le type le plus courant dans les bâtiments résidentiels et tertiaires de hauteur moyenne à grande. Elle est constituée d'une dalle en béton armé d'épaisseur uniforme, dans laquelle sont noyés des câbles de post-tension gainés et tendus après durcissement du béton. Sa surface plane continue en sous-face facilite les installations techniques et les finitions. Elle convient aux portées de 6 à 12 m sans appui intermédiaire, offrant une grande liberté dans la distribution des espaces intérieurs.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/dalle-poste-tention-avec-cable/dalle-poste-tention-avec-cable-1782319583524.jpg",
            "price": 280,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Intersig",
                "supplierLogo": "/lf/uploads/suppliers/images-11/images-11-1782144624679.jpg",
                "price": 280,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "MK4 Africa PT ",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782752145200.jpg",
                "price": 280,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sadet",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782144847270.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Maroc Post Tension",
                "supplierLogo": "/lf/uploads/suppliers/mpt-charte-2026-logowhiteweb-2/mpt-charte-2026-logowhiteweb-2-1782320647712.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "CCL poste tention",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782321348616.jpg",
                "price": 350,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "18aedf54-3648-41e4-9817-659c0b953b9a",
            "code": "LF-POUTRE-PRECONTRAINTE-D-18AE",
            "name": "Poutre Précontrainte (Dalle sur poteaux)",
            "description": "La dalle précontrainte est une dalle pleine reposant directement sur des poteaux sans poutre intermédiaire, avec des zones de renforcement circulaires — les champignons — au droit des appuis pour reprendre les efforts de poinçonnement. La post-tension permet d'atteindre des portées importantes entre poteaux — de 7 à 14 m — tout en réduisant significativement l'épaisseur de la dalle par rapport à une solution béton armé classique. Elle est particulièrement adaptée aux parkings en ouvrage, aux centres commerciaux et aux plateaux de bureaux nécessitant une grande flexibilité de cloisonnement.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": "/lf/uploads/items/poutre-precontainte-poste-tention/poutre-precontainte-poste-tention-1782320054102.jpg",
            "price": 500,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "MK4 Africa PT ",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782752145200.jpg",
                "price": 500,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "CCL poste tention",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782321348616.jpg",
                "price": 500,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Maroc Post Tension",
                "supplierLogo": "/lf/uploads/suppliers/mpt-charte-2026-logowhiteweb-2/mpt-charte-2026-logowhiteweb-2-1782320647712.jpg",
                "price": 500,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Intersig",
                "supplierLogo": "/lf/uploads/suppliers/images-11/images-11-1782144624679.jpg",
                "price": 550,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "61a65410-4bcf-44b8-803f-ec0868f82c38",
        "name": "Plancher Réticulée Agglos",
        "description": "",
        "image": "/lf/uploads/catalog/dalle-reticulee-agglos/dalle-reticulee-agglos-1778132239473.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "61a65410-4bcf-44b8-803f-ec0868f82c38",
            "code": "LF-PLANCHER-RETICULEE-AGG-61A6",
            "name": "Plancher Réticulée Agglos",
            "description": "",
            "unit": "U",
            "measureName": null,
            "image": "/lf/uploads/catalog/dalle-reticulee-agglos/dalle-reticulee-agglos-1778132239473.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "eb3fb125-68eb-415e-9ac7-25fdef19ff9d",
        "name": "Plancher Réticulée Brique",
        "description": "",
        "image": "/lf/uploads/catalog/dalle-reticulee-brique/dalle-reticulee-brique-1778132254710.jpg",
        "minPrice": 290,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "b3ad488e-be2a-4b88-a27c-acd7b08e6cf4",
            "code": "LF-PREDALLE-POSTE-TENDUE-B3AD",
            "name": "Prédalle Poste-Tendue",
            "description": "La prédalle post-tendue est un élément préfabriqué en usine, constitué d'une mince dalle en béton précontraint servant de coffrage perdu et d'armature inférieure pour la dalle définitive coulée en place sur chantier. La post-tension est appliquée en usine lors de la fabrication, garantissant une qualité de béton maîtrisée et une mise en œuvre rapide sur chantier. Elle réduit significativement les travaux de coffrage et les délais de décoffrage, ce qui en fait une solution adaptée aux chantiers à cadence soutenue.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": null,
            "price": 290,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Socodam Davum",
                "supplierLogo": "/lf/uploads/suppliers/images-12/images-12-1782144685168.jpg",
                "price": 290,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Intersig",
                "supplierLogo": "/lf/uploads/suppliers/images-11/images-11-1782144624679.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sadet",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782144847270.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Caduco",
                "supplierLogo": "/lf/uploads/suppliers/images-10/images-10-1782144575325.jpg",
                "price": 310,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "9128622e-4954-47c5-98c4-32e8d7d36793",
    "name": "Béton",
    "position": 2,
    "image": "/lf/uploads/categories/camion-beton-toupi/camion-beton-toupi-1778490671151.jpg",
    "accent": "clay",
    "productCount": 8,
    "varianteCount": 8,
    "products": [
      {
        "id": "fafbb238-7c72-4b10-b461-488d2e3ce0a2",
        "name": "B10",
        "description": "Le béton B10 est un béton faiblement dosé en ciment, principalement utilisé pour les travaux de propreté, les couches de nivellement et les ouvrages ne nécessitant pas une grande résistance mécanique. Il est idéal pour les fondations légères, les dallages non porteurs et les préparations de surface avant coulage d’un béton structurel. Facile à mettre en œuvre, il assure une bonne stabilité et une base uniforme pour les travaux de construction.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275112609.jpg",
        "minPrice": 816,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "9db0d86a-d0dc-4b3a-977c-4386cbca220f",
            "code": "LF-B10-9DB0",
            "name": "B10",
            "description": "Le béton B10 est un béton maigre de faible dosage en ciment, utilisé exclusivement comme couche de propreté sous les fondations — semelles, radiers et longrines — pour protéger les armatures du contact direct avec le sol et garantir un fond de fouille propre et plan. Il n'a aucune fonction structurelle et ne nécessite pas d'armature. Son épaisseur courante est de 5 à 10 cm selon les prescriptions du bureau d'études. C'est le béton le moins cher du marché en raison de son faible dosage en ciment.",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275143545.jpg",
            "price": 816,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Ciments du Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-ciment-du-maroc/logo-ciment-du-maroc-1781649705445.jpg",
                "price": 816,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Holcim Maroc",
                "supplierLogo": "/lf/uploads/suppliers/holcim-maroc/holcim-maroc-1781650095409.jpg",
                "price": 817,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Ciments de l'Atlas",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782143819392.jpg",
                "price": 820,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "47a87fc1-5821-45af-b17a-8e4b02287556",
        "name": "B15",
        "description": "Le béton B15 est un béton à résistance modérée, utilisé pour les travaux de maçonnerie courante et les ouvrages nécessitant une résistance mécanique intermédiaire. Il convient parfaitement aux dallages légers, trottoirs, fondations simples, terrasses et petits ouvrages en béton armé. Apprécié pour sa polyvalence et sa durabilité, il offre une bonne tenue dans le temps tout en restant économique pour les projets de construction résidentiels et professionnels.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275347547.jpg",
        "minPrice": 840,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "796b9cbc-6151-4a45-a661-1bed6f2de0a8",
            "code": "LF-B15-796B",
            "name": "B15",
            "description": "Le béton B15 est un béton de faible résistance caractéristique — 15 MPa à 28 jours — positionné entre le béton de propreté B10 et le béton structurel courant B20. Il est utilisé pour les ouvrages peu sollicités mécaniquement ne nécessitant pas de calcul de structure rigoureux — dallages de cours et de parkings non structurels, remblais de tranchées de réseaux, massifs de fondation de clôtures et de portails, bétons de remplissage de fouilles et de nivelage, et ouvrages annexes de faible portée comme les caniveaux, les regards et les bordures coulés en place.",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275498629.jpg",
            "price": 840,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Holcim Maroc",
                "supplierLogo": "/lf/uploads/suppliers/holcim-maroc/holcim-maroc-1781650095409.jpg",
                "price": 840,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Ciments du Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-ciment-du-maroc/logo-ciment-du-maroc-1781649705445.jpg",
                "price": 846,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Ciments de l'Atlas",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782143819392.jpg",
                "price": 851,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "492e29ae-4769-4938-a9b5-2ec02d730687",
        "name": "B25",
        "description": "Le béton B25 est un béton à haute résistance, largement utilisé dans les travaux de construction structurelle et le béton armé. Il convient parfaitement aux fondations, poteaux, poutres, dalles, escaliers et ouvrages porteurs nécessitant une excellente solidité et durabilité. Grâce à sa résistance mécanique élevée et sa bonne performance face aux charges, le béton B25 est idéal pour les projets résidentiels, industriels et commerciaux.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275363149.jpg",
        "minPrice": 900,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "8c18475a-7b15-41ee-9b4d-23f99c81ec98",
            "code": "LF-B25-8C18",
            "name": "B25",
            "description": "Le béton B25 est la référence la plus consommée sur les chantiers résidentiels marocains. Sa résistance caractéristique de 25 MPa à 28 jours le rend adapté à la majorité des éléments structurels courants — fondations, poteaux, poutres, voiles et dalles de bâtiments résidentiels de type R+2 à R+5. C'est le béton prescrit par défaut par la majorité des bureaux d'études structure au Maroc pour les constructions résidentielles standard en zone de sismicité modérée.",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275619388.jpg",
            "price": 900,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Ciments de l'Atlas",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782143819392.jpg",
                "price": 900,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Asment Temara",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143659200.jpg",
                "price": 909,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Ciments du Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-ciment-du-maroc/logo-ciment-du-maroc-1781649705445.jpg",
                "price": 910,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Holcim Maroc",
                "supplierLogo": "/lf/uploads/suppliers/holcim-maroc/holcim-maroc-1781650095409.jpg",
                "price": 923,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "9d3f2bd4-ed7b-48e9-9b28-3f9d565cfe7f",
        "name": "B25 Hydrofuge",
        "description": "Le béton B25 hydrofuge est un béton haute résistance enrichi d’un adjuvant hydrofuge permettant de limiter la pénétration de l’eau et de l’humidité. Il est particulièrement adapté aux fondations, sous-sols, terrasses, piscines, réservoirs et ouvrages exposés à l’humidité ou aux infiltrations. Alliant solidité, durabilité et protection contre l’eau, il offre une excellente performance pour les constructions résidentielles, industrielles et commerciales.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275381116.jpg",
        "minPrice": 840,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "5712f1e2-eb86-4f34-bdd7-3dd98a0a0075",
            "code": "LF-B25-HYDROFUGE-5712",
            "name": "B25 Hydrofuge",
            "description": "Le béton B25 hydrofuge est un béton de résistance B25 additivé d'un adjuvant hydrofuge intégré dans la masse lors du malaxage en centrale. L'adjuvant réduit la perméabilité du béton durci en obturant les capillaires et les micropores, limitant ainsi les remontées d'humidité et les infiltrations d'eau sous pression. Il est prescrit pour les fondations, les murs de sous-sol, les radiers, les ouvrages enterrés et les planchers sur terre-plein exposés à l'humidité du sol.",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275898436.jpg",
            "price": 840,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Ciments de l'Atlas",
                "supplierLogo": "/lf/uploads/suppliers/images-2/images-2-1782143819392.jpg",
                "price": 840,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Asment Temara",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143659200.jpg",
                "price": 845,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Holcim Maroc",
                "supplierLogo": "/lf/uploads/suppliers/holcim-maroc/holcim-maroc-1781650095409.jpg",
                "price": 859,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Ciments du Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-ciment-du-maroc/logo-ciment-du-maroc-1781649705445.jpg",
                "price": 862,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "06bdbaf1-5976-4637-9caf-827cc5706d9b",
        "name": "B30",
        "description": "Le béton B30 est un béton à très haute résistance, conçu pour les ouvrages structurels exigeant une grande capacité de charge et une excellente durabilité. Il est idéal pour les fondations renforcées, dalles industrielles, poteaux, poutres, ouvrages en béton armé et constructions à fortes contraintes mécaniques. Grâce à sa robustesse et sa résistance aux agressions extérieures, le béton B30 est parfaitement adapté aux projets résidentiels, industriels et de génie civil.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275393539.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "06bdbaf1-5976-4637-9caf-827cc5706d9b",
            "code": "LF-B30-06BD",
            "name": "B30",
            "description": "Le béton B30 est un béton à très haute résistance, conçu pour les ouvrages structurels exigeant une grande capacité de charge et une excellente durabilité. Il est idéal pour les fondations renforcées, dalles industrielles, poteaux, poutres, ouvrages en béton armé et constructions à fortes contraintes mécaniques. Grâce à sa robustesse et sa résistance aux agressions extérieures, le béton B30 est parfaitement adapté aux projets résidentiels, industriels et de génie civil.",
            "unit": "M3",
            "measureName": null,
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275393539.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "5f7a0243-c92d-4289-8eb5-26c1627129d7",
        "name": "B30 Hydrofuge",
        "description": "Le béton B30 hydrofuge est un béton à très haute résistance intégrant un adjuvant hydrofuge qui réduit l’absorption d’eau et protège efficacement contre l’humidité et les infiltrations. Il est particulièrement recommandé pour les sous-sols, piscines, réservoirs, fondations, murs enterrés et ouvrages exposés aux conditions climatiques difficiles. Alliant solidité, étanchéité et durabilité, il garantit une excellente performance pour les constructions résidentielles, industrielles et les projets de génie civil.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275402368.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "5f7a0243-c92d-4289-8eb5-26c1627129d7",
            "code": "LF-B30-HYDROFUGE-5F7A",
            "name": "B30 Hydrofuge",
            "description": "Le béton B30 hydrofuge est un béton à très haute résistance intégrant un adjuvant hydrofuge qui réduit l’absorption d’eau et protège efficacement contre l’humidité et les infiltrations. Il est particulièrement recommandé pour les sous-sols, piscines, réservoirs, fondations, murs enterrés et ouvrages exposés aux conditions climatiques difficiles. Alliant solidité, étanchéité et durabilité, il garantit une excellente performance pour les constructions résidentielles, industrielles et les projets de génie civil.",
            "unit": "M3",
            "measureName": null,
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275402368.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "0c117b94-57f7-43a9-a5da-085c3bfcd5f1",
        "name": "B35",
        "description": "Le béton B35 est un béton à très haute performance, destiné aux ouvrages nécessitant une résistance mécanique élevée et une durabilité renforcée. Il est particulièrement adapté aux structures porteuses, bâtiments industriels, ouvrages de génie civil, dalles fortement sollicitées et constructions exposées à des charges importantes. Grâce à sa grande robustesse et sa résistance aux contraintes et aux agressions extérieures, le béton B35 garantit fiabilité, longévité et sécurité pour les projets les plus exigeants.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275417376.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "0c117b94-57f7-43a9-a5da-085c3bfcd5f1",
            "code": "LF-B35-0C11",
            "name": "B35",
            "description": "Le béton B35 est un béton à très haute performance, destiné aux ouvrages nécessitant une résistance mécanique élevée et une durabilité renforcée. Il est particulièrement adapté aux structures porteuses, bâtiments industriels, ouvrages de génie civil, dalles fortement sollicitées et constructions exposées à des charges importantes. Grâce à sa grande robustesse et sa résistance aux contraintes et aux agressions extérieures, le béton B35 garantit fiabilité, longévité et sécurité pour les projets les plus exigeants.",
            "unit": "M3",
            "measureName": null,
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275417376.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "173f256e-ade9-46a4-a0b1-4553a81bb04f",
        "name": "B35 Hydrofuge",
        "description": "e béton B35 hydrofuge est un béton haute performance combinant une très forte résistance mécanique avec une protection renforcée contre l’eau et l’humidité grâce à l’ajout d’un adjuvant hydrofuge. Il est idéal pour les ouvrages exposés aux infiltrations et aux conditions extrêmes, tels que les sous-sols, piscines, réservoirs, murs enterrés, ouvrages maritimes et structures de génie civil. Durable, étanche et extrêmement robuste, il assure une excellente longévité et une protection optimale des constructions.",
        "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275427700.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "173f256e-ade9-46a4-a0b1-4553a81bb04f",
            "code": "LF-B35-HYDROFUGE-173F",
            "name": "B35 Hydrofuge",
            "description": "e béton B35 hydrofuge est un béton haute performance combinant une très forte résistance mécanique avec une protection renforcée contre l’eau et l’humidité grâce à l’ajout d’un adjuvant hydrofuge. Il est idéal pour les ouvrages exposés aux infiltrations et aux conditions extrêmes, tels que les sous-sols, piscines, réservoirs, murs enterrés, ouvrages maritimes et structures de génie civil. Durable, étanche et extrêmement robuste, il assure une excellente longévité et une protection optimale des constructions.",
            "unit": "M3",
            "measureName": null,
            "image": "/lf/uploads/items/shutterstock-1034278981-0-jpg/shutterstock-1034278981-0-jpg-1783275427700.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      }
    ]
  },
  {
    "id": "42dccef3-f4d6-4abd-af69-7a50ff2acafe",
    "name": "Fer",
    "position": 3,
    "image": "/lf/uploads/categories/camion-fer/camion-fer-1778165907068.jpg",
    "accent": "teal",
    "productCount": 4,
    "varianteCount": 13,
    "products": [
      {
        "id": "db97158b-e662-4406-8008-4a840deae66a",
        "name": "Clous",
        "description": "Le clou est un organe d'assemblage mécanique en acier, fabriqué par tréfilage et étirage de fil machine, utilisé pour la fixation et l'assemblage des éléments en bois sur les chantiers de construction — coffrages, charpentes, bardages, planchers provisoires et structures légères. Il constitue l'un des consommables les plus basiques et les plus consommés du BTP. Sa forme, son diamètre, sa longueur et son type de pointe varient selon l'application, le support et la résistance mécanique requise. Sur les chantiers marocains, il est utilisé massivement pour le montage et le démontage des coffrages bois, l'assemblage des madriers et chevrons, la fixation des voliges de toiture et la réalisation des structures provisoires d'étaiement.",
        "image": "/lf/uploads/items/h6c7323b231d64c088dcefc5771b5e516u/h6c7323b231d64c088dcefc5771b5e516u-1782759716061.jpg",
        "minPrice": 18,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "6cb33fac-7976-4566-86cb-0422e70f8e62",
            "code": "LF-CLOUS-10CM-6CB3",
            "name": "Clous 10cm",
            "description": "Le clou de 100 mm est un clou de grande taille utilisé pour les assemblages nécessitant une forte résistance mécanique — fixation des madriers de coffrage épais, assemblage des pièces de charpente lourde, ancrage des étais bois, clouage des banches de grande hauteur et réalisation des structures provisoires soumises à des charges importantes. Son diamètre courant est de 3,5 à 4,0 mm selon la référence. Sa longueur supérieure lui permet de traverser plusieurs épaisseurs de bois et d'assurer une liaison solide et durable entre les éléments assemblés, ce qui en fait la référence de choix pour les coffrages de voiles, de poteaux et de fondations sur les chantiers de gros œuvre.",
            "unit": "KG",
            "measureName": "Kilogramme",
            "image": "/lf/uploads/items/h6c7323b231d64c088dcefc5771b5e516u/h6c7323b231d64c088dcefc5771b5e516u-1782760093682.jpg",
            "price": 25,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 25,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 26,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 28,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 28,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "5bba1d8a-77c6-4082-ad7e-442d71efbb7b",
            "code": "LF-CLOUS-6CM-5BBA",
            "name": "Clous 6cm",
            "description": "Le clou de 60 mm est un clou de taille moyenne utilisé pour l'assemblage des éléments de coffrage léger, la fixation des voliges et des planches de bois mince, le clouage des lambourdes et des liteaux de toiture et la réalisation des structures provisoires légères sur chantier. Son diamètre courant est de 2,7 à 3,0 mm selon la référence. Il offre un bon compromis entre résistance à l'arrachement et facilité de pose à la main ou au marteau pneumatique, ce qui en fait l'un des clous les plus consommés sur les chantiers résidentiels marocains.",
            "unit": "KG",
            "measureName": "Kilogramme",
            "image": "/lf/uploads/items/h6c7323b231d64c088dcefc5771b5e516u/h6c7323b231d64c088dcefc5771b5e516u-1782759837395.jpg",
            "price": 28,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 28,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 30,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 30,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 31,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "d6e073cc-b3dc-4cf1-9bf7-94e14d0bd532",
            "code": "LF-CLOUS-8CM-D6E0",
            "name": "Clous 8cm",
            "description": "Le clou de 80 mm est la référence standard la plus consommée sur les chantiers de coffrage et de charpente. Son diamètre courant est de 3,1 à 3,5 mm selon la référence. Il est utilisé pour l'assemblage des panneaux de coffrage bois, la fixation des madriers et chevrons, le montage des banches légères, la réalisation des structures d'étaiement provisoires et le clouage des planchers de chantier. Sa longueur lui permet de traverser deux épaisseurs de planche standard tout en offrant une résistance à l'arrachement suffisante pour les coffrages soumis à la pression du béton frais.",
            "unit": "KG",
            "measureName": "Kilogramme",
            "image": "/lf/uploads/items/h6c7323b231d64c088dcefc5771b5e516u/h6c7323b231d64c088dcefc5771b5e516u-1782759984347.jpg",
            "price": 18,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 18,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 20,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 22,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 23,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "b070eaf6-fc37-4e5d-aa33-8befd8453068",
        "name": "Fer à béton",
        "description": "Le fer à béton, également appelé rond à béton ou acier d'armature, est un produit sidérurgique laminé à chaud utilisé pour le renforcement des structures en béton armé. Ses nervures hélicoïdales en surface — d'où l'appellation HA pour haute adhérence — assurent une liaison mécanique optimale avec le béton, permettant aux deux matériaux de travailler ensemble sous charge. Il est fabriqué au Maroc à partir de ferraille recyclée fondue au four à arc électrique, laminée et nervurée en continu. C'est le matériau structurel le plus consommé sur les chantiers marocains après le ciment, intervenant dans la fabrication de tous les éléments porteurs — fondations, poteaux, poutres, voiles, dalles et planchers. Son diamètre, exprimé en millimètres et précédé de la lettre T, détermine la résistance mécanique de l'armature et conditionne son usage selon les calculs du bureau d'études structure.",
        "image": "/lf/uploads/items/fer-a-beton-torsade-ou-rond-beton-torsade-03/fer-a-beton-torsade-ou-rond-beton-torsade-03-1782760607043.jpg",
        "minPrice": 9310,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "3591fb37-c781-4a9e-beb8-fa885df62043",
            "code": "LF-T12-3591",
            "name": "T12",
            "description": "Le T12 est le diamètre de référence pour les armatures principales des dalles, des semelles filantes, des longrines et des poutres de faible portée. C'est l'un des diamètres les plus consommés sur les chantiers de construction résidentielle au Maroc — villas, immeubles R+2 à R+4 — en raison de sa polyvalence et de sa résistance mécanique adaptée aux charges courantes.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782761453325.jpg",
            "price": 9320,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9320,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 9400,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 9440,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 9510,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "29943970-3e4e-4e31-b5c9-c57218df2405",
            "code": "LF-T14-2994",
            "name": "T14",
            "description": "Le T14 est utilisé pour les armatures principales des poteaux de faible à moyenne section, des poutres de portée moyenne, des semelles isolées et des voiles de sous-sol. Il est fréquemment prescrit par les bureaux d'études pour les bâtiments résidentiels collectifs de type R+3 à R+5, où les charges structurelles commencent à nécessiter des sections d'armatures plus importantes que le T12.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782761512942.jpg",
            "price": 9390,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 9390,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9400,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 9410,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 9440,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "f0742cde-60e0-40b5-a229-c92e410c3e41",
            "code": "LF-T16-F074",
            "name": "T16",
            "description": "Le T16 est la référence pour les armatures principales des poteaux de moyenne à grande section, des poutres de grande portée, des voiles de soutènement et des radiers de bâtiments de moyenne hauteur. Il est prescrit pour les immeubles de type R+5 et au-delà, les bâtiments tertiaires et commerciaux et les ouvrages soumis à des charges sismiques importantes dans les zones à risque au Maroc.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782761689115.jpg",
            "price": 9395,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 9395,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9400,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 9410,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 9440,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "b417bdc7-ecdf-4ba8-a14f-24ff989c9b7e",
            "code": "LF-T20-B417",
            "name": "T20",
            "description": "Le T20 est utilisé pour les armatures principales des ouvrages de grande dimension — poteaux de forte section, poutres de grande portée, radiers épais, voiles de soutènement de grande hauteur et fondations profondes. Il est principalement prescrit pour les tours, les immeubles de grande hauteur, les bâtiments industriels et les ouvrages d'infrastructure nécessitant des sections d'acier importantes pour reprendre des charges élevées.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782761762676.jpg",
            "price": 9390,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 9390,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9400,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 9410,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 9440,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "e26a1ab7-b7ba-4de6-ac41-3ec3fc837111",
            "code": "LF-T25-E26A",
            "name": "T25",
            "description": "Le T25 est le plus grand diamètre courant du marché marocain, réservé aux ouvrages structurels de grande envergure — fondations profondes, radiers de tours, poteaux de très grande section, poutres de très grande portée et ouvrages d'art. Sa forte section lui confère une résistance mécanique très élevée, mais sa mise en œuvre nécessite des équipements de cintrage et de manutention spécialisés. Il est prescrit exclusivement par les bureaux d'études structure pour les projets à charges exceptionnelles — grandes infrastructures, ponts, immeubles de grande hauteur et ouvrages industriels lourds.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782761824798.jpg",
            "price": 9390,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 9390,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9400,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 9410,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 9440,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "5dde0c7f-b982-463f-97ce-96388b9f592b",
            "code": "LF-T6-5DDE",
            "name": "T6",
            "description": "Le T6 est le plus petit diamètre courant du marché marocain. Utilisé pour les armatures secondaires, les étriers de petite section, les cadres de poteaux de faible charge, les lisses de dalles minces et les armatures de répartition dans les chapes et dallages légers. Sa faible section le rend facile à cintrer à la main sans outillage spécialisé.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782760734324.jpg",
            "price": 9310,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 9310,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9340,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 9410,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 9470,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "2302355e-0748-4492-aff3-029dc91c42d4",
            "code": "LF-T8-2302",
            "name": "T8",
            "description": "Le T8 est très utilisé pour les étriers et cadres de poteaux et poutres, les armatures de répartition des dalles, les lisses de voiles minces et les armatures secondaires de fondations. Il est facilement cintrable à la cisaille et à la cintreuse manuelle, ce qui en fait l'un des diamètres les plus manipulés sur les chantiers résidentiels.",
            "unit": "PIECE",
            "measureName": "Tonne",
            "image": "/lf/uploads/items/fer-a-beton-torsade-longueur-6-metres-jpg/fer-a-beton-torsade-longueur-6-metres-jpg-1782761359747.jpg",
            "price": 9320,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 9320,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 9400,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 9440,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 9510,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "abec4fc7-00ca-4940-b200-87679cc68ffc",
        "name": "Fil d'attache",
        "description": "Le fil d’attache est un fil d’acier recuit, utilisé sur les chantiers pour lier et fixer les armatures en acier (fers à béton) entre elles avant le coulage du béton. Il permet de maintenir les barres en position, d’assurer la stabilité du ferraillage et de garantir le respect des plans de structure. Facile à torsader et très résistant, le fil d’attache est un élément indispensable pour les travaux de béton armé et de maçonnerie.",
        "image": "/lf/uploads/items/fer-d-attache/fer-d-attache-1782760266971.jpg",
        "minPrice": 410,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "bca58a1e-490a-4bdb-b73c-402f8e96ae33",
            "code": "LF-FIL-D-ATTACHE-BCA5",
            "name": "Fil d'attache",
            "description": "Le fil d'attache est un fil métallique en acier recuit, souple et ductile, utilisé sur les chantiers de construction pour la ligature et l'assemblage des armatures en acier — ronds à béton, treillis soudés et cadres — avant le coulage du béton. C'est l'un des consommables les plus basiques et les plus indispensables du ferraillage. Sa souplesse après recuit lui permet d'être tordu facilement à la main ou à la pince à ligaturer sans se casser, garantissant une fixation rapide et efficace des croisements d'armatures. Il est également utilisé pour la fixation provisoire des coffrages, l'assemblage des éléments de charpente légère et le cerclage des matériaux sur chantier.",
            "unit": "PIECE",
            "measureName": "Bobine de 25kg",
            "image": "/lf/uploads/items/fer-d-attache/fer-d-attache-1782760383129.jpg",
            "price": 410,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 410,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 460,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 530,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "41b3f903-8e1d-45bd-8a22-3650e5a09672",
        "name": "Treillis Soudé",
        "description": "Le treillis soudé est un produit de ferraillage préfabriqué en usine, constitué de fils d'acier à haute adhérence — HA — ou tréfilés, assemblés en réseau orthogonal et soudés électriquement à chaque croisement. Il remplace avantageusement le ferraillage manuel fil par fil sur chantier, réduisant significativement les temps de pose, les pertes de matière et les risques d'erreur d'écartement. Il est utilisé pour le renforcement des dalles de béton, des chapes, des dallages industriels, des voiles, des prédalles et des éléments préfabriqués. Disponible en panneaux de dimensions standard ou en rouleaux pour les grandes surfaces, il est choisi en fonction du diamètre des fils, du pas de maille et de la résistance mécanique requise par le bureau d'études structure.",
        "image": "/lf/uploads/items/h0dc1a5f0e285406eb14b967ff299356cz/h0dc1a5f0e285406eb14b967ff299356cz-1782759209905.jpg",
        "minPrice": 835,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "789d10f8-05d6-4bd3-a464-118dd09aaf4a",
            "code": "LF-TREILLIS-SOUDE-6-20-20-789D",
            "name": "Treillis soudé 6/20/20",
            "description": "Le treillis soudé 6/20/20 est un panneau de ferraillage préfabriqué constitué de fils d'acier à haute adhérence de diamètre 6 mm, assemblés en maille carrée de 20 x 20 cm et soudés électriquement à chaque croisement. Plus léger que le 8/20/20, il est utilisé pour le ferraillage des dalles de compression sur planchers à poutrelles et hourdis, des chapes armées, des dallages légers, des voiles minces et des prédalles.",
            "unit": "PIECE",
            "measureName": "Panneau de 2,40 x 6 m (14,40 m²)",
            "image": "/lf/uploads/items/h0dc1a5f0e285406eb14b967ff299356cz/h0dc1a5f0e285406eb14b967ff299356cz-1782759465311.jpg",
            "price": 835,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Somasteel",
                "supplierLogo": "/lf/uploads/suppliers/aaa/aaa-1782143282952.jpg",
                "price": 835,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 840,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Univers Acier",
                "supplierLogo": "/lf/uploads/suppliers/images/images-1782143372084.jpg",
                "price": 900,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 915,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "006586d2-a118-486c-910f-b7fbf266dd57",
            "code": "LF-TREILLIS-SOUDE-8-20-20-0065",
            "name": "Treillis soudé 8/20/20",
            "description": "Le treillis soudé 8/20/20 est un panneau de ferraillage préfabriqué constitué de fils d'acier à haute adhérence de diamètre 8 mm, assemblés en maille carrée de 20 x 20 cm et soudés électriquement à chaque croisement. C'est la référence la plus utilisée sur les chantiers de gros œuvre au Maroc pour le ferraillage des dalles de béton armé de structure, des planchers sur terre-plein, des radiers et des dallages industriels soumis à des charges importantes. Sa forte section de fil lui confère une résistance mécanique élevée, adaptée aux dalles de bâtiments collectifs, commerciaux et industriels de type R+2 et au-delà.",
            "unit": "PIECE",
            "measureName": "Panneau de 2,40 x 6 m (14,40 m²)",
            "image": "/lf/uploads/items/h0dc1a5f0e285406eb14b967ff299356cz/h0dc1a5f0e285406eb14b967ff299356cz-1782759319509.jpg",
            "price": 1320,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "VM Steel Maroc",
                "supplierLogo": "/lf/uploads/suppliers/logo-vmsteel-maroc/logo-vmsteel-maroc-1782143468459.jpg",
                "price": 1320,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 1380,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 1385,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "6fcd6d1c-60d3-4e57-8037-f10492fae532",
    "name": "Bois",
    "position": 4,
    "image": "/lf/uploads/categories/bois-coffrage/bois-coffrage-1782322871830.jpg",
    "accent": "cyan",
    "productCount": 6,
    "varianteCount": 9,
    "products": [
      {
        "id": "8d62de80-e841-4d77-9890-ce79e237e05c",
        "name": "Bois de coffrage",
        "description": "Panneau de contreplaqué recouvert d'un film phénolique bakélisé sur ses deux faces, conçu spécifiquement pour le coffrage du béton. Sa surface imperméable et lisse facilite le décoffrage, limite les adhérences avec le béton et permet de nombreuses réutilisations. Ce segment est en forte croissance au Maroc, avec une adoption massive sur les chantiers professionnels.",
        "image": "/lf/uploads/items/panneaux-de-coffrage/panneaux-de-coffrage-1782675349968.jpg",
        "minPrice": 100,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "c2a59662-8c10-4ae1-9fe2-02066b840ebf",
            "code": "LF-PANNEAU-DE-CONTREPLAQU-C2A5",
            "name": "Panneau de contreplaqué (1,22m x 2,44m)",
            "description": "Le panneau de contreplaqué est un matériau de construction fabriqué par assemblage de plusieurs feuilles de bois déroulé — appelées plis — collées en couches croisées à 90° les unes par rapport aux autres. Cette disposition alternée des fibres lui confère une résistance mécanique élevée et homogène dans toutes les directions, une bonne stabilité dimensionnelle et une excellente rigidité pour son poids.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/panneaux-de-coffrage/panneaux-de-coffrage-1782675493282.jpg",
            "price": 100,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 100,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Tolbois",
                "supplierLogo": "/lf/uploads/suppliers/20210405195011/20210405195011-1782311674031.jpg",
                "price": 110,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "5eac6baf-9a78-4bee-b0e2-3e976afc5e9b",
        "name": "Bois Lamellé-Collé",
        "description": "Élément structurel fabriqué par assemblage sous pression de lamelles de bois dont les fils sont orientés dans le sens de la longueur. Ce procédé industriel élimine les défauts naturels du bois massif et confère une résistance mécanique élevée, une stabilité dimensionnelle et une bonne tenue au feu. Utilisé pour les charpentes longue portée, les poutres apparentes, les structures hôtelières et touristiques.",
        "image": "/lf/uploads/items/pourtre-lamelle-colle-2-1000-1000-320-320r/pourtre-lamelle-colle-2-1000-1000-320-320r-1782676524132.jpg",
        "minPrice": 2150,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "6288a56c-570d-4ca7-9969-2a1e1f67255b",
            "code": "LF-BOIS-LAMELLE-COLLE-6288",
            "name": "Bois Lamellé-Collé",
            "description": "Élément structurel fabriqué par assemblage sous pression de lamelles de bois dont les fils sont orientés dans le sens de la longueur. Ce procédé industriel élimine les défauts naturels du bois massif et confère une résistance mécanique élevée, une stabilité dimensionnelle et une bonne tenue au feu. Utilisé pour les charpentes longue portée, les poutres apparentes, les structures hôtelières et touristiques.",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/pourtre-lamelle-colle-2-1000-1000-320-320r/pourtre-lamelle-colle-2-1000-1000-320-320r-1782676594681.jpg",
            "price": 2150,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Borj Bois",
                "supplierLogo": "/lf/uploads/suppliers/file-184/file-184-1782214985473.jpg",
                "price": 2150,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 2200,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "7355709a-2a85-4a9b-80c8-f6452612a884",
        "name": "Bois Massif de structure (Madrier)",
        "description": "Le madrier est une pièce de bois massif résineux de forte section, sciée et calibrée en atelier, utilisée sur les chantiers de construction comme élément porteur temporaire ou permanent. Sa robustesse et sa rigidité en font un matériau de référence pour les coffrages traditionnels, les étaiements, les banches bois, les planchers de chantier provisoires et les structures de charpente légère. Il est également employé comme pièce d'appui sous les étais métalliques et comme lisse de sécurité sur les échafaudages.",
        "image": "/lf/uploads/items/img-0514/img-0514-1782676755177.jpg",
        "minPrice": 2500,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "8baf9cc7-6abb-4911-be7b-f85508ed5165",
            "code": "LF-MADRIER-8BAF",
            "name": "Madrier",
            "description": "Le madrier est une pièce de bois massif résineux de forte section, sciée et calibrée en atelier, utilisée sur les chantiers de construction comme élément porteur temporaire ou permanent. Sa robustesse et sa rigidité en font un matériau de référence pour les coffrages traditionnels, les étaiements, les banches bois, les planchers de chantier provisoires et les structures de charpente légère. Il est également employé comme pièce d'appui sous les étais métalliques et comme lisse de sécurité sur les échafaudages.",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/madrier-75x-225x-4m/madrier-75x-225x-4m-1782676842467.jpg",
            "price": 2500,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Tolbois",
                "supplierLogo": "/lf/uploads/suppliers/20210405195011/20210405195011-1782311674031.jpg",
                "price": 2500,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 2600,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "51279a23-5309-430e-9062-acae3993b656",
        "name": "Contreplaqué filmé (Bakélisé)",
        "description": "Le contreplaqué filmé bakélisé est un panneau de coffrage technique fabriqué par assemblage de plis de bois déroulé — birch, peuplier ou eucalyptus selon l'origine — collés en couches croisées avec une colle phénolique waterproof WBP, et revêtu sur ses deux faces d'un film phénolique bakélisé imprégné à haute température et haute pression. Ce film imperméable, lisse et extrêmement résistant constitue l'élément distinctif du produit : il crée une barrière totale entre le bois et le béton, empêchant toute adhérence lors du décoffrage, limitant l'absorption d'eau et garantissant un parement béton lisse et régulier à chaque réutilisation. C'est le panneau de coffrage de référence sur les chantiers professionnels marocains pour les coffrages de voiles, de poteaux, de dalles, de poutres et de tout ouvrage nécessitant un parement soigné ou une cadence de rotation élevée.",
        "image": "/lf/uploads/items/bakelise-800x800/bakelise-800x800-1782997425126.jpg",
        "minPrice": 256,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "33f530ba-e13a-46c8-a41b-2926c9bb7042",
            "code": "LF-CONTREPLAQUE-FILME-BAK-33F5",
            "name": "Contreplaqué filmé (Bakélisé) 15mm",
            "description": "Le contreplaqué filmé bakélisé est un panneau de coffrage technique fabriqué par assemblage de plis de bois déroulé — birch, peuplier ou eucalyptus selon l'origine — collés en couches croisées avec une colle phénolique waterproof WBP, et revêtu sur ses deux faces d'un film phénolique bakélisé imprégné à haute température et haute pression. Ce film imperméable, lisse et extrêmement résistant constitue l'élément distinctif du produit : il crée une barrière totale entre le bois et le béton, empêchant toute adhérence lors du décoffrage, limitant l'absorption d'eau et garantissant un parement béton lisse et régulier à chaque réutilisation. C'est le panneau de coffrage de référence sur les chantiers professionnels marocains pour les coffrages de voiles, de poteaux, de dalles, de poutres et de tout ouvrage nécessitant un parement soigné ou une cadence de rotation élevée.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/bakelise-800x800/bakelise-800x800-1782997529474.jpg",
            "price": 256,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 256,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "8d2ef382-89f4-417f-9488-6745d02dd078",
            "code": "LF-CONTREPLAQUE-FILME-BAK-8D2E",
            "name": "Contreplaqué filmé (Bakélisé) 18mm",
            "description": "Le contreplaqué filmé bakélisé est un panneau de coffrage technique fabriqué par assemblage de plis de bois déroulé — birch, peuplier ou eucalyptus selon l'origine — collés en couches croisées avec une colle phénolique waterproof WBP, et revêtu sur ses deux faces d'un film phénolique bakélisé imprégné à haute température et haute pression. Ce film imperméable, lisse et extrêmement résistant constitue l'élément distinctif du produit : il crée une barrière totale entre le bois et le béton, empêchant toute adhérence lors du décoffrage, limitant l'absorption d'eau et garantissant un parement béton lisse et régulier à chaque réutilisation. C'est le panneau de coffrage de référence sur les chantiers professionnels marocains pour les coffrages de voiles, de poteaux, de dalles, de poutres et de tout ouvrage nécessitant un parement soigné ou une cadence de rotation élevée.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/bakelise-800x800/bakelise-800x800-1782997635801.jpg",
            "price": 320,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 320,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "5bfe482c-e3af-4bf1-bc7b-8dbe513646b5",
            "code": "LF-CONTREPLAQUE-FILME-BAK-5BFE",
            "name": "Contreplaqué filmé (Bakélisé) 21mm",
            "description": "Le contreplaqué filmé bakélisé est un panneau de coffrage technique fabriqué par assemblage de plis de bois déroulé — birch, peuplier ou eucalyptus selon l'origine — collés en couches croisées avec une colle phénolique waterproof WBP, et revêtu sur ses deux faces d'un film phénolique bakélisé imprégné à haute température et haute pression. Ce film imperméable, lisse et extrêmement résistant constitue l'élément distinctif du produit : il crée une barrière totale entre le bois et le béton, empêchant toute adhérence lors du décoffrage, limitant l'absorption d'eau et garantissant un parement béton lisse et régulier à chaque réutilisation. C'est le panneau de coffrage de référence sur les chantiers professionnels marocains pour les coffrages de voiles, de poteaux, de dalles, de poutres et de tout ouvrage nécessitant un parement soigné ou une cadence de rotation élevée.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/bakelise-800x800/bakelise-800x800-1782997685578.jpg",
            "price": 390,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 390,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "e07df873-3a6c-4abe-8e3e-20994efc44d9",
        "name": "Panneau MDF",
        "description": "Panneau en fibres de bois agglomérées sous pression et chaleur avec une résine, présentant une surface homogène, dense et parfaitement lisse. Utilisé principalement en second œuvre — habillages intérieurs, cloisons légères, plafonds, coffrages de finition et menuiserie intérieure. Sa surface plane le rend idéal pour les applications décoratives et les revêtements peints ou mélaminés.",
        "image": "/lf/uploads/items/mdf-1-600x338/mdf-1-600x338-1782676250583.jpg",
        "minPrice": 150,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "ba0352eb-1ed7-4c1b-be39-f12a8f3a66d0",
            "code": "LF-PANNEAU-MDF-BA03",
            "name": "Panneau MDF",
            "description": "Panneau en fibres de bois agglomérées sous pression et chaleur avec une résine, présentant une surface homogène, dense et parfaitement lisse. Utilisé principalement en second œuvre — habillages intérieurs, cloisons légères, plafonds, coffrages de finition et menuiserie intérieure. Sa surface plane le rend idéal pour les applications décoratives et les revêtements peints ou mélaminés.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/mdf-1-600x338/mdf-1-600x338-1782676354023.jpg",
            "price": 150,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Borj Bois",
                "supplierLogo": "/lf/uploads/suppliers/file-184/file-184-1782214985473.jpg",
                "price": 150,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Jawda Bois",
                "supplierLogo": "/lf/uploads/suppliers/images-20/images-20-1782214932759.jpg",
                "price": 160,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "396bae2f-099e-434d-9064-560bbc986f67",
        "name": "Poutres H20",
        "description": "POUTRE H20 — Description générale La poutre H20 est un élément de coffrage structurel préfabriqué en bois lamellé-collé, dont la section transversale en forme de H lui a donné son nom. Elle est composée de deux membrures supérieure et inférieure en bois massif de résineux — épicéa ou sapin — assemblées par une âme centrale en contreplaqué multiplis ou en OSB, le tout collé sous pression avec une résine phénolique waterproof garantissant la tenue en milieu humide de chantier. Sa hauteur standard de 20 cm lui confère une rigidité et une résistance à la flexion élevées pour son poids, ce qui en fait l'élément de coffrage horizontal de référence mondiale pour les dalles, les voiles et les coffrages de grande portée. Légère, résistante, réutilisable et facile à assembler avec les systèmes de coffrage modulaires, elle est utilisée sur tous les grands chantiers de construction au Maroc — immeubles collectifs, bâtiments tertiaires, ouvrages d'infrastructure — en remplacement des madriers bois traditionnels dont elle offre des performances mécaniques nettement supérieures à section équivalente.",
        "image": "/lf/uploads/items/poutres-h20/poutres-h20-1782998862322.jpg",
        "minPrice": 125,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "fef3a626-37d0-4bf2-8503-4fd93aea878d",
            "code": "LF-POUTRE-H20-3-90MM-FEF3",
            "name": "Poutre H20 3,90mm",
            "description": "La poutre H20 de 2,90 m est la longueur courte de référence, utilisée pour les trames de coffrage de petite à moyenne portée — dalles de faible épaisseur, coffrages secondaires, zones de rive et de remplissage entre poutres principales. Elle est particulièrement adaptée aux chantiers résidentiels de type R+2 à R+4 où les trames structurelles sont inférieures à 3 m, et aux zones de chantier à accès contraint où la manipulation de poutres longues est difficile. Sa légèreté — environ 13 à 14 kg par pièce — permet une manutention manuelle sans équipement de levage.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": "/lf/uploads/items/poutres-h20/poutres-h20-1782999012670.jpg",
            "price": 125,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 125,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "52fbd4d4-0178-4c46-851a-bf91f4d2cc45",
            "code": "LF-POUTRES-H20-2-90MM-52FB",
            "name": "Poutres H20 2.90mm",
            "description": "La poutre H20 de 2,90 m est la longueur courte de référence, utilisée pour les trames de coffrage de petite à moyenne portée — dalles de faible épaisseur, coffrages secondaires, zones de rive et de remplissage entre poutres principales. Elle est particulièrement adaptée aux chantiers résidentiels de type R+2 à R+4 où les trames structurelles sont inférieures à 3 m, et aux zones de chantier à accès contraint où la manipulation de poutres longues est difficile. Sa légèreté — environ 13 à 14 kg par pièce — permet une manutention manuelle sans équipement de levage.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": "/lf/uploads/items/poutres-h20/poutres-h20-1782998941665.jpg",
            "price": 125,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 125,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "51a8296e-3a61-462e-b10c-2b1e4ba1b10d",
    "name": "Ciment",
    "position": 4,
    "image": "/lf/uploads/categories/camion-ciment/camion-ciment-1778166099486.jpg",
    "accent": "emerald",
    "productCount": 4,
    "varianteCount": 4,
    "products": [
      {
        "id": "9ea6d3b1-febc-48a6-8d59-e40fd716f80a",
        "name": "50 KG",
        "description": "Le ciment 55 en sac de 50 kg est un ciment à très haute résistance, conçu pour les ouvrages exigeant des performances mécaniques élevées et une durabilité renforcée. Il est particulièrement utilisé dans les bétons armés fortement sollicités, les fondations profondes, les ouvrages de génie civil, les infrastructures et les constructions industrielles. Grâce à sa résistance supérieure et sa fiabilité, il assure une excellente tenue dans le temps, même dans des conditions d’usage intensives.",
        "image": null,
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "9ea6d3b1-febc-48a6-8d59-e40fd716f80a",
            "code": "LF-50-KG-9EA6",
            "name": "50 KG",
            "description": "Le ciment 55 en sac de 50 kg est un ciment à très haute résistance, conçu pour les ouvrages exigeant des performances mécaniques élevées et une durabilité renforcée. Il est particulièrement utilisé dans les bétons armés fortement sollicités, les fondations profondes, les ouvrages de génie civil, les infrastructures et les constructions industrielles. Grâce à sa résistance supérieure et sa fiabilité, il assure une excellente tenue dans le temps, même dans des conditions d’usage intensives.",
            "unit": "SAC",
            "measureName": null,
            "image": null,
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "5ab536b3-7bd6-49c3-98d4-6c46d6006465",
        "name": "Ciment 35 Mpa",
        "description": "Le ciment 35 MPa est un ciment polyvalent destiné aux travaux courants de construction et de maçonnerie. Il offre une bonne résistance mécanique, une excellente adhérence et une mise en œuvre facile pour la réalisation de bétons, mortiers, fondations, chapes et ouvrages en béton armé. Adapté aux chantiers résidentiels et professionnels.",
        "image": null,
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "5ab536b3-7bd6-49c3-98d4-6c46d6006465",
            "code": "LF-CIMENT-35-MPA-5AB5",
            "name": "Ciment 35 Mpa",
            "description": "Le ciment 35 MPa est un ciment polyvalent destiné aux travaux courants de construction et de maçonnerie. Il offre une bonne résistance mécanique, une excellente adhérence et une mise en œuvre facile pour la réalisation de bétons, mortiers, fondations, chapes et ouvrages en béton armé. Adapté aux chantiers résidentiels et professionnels.",
            "unit": "SAC",
            "measureName": null,
            "image": null,
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "857a6fca-b538-44d5-8f21-92efc941cd33",
        "name": "Ciment 45 Mpa",
        "description": "Le ciment 45 MPa est un ciment haute résistance conçu pour les ouvrages nécessitant des performances mécaniques élevées. Il assure une excellente durabilité, une prise efficace et une grande résistance à la compression, idéal pour les structures en béton armé, fondations, poteaux, dalles et travaux de génie civil exigeants.",
        "image": null,
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "857a6fca-b538-44d5-8f21-92efc941cd33",
            "code": "LF-CIMENT-45-MPA-857A",
            "name": "Ciment 45 Mpa",
            "description": "Le ciment 45 MPa est un ciment haute résistance conçu pour les ouvrages nécessitant des performances mécaniques élevées. Il assure une excellente durabilité, une prise efficace et une grande résistance à la compression, idéal pour les structures en béton armé, fondations, poteaux, dalles et travaux de génie civil exigeants.",
            "unit": "SAC",
            "measureName": null,
            "image": null,
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "dcd62589-166f-4083-aa9e-0637063fdbf7",
        "name": "Ciment 55 Mpa",
        "description": "Le ciment 55 MPa est un ciment à très haute résistance destiné aux ouvrages techniques et aux constructions nécessitant des performances mécaniques supérieures. Il garantit une résistance rapide et durable, idéal pour les structures fortement sollicitées, les ouvrages industriels, les préfabrications, les ponts et les travaux de génie civil de grande envergure.",
        "image": null,
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "dcd62589-166f-4083-aa9e-0637063fdbf7",
            "code": "LF-CIMENT-55-MPA-DCD6",
            "name": "Ciment 55 Mpa",
            "description": "Le ciment 55 MPa est un ciment à très haute résistance destiné aux ouvrages techniques et aux constructions nécessitant des performances mécaniques supérieures. Il garantit une résistance rapide et durable, idéal pour les structures fortement sollicitées, les ouvrages industriels, les préfabrications, les ponts et les travaux de génie civil de grande envergure.",
            "unit": "SAC",
            "measureName": null,
            "image": null,
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      }
    ]
  },
  {
    "id": "27fc01a1-8f8c-45ea-a16c-3dd5dd7c52ae",
    "name": "Agrégats (Carrières)",
    "position": 5,
    "image": "/lf/uploads/categories/img-2426/img-2426-1782216382367.jpg",
    "accent": "ochre",
    "productCount": 3,
    "varianteCount": 3,
    "products": [
      {
        "id": "6cc6a7e3-e92e-40ab-8e80-23646eef5f46",
        "name": "Gravier",
        "description": "Le gravier est un granulat minéral d'origine naturelle ou issue du concassage de roches massives, caractérisé par une granulométrie comprise entre 2 et 63 mm. C'est l'un des matériaux de base les plus consommés dans le secteur du BTP, intervenant dans la fabrication du béton armé, des mortiers, des couches de fondation en voirie, des drainages et des remblais techniques. Au Maroc, le gravier est principalement issu de carrières de roches calcaires ou basaltiques, concassé et criblé en plusieurs fractions granulométriques selon les usages. Sa qualité est déterminée par sa dureté, sa propreté, sa forme — roulée ou concassée — et sa granulométrie, qui conditionnent directement la résistance mécanique et la maniabilité des bétons dans lesquels il entre.",
        "image": "/lf/uploads/items/30166068-30099038-graviers-de-carriere/30166068-30099038-graviers-de-carriere-1782216938536.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "6cc6a7e3-e92e-40ab-8e80-23646eef5f46",
            "code": "LF-GRAVIER-6CC6",
            "name": "Gravier",
            "description": "Le gravier est un granulat minéral d'origine naturelle ou issue du concassage de roches massives, caractérisé par une granulométrie comprise entre 2 et 63 mm. C'est l'un des matériaux de base les plus consommés dans le secteur du BTP, intervenant dans la fabrication du béton armé, des mortiers, des couches de fondation en voirie, des drainages et des remblais techniques. Au Maroc, le gravier est principalement issu de carrières de roches calcaires ou basaltiques, concassé et criblé en plusieurs fractions granulométriques selon les usages. Sa qualité est déterminée par sa dureté, sa propreté, sa forme — roulée ou concassée — et sa granulométrie, qui conditionnent directement la résistance mécanique et la maniabilité des bétons dans lesquels il entre.",
            "unit": "M3",
            "measureName": null,
            "image": "/lf/uploads/items/30166068-30099038-graviers-de-carriere/30166068-30099038-graviers-de-carriere-1782216938536.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "983e1305-2541-4eba-ada6-e93c38f19f60",
        "name": "Sable",
        "description": "Le sable est un granulat fin naturel ou concassé, dont les particules sont comprises entre 0 et 4 mm. C'est l'un des matériaux les plus consommés dans le BTP marocain, entrant dans la composition du béton, des mortiers de maçonnerie, des enduits, des chapes et des remblais fins. Sa qualité est déterminée par sa propreté, sa granulométrie, sa forme — roulée ou concassée — et sa teneur en fines argileuses, qui conditionnent directement la résistance et la durabilité des ouvrages dans lesquels il est incorporé. Au Maroc, trois sources principales coexistent sur le marché : les sables de carrière concassés, les sables de rivière alluvionnaires et les sables de mer lavés, chacun présentant des caractéristiques et des usages distincts.",
        "image": "/lf/uploads/items/img-2427/img-2427-1782217497642.jpg",
        "minPrice": 300,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "4238cf85-7702-4ca9-ab14-247bdade7fa2",
            "code": "LF-SABLE-SOURIRA-4238",
            "name": "Sable sourira",
            "description": "",
            "unit": "M3",
            "measureName": "Mètre cube",
            "image": "/lf/uploads/items/images/images-1782318403200.jpg",
            "price": 300,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "Cap Bedouza",
                "supplierLogo": "/lf/uploads/suppliers/dsc00170jpg-64eca035e8be5/dsc00170jpg-64eca035e8be5-1782311868062.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 30,
                "quantityInStock": 130
              },
              {
                "supplierName": "Souiria",
                "supplierLogo": "/lf/uploads/suppliers/dsc00170jpg-64eca035e8be5/dsc00170jpg-64eca035e8be5-1782311919195.jpg",
                "price": 310,
                "currencyCode": "MAD",
                "minOrderQuantity": 35,
                "quantityInStock": 300
              }
            ]
          }
        ]
      },
      {
        "id": "1f015a4b-7ec1-4a84-9525-9058996df583",
        "name": "Tout-venant",
        "description": "Le tout-venant est un matériau granulaire non trié issu directement du concassage primaire de roches massives ou de l'extraction en carrière, contenant l'ensemble des fractions granulométriques sans criblage sélectif. C'est le matériau de terrassement et de viabilisation le plus consommé et le plus économique du secteur BTP au Maroc. Il intervient en couche de forme, en remblai technique, en plateforme de chantier et en sous-couche de voirie. Sa granulométrie étendue et non contrôlée le rend inadapté à la fabrication de béton structurel, mais sa capacité portante après compactage en fait un matériau de fondation incontournable pour les infrastructures routières, les parkings et les dallages industriels.",
        "image": "/lf/uploads/items/img-2428/img-2428-1782217856418.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "1f015a4b-7ec1-4a84-9525-9058996df583",
            "code": "LF-TOUT-VENANT-1F01",
            "name": "Tout-venant",
            "description": "Le tout-venant est un matériau granulaire non trié issu directement du concassage primaire de roches massives ou de l'extraction en carrière, contenant l'ensemble des fractions granulométriques sans criblage sélectif. C'est le matériau de terrassement et de viabilisation le plus consommé et le plus économique du secteur BTP au Maroc. Il intervient en couche de forme, en remblai technique, en plateforme de chantier et en sous-couche de voirie. Sa granulométrie étendue et non contrôlée le rend inadapté à la fabrication de béton structurel, mais sa capacité portante après compactage en fait un matériau de fondation incontournable pour les infrastructures routières, les parkings et les dallages industriels.",
            "unit": "M3",
            "measureName": null,
            "image": "/lf/uploads/items/img-2428/img-2428-1782217856418.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      }
    ]
  },
  {
    "id": "4eb2af95-5b19-4f78-8d73-d9e67b3f68e4",
    "name": "Colles",
    "position": 5,
    "image": "/lf/uploads/categories/camion-colle-carrellage/camion-colle-carrellage-1778166282360.jpg",
    "accent": "clay",
    "productCount": 10,
    "varianteCount": 35,
    "products": [
      {
        "id": "93427d1b-48b6-4d7f-87ef-af9c10bc505c",
        "name": "TRADICEM X 25KG",
        "description": "Mortier colle pour la pose de revêtements céramiques et assimilés (carrelages, mosaïques) en sols et murs sur supports divers : béton banché, dalles béton, enduits de ciments, chapes ciment.",
        "image": "/lf/uploads/catalog/colle-tradisim-25/colle-tradisim-25-1778164770472.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "93427d1b-48b6-4d7f-87ef-af9c10bc505c",
            "code": "LF-TRADICEM-X-25KG-9342",
            "name": "TRADICEM X 25KG",
            "description": "Mortier colle pour la pose de revêtements céramiques et assimilés (carrelages, mosaïques) en sols et murs sur supports divers : béton banché, dalles béton, enduits de ciments, chapes ciment.",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/colle-tradisim-25/colle-tradisim-25-1778164770472.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "b80e8cdc-2fc0-41df-b61e-3af5d110e2d9",
        "name": "Webercol classic",
        "description": "Mortier-colle intérieur (CE) Murs et sols interieurs.   Bonne maniabilité.  Sans décrochement.  facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger temps de glissement manuelle Support sols à base du ciment, murs.",
        "image": "/lf/uploads/catalog/webercol-classic-0-png/webercol-classic-0-png-1778165977792.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "b80e8cdc-2fc0-41df-b61e-3af5d110e2d9",
            "code": "LF-WEBERCOL-CLASSIC-B80E",
            "name": "Webercol classic",
            "description": "Mortier-colle intérieur (CE) Murs et sols interieurs.   Bonne maniabilité.  Sans décrochement.  facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger temps de glissement manuelle Support sols à base du ciment, murs.",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercol-classic-0-png/webercol-classic-0-png-1778165977792.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "747f2957-002f-40e9-9775-af36d720927d",
        "name": "Webercol duo",
        "description": "Mortier-colle pour intérieur et extérieur Mortier-colle pour carrelage, mosaïque, céramique, etc., pour sols intérieurs ou extérieurs et murs intérieurs.   Double utilisation Prêt à l'emploi : ajout seulement d'eau Temps d'ajustement : 30 minutes facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger résistant agression chimique temps de glissement manuelle malaxeur Support sous-enduit avec mortier de sable et ciment, sols à base du ciment",
        "image": "/lf/uploads/catalog/webercol-duo-bd-jpg/webercol-duo-bd-jpg-1778166718041.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "747f2957-002f-40e9-9775-af36d720927d",
            "code": "LF-WEBERCOL-DUO-747F",
            "name": "Webercol duo",
            "description": "Mortier-colle pour intérieur et extérieur Mortier-colle pour carrelage, mosaïque, céramique, etc., pour sols intérieurs ou extérieurs et murs intérieurs.   Double utilisation Prêt à l'emploi : ajout seulement d'eau Temps d'ajustement : 30 minutes facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger résistant agression chimique temps de glissement manuelle malaxeur Support sous-enduit avec mortier de sable et ciment, sols à base du ciment",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercol-duo-bd-jpg/webercol-duo-bd-jpg-1778166718041.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "a603ba18-b606-459b-8118-68b092791389",
        "name": "Webercol dur",
        "description": "Mortier-colle hautes performances (C1TE) Pour collage de carrelage, marbre, mosaïque, pâte de verre, etc., pour sols intérieurs ou extérieurs et sur murs intérieurs.  facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger temps de glissement manuelle",
        "image": "/lf/uploads/catalog/webercol-dur-png/webercol-dur-png-1778165777593.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "a603ba18-b606-459b-8118-68b092791389",
            "code": "LF-WEBERCOL-DUR-A603",
            "name": "Webercol dur",
            "description": "Mortier-colle hautes performances (C1TE) Pour collage de carrelage, marbre, mosaïque, pâte de verre, etc., pour sols intérieurs ou extérieurs et sur murs intérieurs.  facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger temps de glissement manuelle",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercol-dur-png/webercol-dur-png-1778165777593.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "9c3be7b3-6051-4573-85d3-c3c62a83988d",
        "name": "Webercol flex",
        "description": "Mortier-colle déformable à très hautes performances Mortier-colle pour façades, sols de grandes superficies etc., collage de tous types de carrelages, marbre, granit... de tous formats, de toutes porosités.  Utilisable à l’extérieur et à l’intérieur. Utilisable sur sols chauffants. Apte pour immersion. facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger résistant agression chimique temps de glissement manuelle.",
        "image": "/lf/uploads/catalog/webercol-flex-png/webercol-flex-png-1778165880675.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "9c3be7b3-6051-4573-85d3-c3c62a83988d",
            "code": "LF-WEBERCOL-FLEX-9C3B",
            "name": "Webercol flex",
            "description": "Mortier-colle déformable à très hautes performances Mortier-colle pour façades, sols de grandes superficies etc., collage de tous types de carrelages, marbre, granit... de tous formats, de toutes porosités.  Utilisable à l’extérieur et à l’intérieur. Utilisable sur sols chauffants. Apte pour immersion. facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger résistant agression chimique temps de glissement manuelle.",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercol-flex-png/webercol-flex-png-1778165880675.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "25b70888-5d14-48e8-b286-b1b9a57e8a45",
        "name": "Webercol lanic",
        "description": "Mortier-colle adhérence élevée tous supports Pour la pose de carreaux céramiques, marbre, pierre naturelle, avec ou sans absorption, de petit et grand format, et spécialement grès-cérame.  Pour revêtements de sols extérieurs et intérieurs et murs intérieurs.   facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger résistant agression chimique temps de glissement manuelle Support sols à base du ciment, béton, plaques de plâtre, panneaux préfabriqués de plâtre",
        "image": "/lf/uploads/catalog/webercol-lanic-png/webercol-lanic-png-1778166104209.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "25b70888-5d14-48e8-b286-b1b9a57e8a45",
            "code": "LF-WEBERCOL-LANIC-25B7",
            "name": "Webercol lanic",
            "description": "Mortier-colle adhérence élevée tous supports Pour la pose de carreaux céramiques, marbre, pierre naturelle, avec ou sans absorption, de petit et grand format, et spécialement grès-cérame.  Pour revêtements de sols extérieurs et intérieurs et murs intérieurs.   facile à appliquer séchage rapide prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger résistant agression chimique temps de glissement manuelle Support sols à base du ciment, béton, plaques de plâtre, panneaux préfabriqués de plâtre",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercol-lanic-png/webercol-lanic-png-1778166104209.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "ef13bc16-aec4-43dc-9f8b-ed45c2de189e",
        "name": "Webercolor junta ancha",
        "description": "Mortier pour joints de carrelage larges et décoratifs de 3 à 15 mm Mortier pour la réalisation de joints de carrelage de 3-15 mm.  Utiliser à l’intérieur et à l’extérieur. Application en pâte. 16 couleurs disponibles. facile à appliquer séchage rapide laisse respirer le support facile à mélanger sans odeur résistant agression chimique manuelle",
        "image": "/lf/uploads/catalog/webercolor-junta-ancha-png/webercolor-junta-ancha-png-1778166979151.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "ef13bc16-aec4-43dc-9f8b-ed45c2de189e",
            "code": "LF-WEBERCOLOR-JUNTA-ANCHA-EF13",
            "name": "Webercolor junta ancha",
            "description": "Mortier pour joints de carrelage larges et décoratifs de 3 à 15 mm Mortier pour la réalisation de joints de carrelage de 3-15 mm.  Utiliser à l’intérieur et à l’extérieur. Application en pâte. 16 couleurs disponibles. facile à appliquer séchage rapide laisse respirer le support facile à mélanger sans odeur résistant agression chimique manuelle",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercolor-junta-ancha-png/webercolor-junta-ancha-png-1778166979151.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "80a59ee7-d691-43fc-9464-c50eb4121e1e",
        "name": "Webercolor junta fina",
        "description": "Mortier pour joints de carrelage minces Réalisation de joints de carrelage de jusqu’à 3 mm de largeur. À partir de 1-1,5 mm, jointoiement en consistance pâte. Délai pour nettoyer : 45-60 min. facile à appliquer prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger sans odeur manuelle",
        "image": "/lf/uploads/catalog/webercolor-junta-fina-png/webercolor-junta-fina-png-1778166821502.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "80a59ee7-d691-43fc-9464-c50eb4121e1e",
            "code": "LF-WEBERCOLOR-JUNTA-FINA-80A5",
            "name": "Webercolor junta fina",
            "description": "Mortier pour joints de carrelage minces Réalisation de joints de carrelage de jusqu’à 3 mm de largeur. À partir de 1-1,5 mm, jointoiement en consistance pâte. Délai pour nettoyer : 45-60 min. facile à appliquer prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger sans odeur manuelle",
            "unit": "SAC",
            "measureName": null,
            "image": "/lf/uploads/catalog/webercolor-junta-fina-png/webercolor-junta-fina-png-1778166821502.jpg",
            "price": null,
            "currencyCode": "MAD",
            "stockStatus": null,
            "offers": []
          }
        ]
      },
      {
        "id": "ca69eff0-7c20-4417-b7d0-b972d6db220b",
        "name": "Webercolor PREMIUM FINA",
        "description": "Joint flexible ultra fin avec additifs silicone. Mortier flexible ultrafin avec additifs silicones pour réaliser des joints jusqu'à 10 mm de large dans des carreaux de toute taille et absorption. Formule Triple + : Joint avec une texture plus fine, permet plus de largeur et a plus de dureté. Pour sols et revêtements intérieurs et extérieurs. Convient au chauffage par le sol.  facile à appliquer prêt à l'emploi résistant au glissement ajout d'eau seulement facile à mélanger sans odeur manuelle",
        "image": "/lf/uploads/catalog/webercolor-premium-fina-png/webercolor-premium-fina-png-1778167377303.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "7acefbfc-8464-4aab-b676-b7e5de02d740",
            "code": "LF-BEIGE-7ACE",
            "name": "Beige",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-beige-jpg/col-webercolor-premium-beige-jpg-1778170370163.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "bc3e515f-a10e-4199-bd94-af451bc6c83c",
            "code": "LF-BEIGE-CLAIR-BC3E",
            "name": "Beige Clair",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-beige-claro-jpg/col-webercolor-premium-beige-claro-jpg-1778170413869.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "82db8cea-fc10-45fd-809e-5be4cd48c205",
            "code": "LF-BLANC-82DB",
            "name": "Blanc",
            "description": "",
            "unit": "PIECE",
            "measureName": "Seau 5KG",
            "image": "/lf/uploads/items/blanc/blanc-1778168584321.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "ac66d6fc-bd09-44d1-8ebe-561068cc4663",
            "code": "LF-BRUN-AC66",
            "name": "Brun",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-pardo-jpg/col-webercolor-pardo-jpg-1778170307645.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "abc980ba-c4a5-4799-a34d-dd4d70f5c7ea",
            "code": "LF-CACAO-ABC9",
            "name": "Cacao",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-cacao-jpg/col-webercolor-cacao-jpg-1778169174556.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "dc290de4-ebd1-428e-ad68-20a962f733ae",
            "code": "LF-CAFE-DC29",
            "name": "Café",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-cafe-jpg-1/col-webercolor-cafe-jpg-1-1778169504420.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "42ec661f-d696-4d78-aac0-de6a6c0b01d2",
            "code": "LF-CANNELLE-42EC",
            "name": "Cannelle",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-canela-jpg-png/col-webercolor-canela-jpg-png-1778169665921.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "c1ecd369-e77a-4cd2-ab51-083bdb190ac7",
            "code": "LF-CARAMEL-C1EC",
            "name": "Caramel",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-caramelo-jpg/col-webercolor-caramelo-jpg-1778169702596.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "726b733b-10dc-4cc0-977e-ee654b8de9b9",
            "code": "LF-CELESTE-726B",
            "name": "Celeste",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-celeste-jpg/col-webercolor-celeste-jpg-1778169933841.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "08ba4252-9141-498d-955d-7f55983372ff",
            "code": "LF-CHOCOLAT-08BA",
            "name": "Chocolat",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-chocolate-jpg/col-webercolor-premium-chocolate-jpg-1778170448970.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "97048481-f9f7-404d-b423-d40503238fca",
            "code": "LF-CREMA-9704",
            "name": "Crema",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-crema-jpg/col-webercolor-crema-jpg-1778169040554.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "196ef2ac-27e4-42e5-ac95-04eaa2918d83",
            "code": "LF-CEDRE-196E",
            "name": "Cèdre",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-cedro-jpg/col-webercolor-cedro-jpg-1778169874569.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "dd03d66a-d5c6-4d06-b660-8ba3ebb01488",
            "code": "LF-EAU-DD03",
            "name": "Eau",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-agua-jpg/col-webercolor-agua-jpg-1778169413616.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "c5ffc68a-c886-49d0-a59a-0bf54f70d0bf",
            "code": "LF-GRAPHITE-C5FF",
            "name": "Graphite",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-grafito-jpg/col-webercolor-premium-grafito-jpg-1778170489412.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "f2465170-082f-48c9-a339-53f5aea00814",
            "code": "LF-LAVANDE-F246",
            "name": "Lavande",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-lavanda-jpg/col-webercolor-lavanda-jpg-1778170083132.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "1d8d5e13-a072-4bb4-af63-2cee86556e4c",
            "code": "LF-LINO-1D8D",
            "name": "Lino",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-lino-jpg/col-webercolor-lino-jpg-1778170181676.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "845f5881-ad90-432d-8b78-593291ff3be9",
            "code": "LF-MARINO-845F",
            "name": "Marino",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-marino-jpg/col-webercolor-marino-jpg-1778170221763.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "586b6214-89d3-4705-8102-050ea0fc9bc1",
            "code": "LF-MENTHE-586B",
            "name": "Menthe",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-menta-jpg/col-webercolor-premium-menta-jpg-1778170542705.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "737a2ce1-b147-49e4-a022-4d712f289c0c",
            "code": "LF-OS-737A",
            "name": "Os",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-hueso-jpg/col-webercolor-hueso-jpg-1778170054914.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "b897c225-b33f-4600-949e-e9a9f0d10921",
            "code": "LF-PERLE-B897",
            "name": "Perle",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-perla-jpg/col-webercolor-premium-perla-jpg-1778170574880.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "a44a057e-50f5-4504-b67c-85c3ba1c98a9",
            "code": "LF-PIERRE-A44A",
            "name": "Pièrre",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-piedra-jpg-1/col-webercolor-premium-piedra-jpg-1-1778170646115.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "b1684346-76fb-4241-bb2d-f60cad6e1451",
            "code": "LF-PLATA-B168",
            "name": "Plata",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-plata-0-jpg-png/col-webercolor-premium-plata-0-jpg-png-1778170702182.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "63b5136f-fe76-4168-a5bd-1db2df52387d",
            "code": "LF-PLATINE-63B5",
            "name": "Platine",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-platino-jpg/col-webercolor-platino-jpg-1778170344360.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "dbab1afa-a382-4c58-a186-24404004ab4f",
            "code": "LF-SIENA-DBAB",
            "name": "Siena",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-siena-jpg-1/col-webercolor-siena-jpg-1-1778170805247.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "3d6464e9-060f-4e88-a583-af4836146495",
            "code": "LF-WENGUE-3D64",
            "name": "Wengue",
            "description": "",
            "unit": "PIECE",
            "measureName": "Sac 3KG",
            "image": "/lf/uploads/items/col-webercolor-premium-wenge-0-jpg/col-webercolor-premium-wenge-0-jpg-1778170738579.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          }
        ]
      },
      {
        "id": "7b4efd07-8d27-45cb-a7ab-a3095ca9859a",
        "name": "Weberepox easy",
        "description": "Mortier époxy antiacide Mortier époxy pour la pose et rejointoiement de céramique, sur murs et sols.  Pour joints entre carreaux de 2-15 mm en : piscines, industries chimiques et alimentaires, laboratoires, hôpitaux, ateliers, etc. Matériel de prise avec une adhérence exceptionnelle et résistance mécanique élevée. En extérieur et intérieur. facile à appliquer séchage rapide laisse respirer le support résistant au glissement facile à mélanger sans odeur résistant agression chimique manuelle",
        "image": "/lf/uploads/catalog/weberepox-easy-jpg/weberepox-easy-jpg-1778167189796.jpg",
        "minPrice": null,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "320ab35c-1a7f-4fc4-ab62-861ec1de5f25",
            "code": "LF-GRIS-320A",
            "name": "Gris",
            "description": "",
            "unit": "PIECE",
            "measureName": "Seau 5KG",
            "image": "/lf/uploads/items/gris-jpg/gris-jpg-1778168809158.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          },
          {
            "id": "6ad7729a-f320-473e-ad55-e19f5f8a7fec",
            "code": "LF-NOIR-6AD7",
            "name": "Noir",
            "description": "",
            "unit": "PIECE",
            "measureName": "Seau 5KG",
            "image": "/lf/uploads/items/noir-jpg/noir-jpg-1778168664892.jpg",
            "price": 0,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": []
          }
        ]
      }
    ]
  },
  {
    "id": "262904d0-b668-4139-9bf5-494b41601f55",
    "name": "Maçonnerie",
    "position": 6,
    "image": "/lf/uploads/categories/camion-brique/camion-brique-1778166449409.jpg",
    "accent": "teal",
    "productCount": 3,
    "varianteCount": 10,
    "products": [
      {
        "id": "3e32cb89-1b2f-4d9c-aa6b-600ef4b5e451",
        "name": "Hourdis",
        "description": "Le hourdis en béton est un entrevous destiné aux planchers à poutrelles précontraintes. Posé entre les poutrelles, il joue le rôle de coffrage perdu et supporte la dalle de compression coulée sur place. Fabriqué en béton vibré, il offre une bonne résistance mécanique et garantit un plancher solide, stable et durable. Facile à poser et compatible avec la majorité des systèmes de planchers du marché, il convient aussi bien à la construction neuve qu'à la rénovation, pour tous types de bâtiments résidentiels et commerciaux.",
        "image": "/lf/uploads/items/img-2430/img-2430-1782312267769.jpg",
        "minPrice": 7,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "b3fd85e0-0c68-4d59-8902-36f48703fd5e",
            "code": "LF-HOURDIS-EN-BOIS-AGGLOM-B3FD",
            "name": "Hourdis en bois aggloméré",
            "description": "Le hourdis en bois aggloméré partage les mêmes caractéristiques légères que le polystyrène, mais son isolation thermique est moins performante, ce qui nécessite l'intégration d'un isolant thermique et acoustique complémentaire dans la structure du plancher. Il est moins courant et utilisé principalement en rénovation ou lorsque l'on cherche à alléger la structure, notamment pour limiter les charges sur des murs existants et faciliter certaines interventions en site occupé.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": null,
            "price": 50,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 50,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          },
          {
            "id": "2d4b39f6-e1d4-4efc-976c-5d39a14d4232",
            "code": "LF-HOURDIS-EN-BETON-2D4B",
            "name": "Hourdis en béton",
            "description": "Fabriqué en béton vibré, il sert de coffrage perdu entre les poutrelles et supporte la dalle de compression coulée sur place. Il présente une portée entre 8 et 10 m et des dimensions courantes de 12 x 57 x 125 cm, avec une charge d'exploitation relativement élevée. Robuste et économique, il est adapté à tous types de bâtiments résidentiels et commerciaux.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": null,
            "price": 7,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 7,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          },
          {
            "id": "b36bce88-d199-4f16-9082-bcebc6624642",
            "code": "LF-HOURDIS-EN-POLYSTYRENE-B36B",
            "name": "Hourdis en polystyrène",
            "description": "Le hourdis en polystyrène est plus léger que le béton et constitue un bon isolant thermique. Il est largement utilisé en construction neuve, notamment pour les planchers sur vide sanitaire, et son principal avantage est de limiter les ponts thermiques sans ajouter d'isolant sous la dalle. Il est particulièrement adapté aux exigences de la réglementation thermique RTCM au Maroc.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": null,
            "price": 30,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 30,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          },
          {
            "id": "8144ce40-a0a2-41b7-82c1-40df4f58cae2",
            "code": "LF-HOURDIS-A-RUPTURE-DE-P-8144",
            "name": "Hourdis à rupture de pont thermique",
            "description": "Le hourdis à rupture de pont thermique est un entrevous composite conçu pour éliminer les transferts de chaleur au niveau des jonctions entre plancher et murs extérieurs. Il intègre des éléments en polystyrène en périphérie de plancher, avec des bandes latérales et longitudinales placées sur les hourdis au droit des murs extérieurs, permettant la diminution de l'épaisseur du plancher sans dalle flottante et une utilisation possible en zone sismique avec renforcement des liaisons plancher/mur. Il répond directement aux exigences de la réglementation thermique RTCM.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": null,
            "price": 70,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 70,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          }
        ]
      },
      {
        "id": "e8a2941b-7686-4a91-bebe-0b6b7d2f0c66",
        "name": "Poutrelles",
        "description": "La poutrelle est l'élément porteur central des systèmes de planchers à poutrelles et entrevous. Fabriquée en béton précontraint, elle reprend les charges de la dalle et les transmet aux appuis structurels. Disponible en plusieurs types et sections selon les portées et les charges à couvrir, elle s'adapte à tous les projets de construction, du bâtiment résidentiel aux ouvrages tertiaires et commerciaux. Vendue au mètre linéaire ou en longueurs fixes, elle se pose rapidement et se combine avec différents types d'entrevous pour former un plancher solide, stable et durable.",
        "image": "/lf/uploads/items/img-2431/img-2431-1782312282761.jpg",
        "minPrice": 25,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "9c671266-15e8-4ea3-a4a2-7f95bf510df8",
            "code": "LF-LA-POUTRELLE-TREILLIS-9C67",
            "name": "La poutrelle treillis",
            "description": "La poutrelle treillis est composée d'une semelle inférieure en béton préfabriqué et d'un treillis en acier soudé en partie supérieure, formant une armature tridimensionnelle. Sa base pré-enrobée est un talon de section rectangulaire en béton préfabriqué, d'une épaisseur de 4 cm et d'une largeur de 12 cm, dans lequel sont logés les aciers longitudinaux avec des armatures en attente dépassant de 5 cm.  Plus légère que la poutrelle pleine, elle offre une meilleure solidarisation avec la dalle de compression coulée sur place et s'adapte à tous les types de planchers, en neuf comme en rénovation.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": null,
            "price": 35,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 35,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          },
          {
            "id": "0a0e58d4-6f66-4190-95df-a9ad420945cc",
            "code": "LF-POUTRELLE-EN-BOIS-LAME-0A0E",
            "name": "Poutrelle en bois lamellé-collé",
            "description": "La poutrelle en bois lamellé-collé est fabriquée par assemblage de lamelles de bois collées sous pression, dont les fils sont orientés dans le sens de la longueur. Ce procédé industriel élimine les défauts naturels du bois massif et confère à l'élément une résistance mécanique élevée, une stabilité dimensionnelle et une excellente tenue au feu. Elle est utilisée pour les charpentes, les planchers bois et les structures apparentes à grande portée. Au Maroc, son usage reste limité mais progresse avec le développement des constructions écoresponsables et des projets hôteliers ou touristiques haut de gamme.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": null,
            "price": 1800,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 1800,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          },
          {
            "id": "316249ef-188b-46f8-89e8-a55fff04b862",
            "code": "LF-POUTRELLE-EN-BETON-PRE-3162",
            "name": "Poutrelle en béton précontraint",
            "description": "La poutrelle en béton précontraint est un élément structurel fabriqué en usine, conçu pour constituer l'ossature porteuse des planchers à poutrelles et entrevous. Sa résistance est assurée par une technique de précontrainte par adhérence, consistant à intégrer des câbles ou torons en acier tendus dans la masse du béton avant son durcissement. Cette mise en tension interne confère à la poutrelle une capacité de charge et une résistance à la flexion nettement supérieures à celles d'une poutrelle en béton armé classique, pour un encombrement réduit.\n\nParfaitement droite et précise dans ses dimensions, elle garantit une mise en œuvre rapide et un plancher régulier sans reprise de nivellement. Elle est compatible avec tous les types d'entrevous disponibles sur le marché — béton, polystyrène ou à rupture de pont thermique — et convient aussi bien à la construction neuve qu'à la rénovation. Disponible en plusieurs hauteurs de section et vendue au mètre linéaire ou en longueurs fixes, elle s'adapte aux portées et aux charges propres à chaque projet, du logement individuel aux bâtiments collectifs et commerciaux.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": null,
            "price": 25,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 25,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          },
          {
            "id": "9c02449f-dead-402f-b79e-9a9f7cd256c9",
            "code": "LF-POUTRELLE-MIXTE-ACIER--9C02",
            "name": "Poutrelle mixte acier-béton",
            "description": "La poutrelle mixte acier-béton associe un profilé métallique laminé et une section en béton armé ou précontraint, solidarisés par des connecteurs. Cette combinaison exploite les qualités de chaque matériau — la résistance à la traction de l'acier et la résistance à la compression du béton — pour atteindre de très grandes portées et supporter des charges élevées. Elle est principalement utilisée dans les bâtiments industriels, tertiaires et les ouvrages d'infrastructure nécessitant des travées importantes sans appui intermédiaire.",
            "unit": "M",
            "measureName": "Mètre linéaire",
            "image": null,
            "price": 300,
            "currencyCode": "MAD",
            "stockStatus": "EN_STOCK",
            "offers": [
              {
                "supplierName": "zakaria",
                "supplierLogo": "/lf/uploads/suppliers/centre-sidi-othmane800x400-780x400/centre-sidi-othmane800x400-780x400-1777935011648.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 10
              }
            ]
          }
        ]
      },
      {
        "id": "a1067368-a378-4a7e-8758-a3b4d8f5c3f7",
        "name": "Serre Joint Maçon",
        "description": "Le serre-joint maçon est un outil de coffrage incontournable sur les chantiers de gros œuvre au Maroc. Fabriqué en acier galvanisé traité anticorrosion, il assure un maintien ferme et durable des panneaux de coffrage lors du coulage du béton, même en conditions humides ou fortement exposées. Son système de serrage mécanique par vissage permet une fixation rapide et précise, sans outillage spécialisé, et s'adapte à différentes épaisseurs de panneaux — bois, contreplaqué ou banches métalliques. Conçu pour un usage intensif, il est entièrement réutilisable d'un chantier à l'autre, ce qui en fait un investissement rentable pour les maçons, coffreurs et entreprises de construction. Il s'utilise aussi bien pour le coffrage de fondations et semelles filantes que pour le maintien de voiles en béton, de poteaux structurels ou de dalles de plancher. Compatible avec les exigences des chantiers BTP au Maroc, il est disponible en plusieurs dimensions selon le modèle et le type d'ouvrage. Pour une durabilité optimale, il est recommandé de nettoyer l'outil après chaque utilisation, de le stocker à l'abri de l'humidité et d'inspecter régulièrement le filetage et le mécanisme de serrage avant toute mise en œuvre.",
        "image": "/lf/uploads/items/img-2387/img-2387-1781697604940.jpg",
        "minPrice": 25,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "baf9b2d9-44d8-4664-8f6b-730e3ef59124",
            "code": "LF-SERRE-JOINT-MACON-A-FR-BAF9",
            "name": "Serre-joint maçon à frapper",
            "description": "Le serre-joint maçon à frapper fonctionne selon un principe précis : il faut frapper le coulisseau mobile pour le faire glisser sur le rail, ce qui actionne le serrage. Fabriqué en acier forgé, c'est le modèle le plus répandu sur les chantiers marocains pour le maintien des panneaux de coffrage bois lors du coulage du béton. Disponible en plusieurs longueurs : 60, 80 et 100 cm.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/img-2387/img-2387-1781697396836.jpg",
            "price": 25,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 25,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "ddc860f7-0bb6-4568-896f-5393d8e0c879",
            "code": "LF-SERRE-JOINT-MACON-A-VI-DDC8",
            "name": "Serre-joint maçon à vis en acier galvanisé",
            "description": "Le serre-joint maçon à vis en acier galvanisé assure un serrage robuste et durable sur chantier humide grâce à sa protection contre la corrosion et l'oxydation. Son serrage réglable s'adapte à différentes épaisseurs de panneaux de coffrage bois ou contreplaqué, et il est conçu pour être réutilisable sur de multiples projets de construction, avec une installation rapide par vissage sans outillage spécialisé.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/img-2388/img-2388-1781697554742.jpg",
            "price": 55,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIVA industiers",
                "supplierLogo": "/lf/uploads/suppliers/riva-logo/riva-logo-1781650242080.jpg",
                "price": 55,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "b013e4ff-c520-46b1-a979-70f9c4b33811",
    "name": "Etanchéité",
    "position": 8,
    "image": "/lf/uploads/categories/camion-etanchiete/camion-etanchiete-1778168905038.jpg",
    "accent": "cyan",
    "productCount": 3,
    "varianteCount": 9,
    "products": [
      {
        "id": "556a63c4-beb0-4e2f-90d9-b7a92ad4b648",
        "name": "Feuilles d'étanchéité APP Aluminium",
        "description": "La feuille d'étanchéité APP aluminium est une membrane bitumineuse à base de bitume modifié au polypropylène atactique, armée d'une armature polyester haute résistance et dotée d'une autoprotection en feuille d'aluminium laminée sur sa face supérieure. Cette finition métallique constitue sa principale différence avec la membrane simple : elle assure une protection permanente contre les ultraviolets, réfléchit le rayonnement solaire et élimine la nécessité d'une protection rapportée après pose. Grâce à l'effet réfléchissant de l'aluminium, elle réduit significativement l'échauffement de la toiture en été, ce qui en fait la solution particulièrement adaptée aux terrasses non accessibles exposées au soleil intense du climat marocain. Sa pose s'effectue au chalumeau par torchage en pleine adhérence sur support béton primé ou sur sous-couche bitumineuse préalablement soudée. Elle constitue la couche de finition définitive du système d'étanchéité, sans nécessiter de gravillon, de chape ou de tout autre revêtement de protection complémentaire.",
        "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782754379395.jpg",
        "minPrice": 450,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "95ed326d-27d1-4366-b1b6-fbe09d9f0d5e",
            "code": "LF-FEUILLES-D-ETANCHEITE--95ED",
            "name": "Feuilles d'étancheité APP Aluminium 2mm",
            "description": "La feuille APP aluminium 2 mm est la version la plus légère de la gamme autoprotégée. Son faible grammage la destine principalement à l'étanchéité de surfaces peu exposées aux contraintes mécaniques — murs de refend, acrotères, relevés de toiture, protection de fondations en élévation et habillage de joints de dilatation. Elle n'est pas recommandée en couche de finition unique sur toiture-terrasse exposée aux intempéries en raison de son épaisseur insuffisante pour absorber les mouvements structurels et les chocs thermiques. Elle est le plus souvent utilisée en complément d'un système bicouche pour le traitement des points singuliers et des zones de raccordement.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782754453381.jpg",
            "price": 450,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 450,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 475,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 480,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "abd43d0f-e356-4ef3-be59-cf8c1fe810c7",
            "code": "LF-FEUILLES-D-ETANCHEITE--ABD4",
            "name": "Feuilles d'étancheité APP Aluminium 3mm",
            "description": "La feuille APP aluminium 3 mm est utilisée en couche de finition sur les toitures-terrasses non accessibles de faible à moyenne sollicitation — maisons individuelles, terrasses techniques, combles aménagés et toitures de locaux annexes. Son autoprotection aluminium laminée réfléchit le rayonnement solaire, limite l'échauffement de la toiture en été et protège le bitume des UV sans nécessiter de gravillon ni de protection rapportée. Elle offre un bon rapport performance/coût pour les chantiers résidentiels où la durabilité à long terme est recherchée sans recourir à l'épaisseur supérieure.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782754750122.jpg",
            "price": 805,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 805,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 810,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 850,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "18a18e32-0c19-4d2d-9334-1d35d8ba06bb",
            "code": "LF-FEUILLES-D-ETANCHEITE--18A1",
            "name": "Feuilles d'étancheité APP Aluminium 4mm",
            "description": "La feuille APP aluminium 4 mm est la référence professionnelle standard pour les toitures-terrasses non accessibles de bâtiments collectifs, immeubles de bureaux, hôtels et ouvrages tertiaires au Maroc. C'est l'épaisseur la plus consommée sur les grands chantiers pour la couche de finition définitive des systèmes bicouches exposés. Son armature polyester haute résistance associée à la forte épaisseur de bitume modifié APP lui confère une excellente résistance aux déchirures, au poinçonnement et aux cycles de dilatation thermique intenses du climat marocain. L'autoprotection aluminium laminée assure une durée de vie optimale sous exposition directe aux intempéries sans entretien particulier pendant 15 à 20 ans.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782754842810.jpg",
            "price": 995,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 995,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 1050,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 1100,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "3fdf16b6-1763-4c57-80b8-47517d8a186e",
        "name": "Feuilles d'étanchéité APP ardoise gravée",
        "description": "La feuille d'étanchéité APP ardoise gravée est une membrane bitumineuse à base de bitume modifié au polypropylène atactique, armée d'une armature polyester haute résistance et dotée d'une autoprotection en granulés d'ardoise naturelle incrustés à chaud sur sa face supérieure. Cette finition ardoisée constitue sa principale caractéristique : les granulés minéraux protègent le bitume des ultraviolets, résistent aux chocs mécaniques légers, améliorent l'accrochage des revêtements de finition et confèrent à la membrane un aspect esthétique texturé apprécié sur les toitures apparentes. Contrairement à la membrane aluminium qui réfléchit le rayonnement solaire, la finition ardoise absorbe davantage la chaleur mais offre une meilleure résistance mécanique en surface et une adhérence supérieure pour les systèmes avec protection rapportée. Elle est utilisée en couche de finition sur les toitures-terrasses non accessibles, les toitures inclinées, les versants de toiture en pente légère et les terrasses techniques où l'aspect de surface et la durabilité sont des critères prioritaires. Sa pose s'effectue au chalumeau par torchage en pleine adhérence sur sous-couche bitumineuse préalablement soudée ou sur support béton primé.",
        "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782755008932.jpg",
        "minPrice": 480,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "e3c73b61-b5ed-4422-9b86-d33ea471796f",
            "code": "LF-FEUILLES-D-ETANCHEITE--E3C7",
            "name": "Feuilles d'étanchéité APP ardoise gravée 2mm",
            "description": "La feuille APP ardoise gravée 2 mm est la version la plus légère de la gamme autoprotégée à granulés minéraux. Son faible grammage la destine principalement au traitement des points singuliers — relevés de membrane, acrotères, noues, arêtiers et jonctions entre matériaux — où la souplesse et la maniabilité sont prioritaires sur la résistance mécanique. Elle est également utilisée en habillage de joints de dilatation et en protection de murs de refend en élévation. Elle n'est pas recommandée en couche de finition unique sur toiture-terrasse exposée en raison de son épaisseur insuffisante pour absorber les contraintes thermiques et mécaniques à long terme.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782755233055.jpg",
            "price": 480,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 480,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 505,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 520,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "6cb5f0a1-acda-4849-96e1-6fa1e1f059aa",
            "code": "LF-FEUILLES-D-ETANCHEITE--6CB5",
            "name": "Feuilles d'étanchéité APP ardoise gravée 3mm",
            "description": "La feuille APP ardoise gravée 3 mm est utilisée en couche de finition sur les toitures-terrasses non accessibles de bâtiments résidentiels individuels, les toitures en pente légère et les terrasses techniques de faible à moyenne sollicitation mécanique. Ses granulés d'ardoise naturelle incrustés à chaud protègent efficacement le bitume des ultraviolets et des chocs légers, tout en conférant un aspect texturé esthétique sur les surfaces apparentes. Son épaisseur intermédiaire offre un bon rapport performance/coût pour les chantiers résidentiels courants au Maroc, notamment pour les villas et les immeubles de faible hauteur.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782755296883.jpg",
            "price": 870,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 870,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 875,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 950,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "177e030c-599d-4cb6-9367-589c19fea078",
            "code": "LF-FEUILLES-D-ETANCHEITE--177E",
            "name": "Feuilles d'étanchéité APP ardoise gravée 4mm",
            "description": "La feuille APP ardoise gravée 4 mm est la référence professionnelle pour les toitures-terrasses non accessibles de bâtiments collectifs, immeubles de bureaux, hôtels et ouvrages tertiaires au Maroc. C'est l'épaisseur la plus consommée sur les grands chantiers professionnels pour la couche de finition définitive exposée aux intempéries. Son armature polyester haute résistance associée à la forte épaisseur de bitume modifié APP et aux granulés d'ardoise naturelle lui confère une excellente durabilité sous exposition directe au soleil, aux pluies torrentielles hivernales et aux cycles de dilatation thermique intenses du climat marocain. Disponible en plusieurs coloris de granulés — ardoise grise, rouge brique ou verte — selon les références des fournisseurs, elle permet une personnalisation esthétique de la toiture sur les projets haut de gamme.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782755413219.jpg",
            "price": 1100,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 1100,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 1250,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 1280,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "528bf5f7-6338-4deb-b37f-05f744e6d631",
        "name": "Feuilles d'étanchéité APP Simple",
        "description": "La feuille d'étanchéité APP est une membrane bitumineuse à base de bitume modifié au polypropylène atactique (APP), armée d'un voile de verre ou d'une armature polyester selon le modèle. Le bitume APP lui confère une excellente résistance aux UV et aux hautes températures, ce qui en fait le produit le mieux adapté aux conditions climatiques marocaines — toitures-terrasses exposées à un ensoleillement intense et à de forts écarts thermiques entre saison estivale et hivernale. Sa pose s'effectue au chalumeau par soudure thermique, garantissant une adhérence totale au support et une continuité parfaite de l'imperméabilisation.",
        "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782752562657.jpg",
        "minPrice": 300,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "03fc5928-680c-49ac-b392-b8ad96577b5d",
            "code": "LF-FEUILLE-D-ETANCHEITE-A-03FC",
            "name": "Feuille d'étanchéité APP Simple 2mm",
            "description": "Membrane bitumineuse APP de faible épaisseur, utilisée principalement en sous-couche d'accrochage dans les systèmes bicouches ou en protection légère de surfaces non exposées aux intempéries. Son faible grammage la rend plus maniable à la pose et adaptée aux supports planes sans contraintes mécaniques particulières. Elle est également employée pour l'étanchéité des murs enterrés, des fondations et des voiles de sous-sol où l'exposition aux UV et aux charges de surface est nulle.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782753433455.jpg",
            "price": 300,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 300,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 310,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "5c92fb30-4867-47c0-8fb4-231b95b17870",
            "code": "LF-FEUILLE-D-ETANCHEITE-A-5C92",
            "name": "Feuille d'étanchéité APP Simple 4mm",
            "description": "La feuille d'étanchéité APP simple 4 mm est une membrane bitumineuse monocouche à base de bitume modifié au polypropylène atactique, armée d'une armature polyester haute résistance. L'appellation \"simple\" indique une membrane sans autoprotection de surface, livrée avec une face lisse ou sablée destinée à recevoir une protection rapportée — gravillon, chape ou dallage — après pose. C'est la référence la plus utilisée en couche de finition dans les systèmes bicouches sur toitures-terrasses au Maroc, grâce à sa forte épaisseur qui lui confère une excellente résistance mécanique au poinçonnement, aux passages piétons et aux contraintes thermiques liées à l'ensoleillement intense du climat marocain. Sa pose s'effectue au chalumeau par torchage en pleine adhérence sur support béton primé ou sur sous-couche bitumineuse préalablement soudée.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782753919382.jpg",
            "price": 650,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 650,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 680,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 700,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "564c02ac-d24c-41c9-aa6a-ad7dd453260d",
            "code": "LF-FEUILLES-D-ETANCHEITE--564C",
            "name": "Feuilles d'étancheité APP Simple 3mm",
            "description": "La feuille d'étanchéité APP simple 3 mm est une membrane bitumineuse monocouche à base de bitume modifié au polypropylène atactique, armée d'un voile de verre ou d'une armature polyester. L'appellation \"simple\" désigne une membrane sans autoprotection de surface — ni aluminium ni granuler ardoise — livrée avec une face lisse ou légèrement sablée, destinée à être recouverte par une protection rapportée après pose. Elle est utilisée en sous-couche dans les systèmes bicouches APP ou SBS sur toitures-terrasses, en étanchéité de fondations et de murs enterrés, ou en monocouche sur des surfaces protégées par une chape, un dallage ou un gravillon de lestage. Sa pose s'effectue au chalumeau par torchage, en pleine adhérence sur le support béton préalablement primé.",
            "unit": "PIECE",
            "measureName": "Rouleau de 10m²",
            "image": "/lf/uploads/items/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane/industrial-eco-friendly-water-resistant-torch-on-sbs-app-sheet-modified-bituminous-asphalt-bitumen-waterproof-roofing-membrane-1782753788483.jpg",
            "price": 500,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Afrique Etancheite AFRIFLEX",
                "supplierLogo": "/lf/uploads/suppliers/images-9/images-9-1782146436218.jpg",
                "price": 500,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Bitulife",
                "supplierLogo": "/lf/uploads/suppliers/images-3/images-3-1782146329274.jpg",
                "price": 505,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Danosa",
                "supplierLogo": "/lf/uploads/suppliers/images-8/images-8-1782146371697.jpg",
                "price": 510,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "e68bb484-90bf-436e-b872-ddb07e61b37d",
    "name": "Isolation",
    "position": 9,
    "image": "/lf/uploads/categories/worker-hands-insulating-rock-wool-in-wooden-frame-0-jpg-webp/worker-hands-insulating-rock-wool-in-wooden-frame-0-jpg-webp-1782762594051.jpg",
    "accent": "emerald",
    "productCount": 10,
    "varianteCount": 42,
    "products": [
      {
        "id": "dbf93e21-c605-4a0b-8227-6c12ec16a6db",
        "name": "Caisson isolant armaturé",
        "description": "Le caisson isolant est un coffrage perdu préfabriqué en polystyrène, doté d'une armature intégrée en treillis d'acier galvanisé de 4 mm, destiné à la réalisation de planchers réticulés en béton armé. Sa structure en caisson crée un réseau de nervures croisées entre lesquelles le béton est coulé, formant un plancher allégé à double sens de portée. L'armature en treillis galvanisé intégrée directement dans le caisson simplifie la mise en œuvre sur chantier en garantissant un positionnement précis du ferraillage des nervures, tout en réduisant les temps de pose par rapport à un ferraillage manuel traditionnel. Il est utilisé pour les planchers de grande portée nécessitant un allègement structurel — bâtiments résidentiels, immeubles collectifs, bâtiments tertiaires et commerciaux — en construction neuve.",
        "image": "/lf/uploads/items/02/02-1782784834565.jpg",
        "minPrice": 30,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "59600694-cb5b-417a-8505-4b101359506d",
            "code": "LF-CAISSON-ISOLANT-ISOLBO-5960",
            "name": "Caisson isolant ISOLBOX 20",
            "description": "Modèle de hauteur 20 cm, le plus compact de la gamme, adapté aux planchers de portée modérée et aux charges d'exploitation courantes des bâtiments résidentiels de faible à moyenne hauteur.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/02/02-1782784907559.jpg",
            "price": 30,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 30,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "439005ea-ffb7-4ecd-b8bd-ff51cfd0a4e5",
            "code": "LF-CAISSON-ISOLANT-ISOLBO-4390",
            "name": "Caisson isolant ISOLBOX 25",
            "description": "Modèle de hauteur 25 cm, dimensions 254 x 256 mm de base et 284 mm en diagonale, avec une portée nervurée de 196 mm entre nervures. Adapté aux planchers résidentiels et commerciaux de portée moyenne.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/02/02-1782784993189.jpg",
            "price": 40,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 40,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "77674356-3a84-43c5-a230-9a216e1d0c34",
            "code": "LF-CAISSON-ISOLANT-ISOLBO-7767",
            "name": "Caisson isolant ISOLBOX 30",
            "description": "Modèle de hauteur 30 cm, dimensions 300 x 300 mm de base et 330 mm en diagonale, avec une portée nervurée de 242 mm. Référence intermédiaire de la gamme, adaptée aux bâtiments collectifs et aux portées plus importantes nécessitant une rigidité structurelle accrue.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/02/02-1782785057944.jpg",
            "price": 50,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 50,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "de85073b-2342-45ea-9a1e-22ff0be04636",
            "code": "LF-CAISSON-ISOLANT-ISOLBO-DE85",
            "name": "Caisson isolant ISOLBOX 35",
            "description": "Modèle de hauteur 35 cm, dimensions 350 x 350 mm de base et 380 mm en diagonale, avec une portée nervurée de 290 mm. Destiné aux planchers de grande portée des bâtiments tertiaires, commerciaux et industriels nécessitant une forte capacité de charge.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/02/02-1782785123494.jpg",
            "price": 60,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 60,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "ccaee76e-3a2e-4490-96b0-31546a6764fa",
            "code": "LF-CAISSON-ISOLANT-ISOLBO-CCAE",
            "name": "Caisson isolant ISOLBOX 40",
            "description": "Modèle de hauteur 40 cm, le plus grand de la gamme, réservé aux planchers de très grande portée et aux ouvrages soumis à des charges d'exploitation élevées — bâtiments industriels, parkings en ouvrage et structures tertiaires de grande dimension.",
            "unit": "PIECE",
            "measureName": "Unité",
            "image": "/lf/uploads/items/02/02-1782785262152.jpg",
            "price": 90,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 90,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "ae29af06-ca33-4410-90ab-fce78b164744",
        "name": "Grillage fibre de verre",
        "description": "Le grillage en fibre de verre est un treillis textile technique tissé à partir de filaments de fibre de verre, généralement enduit d'une résine acrylique ou vinylique pour renforcer sa résistance chimique et mécanique. Il est utilisé sur les chantiers de construction comme armature de renforcement dans les enduits de façade, les systèmes d'isolation thermique par l'extérieur (ITE), les chapes minces et les revêtements de sols. Noyé dans la masse de l'enduit ou de la chape, il prévient l'apparition de fissures de retrait, répartit uniformément les contraintes mécaniques et améliore considérablement la durabilité du revêtement face aux variations thermiques et aux mouvements structurels. Sa résistance aux alcalis du ciment, sa légèreté et sa facilité de mise en œuvre — découpe simple aux ciseaux ou au cutter, pose par simple recouvrement des lés — en font un consommable incontournable pour les façadiers et les entreprises de second œuvre au Maroc.",
        "image": "/lf/uploads/items/a/a-1782782744569.jpg",
        "minPrice": 8,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "e938cf3d-babf-4189-8db7-2e165afc8f59",
            "code": "LF-GRILLAGE-FIBRE-DE-VERR-E938",
            "name": "Grillage fibre de verre 110 à 145g/m²",
            "description": "Le grillage fibre de verre léger est un treillis textile tissé à partir de filaments fins de fibre de verre, enduit d'une résine acrylique ou vinylique de protection, présentant un grammage compris entre 110 et 145 g/m². Sa structure souple et sa finesse en font le grillage de référence pour les enduits de façade minces, les finitions courantes en plâtre et en mortier, ainsi que les chapes de faible épaisseur. Noyé dans l'épaisseur de l'enduit, il prévient l'apparition de microfissures de retrait et homogénéise la répartition des contraintes thermiques et mécaniques sur la surface traitée. Sa légèreté facilite sa manipulation et sa pose par simple recouvrement des lés, sans outillage spécialisé.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/a/a-1782782973829.jpg",
            "price": 8,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sika",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782146269212.jpg",
                "price": 8,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "fec4867b-d052-44cf-8da1-51daaec5f527",
            "code": "LF-GRILLAGE-FIBRE-DE-VERR-FEC4",
            "name": "Grillage fibre de verre 160 à 320g/m²",
            "description": "Le grillage fibre de verre renforcé est un treillis technique à grammage élevé, compris entre 160 et 320 g/m², offrant une résistance mécanique nettement supérieure au grillage léger. Sa trame plus dense et son enduction renforcée lui permettent de résister à des contraintes mécaniques importantes et à des chocs de surface, ce qui en fait le grillage de référence pour les systèmes d'isolation thermique par l'extérieur (ITE), les façades de bâtiments collectifs et les soubassements exposés aux chocs et aux passages fréquents. Il est également utilisé dans les zones à risque de fissuration accrue, telles que les angles de baies, les jonctions de matériaux différents et les façades soumises à de fortes amplitudes thermiques, fréquentes sur le climat marocain.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/a/a-1782783080225.jpg",
            "price": 14,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sika",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782146269212.jpg",
                "price": 14,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "a29391b7-e28b-4a47-b717-396885004025",
        "name": "Grillage triple torsion",
        "description": "Le grillage triple torsion est un grillage métallique tissé selon un procédé de tissage hexagonal à triple torsion des fils, qui consiste à entrelacer chaque fil sur lui-même trois fois à chaque point de croisement avec les fils adjacents. Cette technique de fabrication confère au grillage une résistance mécanique et une stabilité dimensionnelle nettement supérieures aux grillages à simple ou double torsion, tout en empêchant son démaillage en cas de coupure ou de rupture d'un fil. Fabriqué en fil d'acier galvanisé — voire plastifié pour une meilleure résistance à la corrosion — il est utilisé sur les chantiers BTP et de génie civil pour les clôtures de chantier, les gabions de soutènement, les protections de talus, les enrochements et les ouvrages de confortement de berges. Sa souplesse et sa résistance en font également un matériau privilégié pour les ouvrages de protection contre les chutes de pierres en zone montagneuse.",
        "image": "/lf/uploads/items/grillage-a-poules-rouleau-50m-100cm-50mm-0-7mm-jpg/grillage-a-poules-rouleau-50m-100cm-50mm-0-7mm-jpg-1782783350876.jpg",
        "minPrice": 28,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "68c5efc5-ddc8-45a0-b4f5-417e5a1eb9e0",
            "code": "LF-GRILLAGE-TRIPLE-TORSIO-68C5",
            "name": "Grillage Triple torsion",
            "description": "Le grillage triple torsion est un grillage métallique tissé selon un procédé de tissage hexagonal à triple torsion des fils, qui consiste à entrelacer chaque fil sur lui-même trois fois à chaque point de croisement avec les fils adjacents. Cette technique de fabrication confère au grillage une résistance mécanique et une stabilité dimensionnelle nettement supérieures aux grillages à simple ou double torsion, tout en empêchant son démaillage en cas de coupure ou de rupture d'un fil. Fabriqué en fil d'acier galvanisé — voire plastifié pour une meilleure résistance à la corrosion — il est utilisé sur les chantiers BTP et de génie civil pour les clôtures de chantier, les gabions de soutènement, les protections de talus, les enrochements et les ouvrages de confortement de berges. Sa souplesse et sa résistance en font également un matériau privilégié pour les ouvrages de protection contre les chutes de pierres en zone montagneuse.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/grillage-a-poules-rouleau-50m-100cm-50mm-0-7mm-jpg/grillage-a-poules-rouleau-50m-100cm-50mm-0-7mm-jpg-1782783421210.jpg",
            "price": 28,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sonasid Acier",
                "supplierLogo": "/lf/uploads/suppliers/logo-sonasid-acier/logo-sonasid-acier-1781649863422.jpg",
                "price": 28,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "e64f8238-d250-4e7f-8e3b-80af5f028c04",
        "name": "Laine de roche",
        "description": "La laine de roche est un matériau isolant thermique et acoustique fabriqué à partir de fibres minérales obtenues par fusion et centrifugation de roches basaltiques ou de laitier de haut fourneau à très haute température — entre 1 400 et 1 600 °C. Ses fibres enchevêtrées emprisonnent des microbulles d'air qui lui confèrent d'excellentes performances d'isolation thermique et acoustique, supérieures à celles de la laine de verre dans les applications nécessitant une forte densité ou une résistance au feu élevée. Sa principale caractéristique distinctive est son incombustibilité : classée A1 au feu selon la norme européenne, elle ne brûle pas, ne propage pas les flammes et ne dégage pas de fumées toxiques, ce qui en fait le matériau isolant de référence pour les bâtiments soumis à des exigences strictes de sécurité incendie — immeubles de grande hauteur, bâtiments tertiaires, hôtels, établissements recevant du public et ouvrages industriels.",
        "image": "/lf/uploads/items/rouleau-laine-minerale-isolant-materiau-renovation-jpeg/rouleau-laine-minerale-isolant-materiau-renovation-jpeg-1782763865514.jpg",
        "minPrice": 33,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "755357d5-d90c-4c5c-a1e5-64c11b9bc8f2",
            "code": "LF-LAINE-DE-ROCHE-7553",
            "name": "Laine de roche",
            "description": "La laine de roche est un matériau isolant thermique et acoustique fabriqué à partir de fibres minérales obtenues par fusion et centrifugation de roches basaltiques ou de laitier de haut fourneau à très haute température — entre 1 400 et 1 600 °C. Ses fibres enchevêtrées emprisonnent des microbulles d'air qui lui confèrent d'excellentes performances d'isolation thermique et acoustique, supérieures à celles de la laine de verre dans les applications nécessitant une forte densité ou une résistance au feu élevée. Sa principale caractéristique distinctive est son incombustibilité : classée A1 au feu selon la norme européenne, elle ne brûle pas, ne propage pas les flammes et ne dégage pas de fumées toxiques, ce qui en fait le matériau isolant de référence pour les bâtiments soumis à des exigences strictes de sécurité incendie — immeubles de grande hauteur, bâtiments tertiaires, hôtels, établissements recevant du public et ouvrages industriels.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/rouleau-laine-minerale-isolant-materiau-renovation-jpeg/rouleau-laine-minerale-isolant-materiau-renovation-jpeg-1782764101146.jpg",
            "price": 33,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 33,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 34,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 35,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "b939936b-3090-4390-9aa6-91ba41ee15e6",
        "name": "Laine de verre",
        "description": "La laine de verre est un matériau isolant thermique et acoustique fabriqué à partir de fibres de verre obtenues par fusion et étirage de silice à haute température. Ses fibres enchevêtrées emprisonnent des millions de microbulles d'air qui constituent le principal vecteur de ses performances isolantes. Légère, souple et facile à découper, elle s'adapte à tous les types de supports et de configurations architecturales — murs, toitures, combles, cloisons et plafonds. Elle répond directement aux exigences de la réglementation thermique marocaine RTCM, qui impose des performances d'isolation minimales pour les bâtiments neufs résidentiels et tertiaires. En plus de ses propriétés thermiques, elle offre une bonne absorption acoustique qui réduit les transmissions de bruit entre espaces, ce qui en fait un matériau doublement performant pour les bâtiments collectifs et tertiaires au Maroc.",
        "image": "/lf/uploads/items/guide-achat-laine-verre/guide-achat-laine-verre-1782763787993.jpg",
        "minPrice": 33,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "93418039-8229-436d-8ca3-d1424cd01a03",
            "code": "LF-LAINE-DE-VERRE-9341",
            "name": "Laine de verre",
            "description": "La laine de verre est un matériau isolant thermique et acoustique fabriqué à partir de fibres de verre obtenues par fusion et étirage de silice à haute température. Ses fibres enchevêtrées emprisonnent des millions de microbulles d'air qui constituent le principal vecteur de ses performances isolantes. Légère, souple et facile à découper, elle s'adapte à tous les types de supports et de configurations architecturales — murs, toitures, combles, cloisons et plafonds. Elle répond directement aux exigences de la réglementation thermique marocaine RTCM, qui impose des performances d'isolation minimales pour les bâtiments neufs résidentiels et tertiaires. En plus de ses propriétés thermiques, elle offre une bonne absorption acoustique qui réduit les transmissions de bruit entre espaces, ce qui en fait un matériau doublement performant pour les bâtiments collectifs et tertiaires au Maroc.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/guide-achat-laine-verre/guide-achat-laine-verre-1782763995324.jpg",
            "price": 33,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 33,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 34,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "Robelbois",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782214836490.jpg",
                "price": 35,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "d47dea7b-1946-4074-b19f-eb46c3e012cb",
        "name": "Liège aggloméré expansé",
        "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
        "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782764912150.jpg",
        "minPrice": 60,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "e4e00671-4085-4eae-acd3-686e15c0918c",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-E4E0",
            "name": "Liège aggloméré expansé 100mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766288818.jpg",
            "price": 140,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 140,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "c781fb25-f320-4e20-ab97-3870259974f8",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-C781",
            "name": "Liège aggloméré expansé 20mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782765919082.jpg",
            "price": 60,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 60,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "486c82a9-2f6b-4e22-9b8c-16537a87500f",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-486C",
            "name": "Liège aggloméré expansé 30mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782765989106.jpg",
            "price": 70,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 70,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "568ba84e-a727-4d0d-94d9-cf9bbcaf7c94",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-568B",
            "name": "Liège aggloméré expansé 40mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766041880.jpg",
            "price": 80,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 80,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "1b9a057f-e049-4c2f-b3f7-868bdb9c6762",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-1B9A",
            "name": "Liège aggloméré expansé 50mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766082101.jpg",
            "price": 90,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 90,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "8b88837a-dd6b-4c18-aafe-05bf5135997c",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-8B88",
            "name": "Liège aggloméré expansé 60mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766140779.jpg",
            "price": 90,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 90,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "32fb18d8-0c48-4838-aa9d-b5f1ed27e174",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-32FB",
            "name": "Liège aggloméré expansé 70mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766170406.jpg",
            "price": 100,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 100,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "a2aae02c-8232-4c22-acda-8cb2fc8c4c2f",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-A2AA",
            "name": "Liège aggloméré expansé 80mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766211555.jpg",
            "price": 110,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 110,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "77680034-9fd4-4aab-adf1-759be2f66535",
            "code": "LF-LIEGE-AGGLOMERE-EXPANS-7768",
            "name": "Liège aggloméré expansé 90mm",
            "description": "Le liège aggloméré expansé est fabriqué par compression de granulés de liège brut sous chaleur et pression élevées, avec ou sans liant synthétique selon la qualité de fabrication. Cette technique de compression confère au panneau une densité supérieure au liège expansé naturel — entre 100 et 200 kg/m³ selon la référence — lui apportant une résistance mécanique à la compression nettement plus élevée, une rigidité structurelle accrue et une meilleure résistance au poinçonnement. Il conserve toutes les qualités naturelles du liège — imputrescibilité, résistance à l'humidité, isolation thermique et acoustique — tout en offrant des performances mécaniques adaptées aux applications sous charge. Il est la référence pour l'isolation des toitures-terrasses inversées, des dallages sur terre-plein, des planchers sur vide sanitaire et des façades isolées par l'extérieur (ITE) au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/bardage-liege/bardage-liege-1782766246569.jpg",
            "price": 120,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 120,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "6f565ff7-d3de-433d-b648-c130f15663ab",
        "name": "Liège expansé naturel",
        "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
        "image": "/lf/uploads/items/60e6ce9e20bb7/60e6ce9e20bb7-1782764498094.jpg",
        "minPrice": 45,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "eb17e1f0-dfd2-4dd1-83c1-78ebaa754425",
            "code": "LF-LIEGE-EXPANSE-NATUREL--EB17",
            "name": "Liège expansé naturel 100mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765633948.jpg",
            "price": 180,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 180,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "7d5f21e0-fb48-4f54-903b-a87447464faf",
            "code": "LF-LIEGE-EXPANSE-NATUREL--7D5F",
            "name": "Liège expansé naturel 20mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782764666115.jpg",
            "price": 45,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 45,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 48,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "6a02fe4d-41e5-436a-9b18-7440736ca3de",
            "code": "LF-LIEGE-EXPANSE-NATUREL--6A02",
            "name": "Liège expansé naturel 30mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765045681.jpg",
            "price": 63,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 63,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              },
              {
                "supplierName": "RIDO",
                "supplierLogo": "/lf/uploads/suppliers/rido-ma-logo-hd-pdf-1536x439/rido-ma-logo-hd-pdf-1536x439-1782311751878.jpg",
                "price": 65,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "80a362d3-acee-40cb-bff8-0751ddb83099",
            "code": "LF-LIEGE-EXPANSE-NATUREL--80A3",
            "name": "Liège expansé naturel 40mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765183102.jpg",
            "price": 92,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 92,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "63b46041-ff71-42a2-adbd-d853b7cb5f0f",
            "code": "LF-LIEGE-EXPANSE-NATUREL--63B4",
            "name": "Liège expansé naturel 50mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765299014.jpg",
            "price": 125,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 125,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "1ca6302b-f988-450b-91d8-964252d49645",
            "code": "LF-LIEGE-EXPANSE-NATUREL--1CA6",
            "name": "Liège expansé naturel 60mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765396423.jpg",
            "price": 130,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 130,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "f8e45e3d-153f-4f89-989b-17d3baa2929f",
            "code": "LF-LIEGE-EXPANSE-NATUREL--F8E4",
            "name": "Liège expansé naturel 70mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765436213.jpg",
            "price": 140,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 140,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "3e89b845-b91a-414d-b394-0c2d66999ae8",
            "code": "LF-LIEGE-EXPANSE-NATUREL--3E89",
            "name": "Liège expansé naturel 80mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765487228.jpg",
            "price": 150,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 150,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "4dac24d5-ff42-4068-901c-a8127c443151",
            "code": "LF-LIEGE-EXPANSE-NATUREL--4DAC",
            "name": "Liège expansé naturel 90mm",
            "description": "Le liège expansé naturel est obtenu par expansion à la vapeur d'eau de granulés de liège brut, sans adjonction de liant chimique. Les granulés s'agglomèrent naturellement grâce à la subérine — résine naturelle contenue dans l'écorce du chêne-liège — libérée sous l'effet de la chaleur et de la pression de vapeur. C'est la forme la plus pure et la plus écologique du liège isolant, entièrement naturelle, imputrescible, résistante à l'humidité, aux insectes et aux moisissures sans traitement chimique. Ses performances thermiques homogènes et sa légèreté en font un matériau privilégié pour l'isolation des toitures, des murs et des planchers dans les projets de construction durable et à haute performance énergétique au Maroc.",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/plaque-de-liege-expanse-pur-acermi/plaque-de-liege-expanse-pur-acermi-1782765565522.jpg",
            "price": 160,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 160,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "df993ef3-dc32-4bdf-88fc-13d3b9879bd0",
        "name": "Mousse polyuréthane",
        "description": "La mousse polyuréthane est un matériau isolant et adhésif expansif, disponible sous forme liquide en bidon ou en aérosol prêt à l'emploi, qui durcit au contact de l'air et de l'humidité ambiante en formant une structure cellulaire rigide ou semi-rigide. Elle est largement utilisée sur les chantiers BTP au Maroc pour le calfeutrage et l'étanchéité à l'air des menuiseries — portes, fenêtres, baies vitrées — le remplissage des cavités et des joints de dilatation, la fixation et la stabilisation des dormants de menuiserie, ainsi que l'isolation thermique et acoustique ponctuelle des passages de gaines et de canalisations. Sa capacité d'expansion lui permet de combler des espaces irréguliers avec une excellente adhérence sur la majorité des supports — béton, brique, bois, métal, PVC — tout en assurant simultanément une fonction d'isolation thermique grâce à sa structure alvéolaire emprisonnant de l'air.",
        "image": "/lf/uploads/items/comment-injecter-mousse-polyurethane-jpeg/comment-injecter-mousse-polyurethane-jpeg-1782785614057.jpg",
        "minPrice": 90,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "eadf2e91-cca3-4239-8dac-4a67fc96f9e4",
            "code": "LF-MOUSSE-POLYURETHANE-EADF",
            "name": "Mousse polyuréthane",
            "description": "La mousse polyuréthane est un matériau isolant et adhésif expansif, disponible sous forme liquide en bidon ou en aérosol prêt à l'emploi, qui durcit au contact de l'air et de l'humidité ambiante en formant une structure cellulaire rigide ou semi-rigide. Elle est largement utilisée sur les chantiers BTP au Maroc pour le calfeutrage et l'étanchéité à l'air des menuiseries — portes, fenêtres, baies vitrées — le remplissage des cavités et des joints de dilatation, la fixation et la stabilisation des dormants de menuiserie, ainsi que l'isolation thermique et acoustique ponctuelle des passages de gaines et de canalisations. Sa capacité d'expansion lui permet de combler des espaces irréguliers avec une excellente adhérence sur la majorité des supports — béton, brique, bois, métal, PVC — tout en assurant simultanément une fonction d'isolation thermique grâce à sa structure alvéolaire emprisonnant de l'air.",
            "unit": "PIECE",
            "measureName": "Bidon",
            "image": "/lf/uploads/items/comment-injecter-mousse-polyurethane-jpeg/comment-injecter-mousse-polyurethane-jpeg-1782785457522.jpg",
            "price": 220,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "TuboPlast",
                "supplierLogo": "/lf/uploads/suppliers/images-16/images-16-1782147424446.jpg",
                "price": 220,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "2af432a2-b804-4d17-95b5-c2a900795fc3",
            "code": "LF-SIKA-405-WATER-STOP-2AF4",
            "name": "Sika 405 water stop",
            "description": "Le Sika Boom 405 Water Stop est une mousse polyuréthane expansive monocomposante en aérosol, spécifiquement formulée pour l'étanchéité des joints de reprise de bétonnage et des points singuliers exposés à des infiltrations d'eau. Contrairement aux mousses polyuréthane standard destinées au calfeutrage de menuiseries, cette référence est conçue pour assurer un colmatage durable face à la pression hydrostatique, en s'appliquant directement au contact du béton frais ou durci au niveau des reprises de coulage, des joints de construction et des passages de canalisations traversant les ouvrages enterrés. Son expansion contrôlée lui permet de combler efficacement les irrégularités et les micro-cavités du support, formant une barrière étanche continue qui empêche la migration de l'eau à travers le joint. Elle est utilisée sur les ouvrages de soubassement, les fondations, les murs de sous-sol, les réservoirs en béton, les parkings souterrains et tous les ouvrages de génie civil exposés aux remontées d'humidité ou aux infiltrations d'eau par les joints de reprise.",
            "unit": "PIECE",
            "measureName": "Bombe Aérosol 750ml",
            "image": "/lf/uploads/items/uk-sika-boom-405-water-stop-04705524-1-1/uk-sika-boom-405-water-stop-04705524-1-1-1782786257036.jpg",
            "price": 210,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sika",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782146269212.jpg",
                "price": 210,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "b136366b-8686-4518-8422-6eadbfbbe753",
            "code": "LF-SIKA-BOOM-B136",
            "name": "Sika Boom",
            "description": "Le Sika Boom est une mousse polyuréthane expansive de la marque Sika, conditionnée en bombe aérosol prête à l'emploi, conçue pour le calfeutrage, l'isolation et la fixation sur les chantiers de construction. Elle durcit au contact de l'humidité ambiante en formant une structure cellulaire rigide à très faible conductivité thermique, assurant simultanément une isolation thermique et acoustique performante et une fixation mécanique solide. Elle est largement utilisée par les professionnels du BTP au Maroc pour le calfeutrage des menuiseries — portes, fenêtres, baies vitrées — la fixation et la stabilisation des dormants, le remplissage des joints de dilatation, des cavités irrégulières et des passages de gaines, ainsi que l'isolation ponctuelle des combles et des points singuliers de l'enveloppe du bâtiment. Sa formulation garantit une excellente adhérence sur la majorité des supports de chantier — béton, brique, bois, métal, PVC — sans nécessiter de primaire d'accrochage particulier.",
            "unit": "PIECE",
            "measureName": "Bombe Aérosol 750ml",
            "image": "/lf/uploads/items/tn-02-tn-sika-boom-p-01-1x1-00862082-1-1/tn-02-tn-sika-boom-p-01-1x1-00862082-1-1-1782785859678.jpg",
            "price": 90,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sika",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782146269212.jpg",
                "price": 90,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "8471a796-ad10-4c17-8b8e-912786dc362b",
            "code": "LF-SIKA-BOOM-400-FIRE-8471",
            "name": "Sika Boom 400 fire",
            "description": "Le Sika Boom 400 Fire est une mousse polyuréthane expansive monocomposante coupe-feu, conditionnée en aérosol Combo prêt à l'emploi, présentant la résistance au feu la plus élevée, classée EI 240 selon la norme EN 13501-2, avec un rapport d'essais conforme à la norme EN 1366-4. Sa résistance au feu dépasse 300 minutes, soit 4 heures, ce qui en fait le produit privilégié des applicateurs professionnels pour les bâtiments soumis aux exigences les plus strictes en matière de protection incendie. Elle est conçue pour le calfeutrement des joints de murs nécessitant une protection au feu, ainsi qu'autour des fenêtres et des portes coupe-feu. ",
            "unit": "PIECE",
            "measureName": "Bombe Aérosol 750ml",
            "image": "/lf/uploads/items/ch-sika-boom-400-fire-750ml-1x1-01464713-1-1/ch-sika-boom-400-fire-750ml-1x1-01464713-1-1-1782786116664.jpg",
            "price": 190,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Sika",
                "supplierLogo": "/lf/uploads/suppliers/images-7/images-7-1782146269212.jpg",
                "price": 190,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "c820fb58-ced1-44cd-8865-b335c3a3e0ba",
        "name": "Polystyrene",
        "description": "Le polystyrène est un matériau isolant thermique synthétique fabriqué à partir de billes de polystyrène expansées sous l'effet de la chaleur et de la vapeur, formant une structure cellulaire composée à plus de 98% d'air emprisonné. Léger, économique et facile à découper, il constitue l'un des isolants les plus répandus dans le secteur du BTP au Maroc, utilisé pour l'isolation des murs, des combles, des toitures-terrasses, des planchers sur vide sanitaire et la fabrication des hourdis de plancher.",
        "image": "/lf/uploads/items/1702649145-14/1702649145-14-1782783590121.jpg",
        "minPrice": 18,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "13513697-072a-45d3-8f87-825108e98d38",
            "code": "LF-POLYSTYRENE-20MM-1351",
            "name": "Polystyrene 20mm",
            "description": "Le polystyrène expansé est un isolant léger et économique, fabriqué par expansion de billes de polystyrène sous l'effet de la chaleur. Utilisé pour l'isolation des murs, des combles et des cloisons, il offre un bon rapport performance/prix pour les applications courantes à faible contrainte mécanique.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/1702649145-14/1702649145-14-1782783717054.jpg",
            "price": 18,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 18,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "4466f8ed-47fd-46ac-ae79-7e0b722d00cd",
            "code": "LF-POLYSTYRENE-40MM-4466",
            "name": "Polystyrene 40mm",
            "description": "Le polystyrène expansé est un isolant léger et économique, fabriqué par expansion de billes de polystyrène sous l'effet de la chaleur. Utilisé pour l'isolation des murs, des combles et des cloisons, il offre un bon rapport performance/prix pour les applications courantes à faible contrainte mécanique.",
            "unit": "M2",
            "measureName": "Mètre carré",
            "image": "/lf/uploads/items/1702649145-14/1702649145-14-1782784008331.jpg",
            "price": 28,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "ISOLBOX",
                "supplierLogo": "/lf/uploads/suppliers/images-19/images-19-1782214624060.jpg",
                "price": 28,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      },
      {
        "id": "5d6194c3-23f9-4d6b-88b8-d4116b11d687",
        "name": "Polystyrène extrudé XPS",
        "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène expansé en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue. Cette structure à cellules fermées lui confère des propriétés radicalement supérieures au polystyrène expansé EPS classique — une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps. C'est le matériau isolant de référence pour toutes les applications en contact avec l'humidité ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. ",
        "image": "/lf/uploads/items/logo1590875123/logo1590875123-1782764358122.jpg",
        "minPrice": 50,
        "currencyCode": "MAD",
        "variantes": [
          {
            "id": "6c56aaa7-440b-4494-ba38-9d1d2374517d",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-6C56",
            "name": "Le polystyrène extrudé XPS 100mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782782324207.jpg",
            "price": 115,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 115,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "b80f9a09-bf3d-4c4a-94b3-6616435ebc2b",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-B80F",
            "name": "Le polystyrène extrudé XPS 120mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782782352198.jpg",
            "price": 130,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 130,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "a2e1951e-c0d6-4825-90ad-dde79c8d1484",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-A2E1",
            "name": "Le polystyrène extrudé XPS 20mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782781784244.jpg",
            "price": 50,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 50,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "1c990600-bc40-4b14-806e-851b9bee6ad7",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-1C99",
            "name": "Le polystyrène extrudé XPS 30mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782781955223.jpg",
            "price": 65,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 65,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "266c28b2-4647-4619-a9a1-cd61a57d3f19",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-266C",
            "name": "Le polystyrène extrudé XPS 40mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782782003632.jpg",
            "price": 75,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 75,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "b5dd5dce-66cf-4dd9-b34c-6eecc9d0e742",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-B5DD",
            "name": "Le polystyrène extrudé XPS 50mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782782045021.jpg",
            "price": 85,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 85,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "864a9f8a-56fc-4fd0-bb3b-b49a2aa12131",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-864A",
            "name": "Le polystyrène extrudé XPS 60mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782782120157.jpg",
            "price": 95,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 95,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          },
          {
            "id": "08ca3d5a-065d-4951-89a2-b16d13cc70f3",
            "code": "LF-LE-POLYSTYRENE-EXTRUDE-08CA",
            "name": "Le polystyrène extrudé XPS 80mm",
            "description": "Le polystyrène extrudé XPS est un matériau isolant thermique rigide fabriqué par extrusion de polystyrène en présence d'un agent gonflant, formant une structure cellulaire fermée homogène et continue sur toute l'épaisseur du panneau. Cette structure à cellules fermées le distingue radicalement du polystyrène expansé EPS classique, en lui conférant une résistance à l'humidité quasi nulle, une résistance à la compression élevée et une stabilité dimensionnelle parfaite dans le temps, même en milieu humide ou enterré. C'est le matériau isolant de référence pour toutes les applications en contact avec l'eau ou soumises à des charges mécaniques importantes — toitures-terrasses inversées, dallages sur terre-plein, planchers sur vide sanitaire, murs enterrés, fondations et isolation périphérique des sous-sols. Il est facilement reconnaissable à sa couleur caractéristique — bleu, vert ou rose selon la marque — et à sa surface lisse ou rainurée selon les références. ",
            "unit": "PIECE",
            "measureName": "Panneau",
            "image": "/lf/uploads/items/polystirene-xps/polystirene-xps-1782782182753.jpg",
            "price": 105,
            "currencyCode": "MAD",
            "stockStatus": "RUPTURE_DE_STOCK",
            "offers": [
              {
                "supplierName": "Vital Box",
                "supplierLogo": "/lf/uploads/suppliers/images-5/images-5-1782214703871.jpg",
                "price": 105,
                "currencyCode": "MAD",
                "minOrderQuantity": 1,
                "quantityInStock": 0
              }
            ]
          }
        ]
      }
    ]
  }
] as const;

/** Total number of products across all categories. */
export const CATALOG_PRODUCT_COUNT = MARKETPLACE_CATALOG.reduce(
  (sum, category) => sum + category.productCount,
  0,
);

/** Total number of variantes (purchasable leaves) across the catalogue. */
export const CATALOG_VARIANTE_COUNT = MARKETPLACE_CATALOG.reduce(
  (sum, category) => sum + category.varianteCount,
  0,
);

/** MAD price formatter matching the marketplace ("1 234 MAD"). */
export function fmtCatalogPrice(price: number | null, currency = 'MAD'): string {
  if (price == null || !(price > 0)) return 'Prix sur demande';
  return `${price.toLocaleString('fr-MA', { maximumFractionDigits: 2 })} ${currency}`;
}

/** Accent → ATLAS design-token classes (text + soft background + border). */
export const ACCENT_CLASSES: Record<
  CategoryAccent,
  { text: string; softBg: string; border: string }
> = {
  ochre: { text: 'text-ochre', softBg: 'bg-ochre-soft', border: 'border-ochre' },
  clay: { text: 'text-clay', softBg: 'bg-clay-soft', border: 'border-clay' },
  teal: { text: 'text-teal', softBg: 'bg-teal-soft', border: 'border-teal' },
  cyan: { text: 'text-cyan', softBg: 'bg-cyan-soft', border: 'border-cyan' },
  emerald: { text: 'text-emerald', softBg: 'bg-emerald-soft', border: 'border-emerald' },
};
