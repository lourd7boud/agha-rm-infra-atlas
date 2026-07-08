// مكتبة البنود الشائعة - يمكن توسيعها
export interface BordereauTemplate {
  id: string;
  code: string;
  designation: string;
  unite: 'M³' | 'ML' | 'M²' | 'KG' | 'T' | 'U' | 'ENS' | 'ML' | 'M';
  prixReference: number;
  categorie: string;
  tags: string[];
}

export const bordereauTemplates: BordereauTemplate[] = [
  // Terrassement
  {
    id: 'DEB-001',
    code: '1.1',
    designation: "Déblais pour ouvrages exécutés dans l'eau en terrain de toute nature y compris la roche et à toute profondeur LE METRE CUBE",
    unite: 'M³',
    prixReference: 48.00,
    categorie: 'Terrassement',
    tags: ['déblais', 'eau', 'terrain', 'roche'],
  },
  {
    id: 'FOU-001',
    code: '1.2',
    designation: 'Fourniture et mise en place de gabions y compris cage, enrochement et terrassements LE METRE CUBE',
    unite: 'M³',
    prixReference: 400.00,
    categorie: 'Terrassement',
    tags: ['fourniture', 'gabions', 'cage', 'enrochement'],
  },
  {
    id: 'BET-001',
    code: '1.3',
    designation: 'Gros béton dosé à 300kg/m3 de ciment CPJ 45 y compris coffrage et décoffrage et toutes sujétions LE METRE CUBE',
    unite: 'M³',
    prixReference: 753.50,
    categorie: 'Béton',
    tags: ['béton', 'ciment', 'coffrage', 'décoffrage'],
  },
  {
    id: 'REM-001',
    code: '1.4',
    designation: "Remblais ordinaire étalé sur les bords des ouvrages et compacté légèrement y compris toutes sujétions de mise en dépôts. LE METRE CUBE",
    unite: 'M³',
    prixReference: 30.00,
    categorie: 'Terrassement',
    tags: ['remblais', 'compacté', 'ouvrages'],
  },
  
  // Aménagement Hydro-Agricole
  {
    id: 'DEB-002',
    code: '2.1',
    designation: "Déblais pour ouvrages et canaux exécutés dans le lit de l'oued y compris rocher et terrassement dans l'eau toutes sujétions. LE METRE CUBE",
    unite: 'M³',
    prixReference: 70.00,
    categorie: 'Hydro-Agricole',
    tags: ['déblais', 'canaux', 'oued', 'rocher'],
  },
  {
    id: 'HER-001',
    code: '2.2',
    designation: "Hérissonnage de gros pierres sèches posées à la main sur le sol et pointé en l'air » recopiissage à la pierre cassée et fortement damée. LE METRE CARRE",
    unite: 'M²',
    prixReference: 50.00,
    categorie: 'Hydro-Agricole',
    tags: ['hérissonnage', 'pierres', 'cassée', 'damée'],
  },
  {
    id: 'BET-002',
    code: '2.3',
    designation: 'Béton pour béton armé dosé à 350kg/m3 de ciment CPJ 45 y compris coffrage, décoffrage et toutes sujétions. LE METRE CUBE',
    unite: 'M³',
    prixReference: 1150.00,
    categorie: 'Béton',
    tags: ['béton armé', 'ciment', 'coffrage'],
  },
  {
    id: 'FOU-002',
    code: '2.4',
    designation: "Fourniture et pose des aciers mi-durs à haute adhérence pour armatures de tout diamètre y compris toutes sujétions de mise en dépôts. LE KILOGRAMME",
    unite: 'KG',
    prixReference: 15.00,
    categorie: 'Ferraillage',
    tags: ['fourniture', 'aciers', 'armatures', 'adhérence'],
  },
  {
    id: 'CUR-001',
    code: '2.5',
    designation: 'Curage et reprofilage de khettaras LE METRE LINEAIRE',
    unite: 'ML',
    prixReference: 400.00,
    categorie: 'Hydro-Agricole',
    tags: ['curage', 'reprofilage', 'khettaras'],
  },
  {
    id: 'REM-002',
    code: '2.6',
    designation: "Remblais ordinaire étalé sur les bords des ouvrages et compacté légèrement y compris toutes sujétions de mise en dépôts. LE METRE CUBE",
    unite: 'M³',
    prixReference: 40.00,
    categorie: 'Terrassement',
    tags: ['remblais', 'ordinaire', 'compacté'],
  },
  {
    id: 'JOI-001',
    code: '2.7',
    designation: "Joint de retrait réalisé au moyen d'un produit bitumineux y compris toutes sujétions LE METRE LINEAIRE",
    unite: 'ML',
    prixReference: 100.00,
    categorie: 'Étanchéité',
    tags: ['joint', 'retrait', 'bitumineux'],
  },
  {
    id: 'FOU-003',
    code: '2.8',
    designation: 'Fourniture et pose de tôle métalliques pour vannette LE KILOGRAMME',
    unite: 'KG',
    prixReference: 60.00,
    categorie: 'Métallerie',
    tags: ['fourniture', 'tôle', 'vannette'],
  },

  // Maçonnerie
  {
    id: 'MUR-001',
    code: '3.1',
    designation: 'Mur en moellons de pierre y compris mortier et toutes sujétions LE METRE CUBE',
    unite: 'M³',
    prixReference: 850.00,
    categorie: 'Maçonnerie',
    tags: ['mur', 'moellons', 'pierre', 'mortier'],
  },
  {
    id: 'END-001',
    code: '3.2',
    designation: 'Enduit de ciment lissé sur murs y compris toutes sujétions LE METRE CARRE',
    unite: 'M²',
    prixReference: 45.00,
    categorie: 'Finition',
    tags: ['enduit', 'ciment', 'lissé', 'murs'],
  },

  // Charpente et Couverture
  {
    id: 'CHA-001',
    code: '4.1',
    designation: 'Charpente métallique y compris peinture antirouille LE KILOGRAMME',
    unite: 'KG',
    prixReference: 25.00,
    categorie: 'Charpente',
    tags: ['charpente', 'métallique', 'peinture'],
  },
  {
    id: 'TUI-001',
    code: '4.2',
    designation: 'Tuiles mécaniques y compris pose et accessoires LE METRE CARRE',
    unite: 'M²',
    prixReference: 120.00,
    categorie: 'Couverture',
    tags: ['tuiles', 'mécaniques', 'pose'],
  },
];

// Catégories pour filtrage
export const categories = [
  'Terrassement',
  'Béton',
  'Ferraillage',
  'Hydro-Agricole',
  'Maçonnerie',
  'Finition',
  'Étanchéité',
  'Métallerie',
  'Charpente',
  'Couverture',
];

// Unités disponibles
export const unites = ['M³', 'ML', 'M²', 'KG', 'T', 'U', 'ENS', 'M'];

// Fonction de recherche dans les templates
export const searchTemplates = (query: string): BordereauTemplate[] => {
  if (!query) return bordereauTemplates;
  
  const lowerQuery = query.toLowerCase();
  return bordereauTemplates.filter(
    (template) =>
      template.designation.toLowerCase().includes(lowerQuery) ||
      template.code.includes(lowerQuery) ||
      template.categorie.toLowerCase().includes(lowerQuery) ||
      template.tags.some((tag) => tag.includes(lowerQuery))
  );
};

// Fonction pour obtenir les templates par catégorie
export const getTemplatesByCategory = (categorie: string): BordereauTemplate[] => {
  return bordereauTemplates.filter((t) => t.categorie === categorie);
};
