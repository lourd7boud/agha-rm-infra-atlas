import { computeLignePartielClient, DIAMETRES_DISPONIBLES, metreCalcType, normaliseNombreElements, type MetreLigne, type MetreSousSection } from './btp-shared';
import { measurementIncomplete, metreArticleSummary } from './metre-workspace';
import { DIMENSION_COLUMNS, fmtMetreQty } from './metre-details';

export type ReviewKind = 'incomplete' | 'duplicate' | 'dimension' | 'zero' | 'count' | 'diameter' | 'repetition' | 'overrun';
export interface MetreReviewIssue {
  id: string; articleKey: string; kind: ReviewKind; title: string; detail: string;
  lineIds: string[]; severity: 'attention' | 'info';
}
export interface ReviewArticle {
  key: string; unite: string; quantite: number; previous: number;
  lignes: MetreLigne[]; sousSections: MetreSousSection[];
}

/** Advisory, reproducible rules. Never mutates measurements or certifies an ouvrage. */
export function reviewMetreArticle(article: ReviewArticle): MetreReviewIssue[] {
  const issues: MetreReviewIssue[] = [];
  const type = metreCalcType(article.unite);
  const sections = new Map(article.sousSections.map((section) => [section.id, section]));
  const duplicates = new Map<string, MetreLigne[]>();
  function add(kind: ReviewKind, title: string, detail: string, lineIds: string[], severity: 'attention' | 'info' = 'attention') {
    issues.push({ id: `${article.key}:${kind}:${lineIds.join(':')}`, articleKey: article.key, kind, title, detail, lineIds, severity });
  }
  article.lignes.forEach((line, index) => {
    const label = `Mesure ${index + 1}${line.designation ? ` · ${line.designation}` : ''}`;
    if (measurementIncomplete(article.unite, line)) add('incomplete', 'Dimensions incomplètes', `${label} : renseignez les dimensions nécessaires au calcul ${article.unite}.`, [line.id]);
    const dimensions = ['longueur', 'largeur', 'profondeur'] as const;
    const invalidDimensions = dimensions.filter((field) => line[field] != null && (!Number.isFinite(line[field]) || line[field]! < 0 || line[field]! >= (field === 'profondeur' ? 10 : field === 'largeur' ? 50 : 1000)));
    if (invalidDimensions.length) add('dimension', 'Dimensions à vérifier', `${label} : ${invalidDimensions.map((field) => `${field} = ${line[field]} m`).join(', ')}. Repères de contrôle : longueur ≥ 1 000 m, largeur ≥ 50 m, profondeur ≥ 10 m ou dimension négative. Vérifiez notamment une éventuelle saisie en centimètres ; une grande dimension peut être justifiée.`, [line.id]);
    if (dimensions.some((field) => line[field] === 0) || line.nombre === 0) add('zero', 'Mesure de quantité nulle', `${label} contient une dimension ou un nombre nul. Vérifiez si cette ligne est volontaire.`, [line.id], 'info');
    const countField = type === 'poids' ? 'nombreElements' : 'nombreSemblables';
    const count = line[countField];
    if (count != null && (count === 0 || !Number.isFinite(count) || countField === 'nombreElements' && !Number.isInteger(count))) {
      const effective = countField === 'nombreElements' ? normaliseNombreElements(count) : count && Number.isFinite(count) ? count : 1;
      add('count', 'Répétition interprétée par le calcul', `${label} : ${countField === 'nombreElements' ? 'Nombre d’éléments' : 'Nb semblables'} = ${count} ; le moteur utilise ${effective}. Saisissez explicitement le nombre souhaité.`, [line.id]);
    }
    if (type === 'poids') {
      if (line.diametre != null && !DIAMETRES_DISPONIBLES.includes(line.diametre)) add('diameter', 'Diamètre hors barème', `${label} : Ø ${line.diametre} mm n’a pas de poids linéique dans le barème ; le calcul produit 0. Choisissez un diamètre disponible.`, [line.id]);
      const section = line.subSectionId ? sections.get(line.subSectionId) : undefined;
      if (Math.abs(section?.nombreElements ?? 1) > 1 && Math.abs(normaliseNombreElements(line.nombreElements)) > 1) add('repetition', 'Deux niveaux de répétition', `${label} : ${section?.titre || 'l’élément'} × ${section?.nombreElements} et la mesure × ${normaliseNombreElements(line.nombreElements)} se multiplient. Vérifiez que ces répétitions sont indépendantes.`, [line.id]);
    }
    if (!measurementIncomplete(article.unite, line) && computeLignePartielClient(article.unite, line) !== 0) {
      const key = JSON.stringify([line.subSectionId ?? '', line.sectionId ?? '', line.designation?.trim().toLocaleLowerCase('fr') ?? '', ...DIMENSION_COLUMNS[type].map((column) => line[column.field] ?? column.fallback ?? (column.field === 'nombreSemblables' ? 1 : null)), line.partiel && !line.longueur && !line.nombre ? line.partiel : null]);
      duplicates.set(key, [...duplicates.get(key) ?? [], line]);
    }
  });
  for (const lines of duplicates.values()) {
    if (lines.length > 1) add('duplicate', 'Repères et dimensions identiques', `${lines.length} mesures du même emplacement portent le même repère et les mêmes dimensions (${lines[0].designation || 'sans désignation'}). Vérifiez qu’il ne s’agit pas d’un double comptage.`, lines.map((line) => line.id));
  }
  const summary = metreArticleSummary(article.unite, article.lignes, article.sousSections, article.quantite, 0, article.previous);
  if (summary.overrun) add('overrun', 'Quantité du marché dépassée', `Précédent ${fmtMetreQty(article.previous)} + période ${fmtMetreQty(summary.current)} = ${fmtMetreQty(summary.cumulative)} ${article.unite}, pour ${fmtMetreQty(article.quantite)} au marché. Dépassement : ${fmtMetreQty(summary.cumulative - article.quantite)} ${article.unite}.`, []);
  return issues;
}
