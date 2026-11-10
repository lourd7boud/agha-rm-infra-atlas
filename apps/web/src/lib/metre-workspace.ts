import { computeLignePartielClient, metreCalcType, round2Client, type MetreLigne, type MetreSousSection } from './btp-shared';

/** Same per-article rounding and subsection multiplication as the editor/Core. */
export function metreArticleSummary(
  unit: string, lines: MetreLigne[], subsections: MetreSousSection[],
  contractQuantity: number, unitPrice: number, previous: number,
) {
  const factors = new Map(subsections.map((section) => [section.id, section.nombreElements]));
  const current = round2Client(lines.reduce((sum, line) => {
    const factor = metreCalcType(unit) === 'poids' && line.subSectionId ? factors.get(line.subSectionId) : 1;
    return sum + computeLignePartielClient(unit, line) * (factor && Number.isFinite(factor) ? factor : 1);
  }, 0));
  const cumulative = round2Client(previous + current);
  return {
    current, cumulative, previous,
    amount: round2Client(current * unitPrice),
    percent: contractQuantity > 0 ? cumulative / contractQuantity * 100 : 0,
    overrun: cumulative > contractQuantity,
    remaining: round2Client(contractQuantity - cumulative),
  };
}

function searchable(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/³/g, '3').replace(/²/g, '2').toLocaleLowerCase('fr');
}

export function matchesMetreSearch(article: { numero: number; designation: string; unite: string }, query: string): boolean {
  const haystack = searchable(`${article.numero} ${article.designation} ${article.unite}`);
  return searchable(query).trim().split(/\s+/).every((term) => haystack.includes(term));
}

export function measurementIncomplete(unit: string, line: MetreLigne): boolean {
  const type = metreCalcType(unit);
  const hasDimensions = [line.longueur, line.largeur, line.profondeur, line.nombre, line.diametre].some((value) => value != null);
  if (!hasDimensions && line.partiel != null) return false;
  const required: (keyof MetreLigne)[] = type === 'volume' ? ['longueur', 'largeur', 'profondeur']
    : type === 'surface' ? ['longueur', 'largeur'] : type === 'lineaire' ? ['longueur']
      : type === 'poids' ? ['nombre', 'longueur', 'diametre'] : ['nombre'];
  return required.some((field) => line[field] == null);
}

export const METRE_FORMULAS = {
  volume: 'Nb semblables × Longueur × Largeur × Profondeur',
  surface: 'Nb semblables × Longueur × Largeur',
  lineaire: 'Nb semblables × Longueur',
  poids: 'Nombre × Nombre d’éléments × Longueur × poids du Ø',
  unite: 'Nombre',
};

export const fmtMetreMoney = (value: number) => value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
