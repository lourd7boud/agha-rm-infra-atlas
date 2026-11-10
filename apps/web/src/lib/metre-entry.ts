import { computeLignePartielClient, DIAMETRES_DISPONIBLES, metreCalcType, type MetreCalcType, type MetreLigne } from './btp-shared';
import { DIMENSION_COLUMNS } from './metre-details';

export type MeasurementDraft = Omit<MetreLigne, 'id'>;
export type NumericMeasureField = 'nombreSemblables' | 'nombre' | 'nombreElements' | 'longueur' | 'largeur' | 'profondeur' | 'diametre';
export type ClipboardField = NumericMeasureField | 'designation' | 'unit' | 'ignore' | 'unmapped';
export const ENTRY_LIMIT = 500;
export const CLIPBOARD_LIMIT = 100_000;

export function readMetreNumber(raw: string): number | undefined {
  let value = raw.trim().replace(/[\s\u00a0\u202f]/g, '').replace(/−/g, '-');
  if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(value)) value = value.replace(/\./g, '');
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) return undefined;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}

export const entryColumns = (unit: string): { field: ClipboardField; label: string }[] => [
  { field: 'designation', label: 'Désignation / repère' },
  ...DIMENSION_COLUMNS[metreCalcType(unit)].map((column) => ({ field: column.field as NumericMeasureField, label: column.label })),
];

const normal = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9ø²³]/g, '');
function headerField(raw: string): ClipboardField | undefined {
  const value = normal(raw);
  if (['designation', 'designationrepere', 'repere', 'libelle', 'description', 'ouvrage'].includes(value)) return 'designation';
  if (['nbsemblables', 'nombresemblables', 'nombressemblables', 'nb', 'repetitions'].includes(value)) return 'nombreSemblables';
  if (['nombredelements', 'nbdelements', 'nbelements', 'nombreelements', 'elements'].includes(value)) return 'nombreElements';
  if (['nombre', 'quantite', 'barres', 'nbbarres'].includes(value)) return 'nombre';
  if (['longueur', 'longueurm', 'longueurml', 'l'].includes(value)) return 'longueur';
  if (['largeur', 'largeurm', 'b'].includes(value)) return 'largeur';
  if (['profondeur', 'profondeurm', 'hauteur', 'hauteurm', 'epaisseur', 'epaisseurm', 'h'].includes(value)) return 'profondeur';
  if (['ø', 'ømm', 'diametre', 'diametremm'].includes(value)) return 'diametre';
  if (['unite', 'unit', 'units', 'u', 'unitedemesure', 'unitemesure', 'measurementunit'].includes(value)) return 'unit';
  if (['partiel', 'total', 'montant', 'n', 'no', 'numero'].includes(value) || value.startsWith('partiel')) return 'ignore';
  return undefined;
}

function normalizedUnit(value: string) {
  const unit = value.trim().toUpperCase().replace('3', '³').replace('2', '²');
  return unit === 'M' ? 'ML' : unit;
}

/** Read quoted Excel TSV / semicolon CSV; never execute spreadsheet formulas. */
function readGrid(text: string): { records: { cells: string[]; sourceRow: number }[]; errors: string[] } {
  const records: { cells: string[]; sourceRow: number }[] = [];
  // Delimiters inside quoted descriptions and leading blank records are data.
  let inQuotes = false, tabs = 0, semicolons = 0, nonempty = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') { i++; continue; }
      inQuotes = !inQuotes;
    }
    if (!inQuotes && char === '\t') tabs++;
    if (!inQuotes && char === ';') semicolons++;
    if (!inQuotes && char === '\n') { if (nonempty) break; tabs = 0; semicolons = 0; }
    if (char.trim()) nonempty = true;
  }
  const delimiter = tabs > 0 ? '\t' : semicolons > 0 ? ';' : '\t';
  let cell = '', cells: string[] = [], quoted = false, closed = false, line = 1, start = 1;
  function finishRow() {
    cells.push(cell);
    if (cells.some((value) => value.trim() !== '')) records.push({ cells, sourceRow: start });
    cell = ''; cells = []; closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; continue; }
    if (char === '"' && (quoted || cell.trim() === '' && !closed)) {
      if (quoted) { quoted = false; closed = true; } else { cell = ''; quoted = true; }
      continue;
    }
    if (char === '\n') {
      if (quoted) cell += char; else { finishRow(); start = line + 1; }
      line++; continue;
    }
    if (char === delimiter && !quoted) { cells.push(cell); cell = ''; closed = false; continue; }
    if (closed && char.trim() !== '') return { records: [], errors: [`Ligne ${line} : texte inattendu après un guillemet fermant.`] };
    if (!closed) cell += char;
  }
  if (quoted) return { records: [], errors: ['Guillemets non fermés : vérifiez le tableau collé.'] };
  finishRow();
  return { records, errors: [] };
}

export function validateMeasurement(unit: string, line: MeasurementDraft): string[] {
  const errors: string[] = [];
  const type = metreCalcType(unit);
  const required: NumericMeasureField[] = type === 'volume' ? ['longueur', 'largeur', 'profondeur']
    : type === 'surface' ? ['longueur', 'largeur'] : type === 'lineaire' ? ['longueur']
      : type === 'poids' ? ['nombre', 'longueur', 'diametre'] : ['nombre'];
  for (const field of required) {
    if (line[field] == null) errors.push(`${entryColumns(unit).find((column) => column.field === field)?.label ?? field} : valeur requise.`);
  }
  for (const field of ['nombreElements', 'nombreSemblables'] as const) {
    const value = line[field];
    if (value != null && (!Number.isInteger(value) || value === 0)) errors.push(`${field === 'nombreElements' ? 'Nombre d’éléments' : 'Nb semblables'} : entier non nul attendu (négatif = déduction).`);
  }
  for (const field of ['longueur', 'largeur', 'profondeur'] as const) {
    if (line[field] != null && line[field]! <= 0) errors.push(`${field} : dimension positive en mètres attendue ; utilisez un nombre négatif pour une déduction.`);
  }
  if (type === 'poids' && line.diametre != null && !DIAMETRES_DISPONIBLES.includes(line.diametre)) errors.push(`Diamètre ${line.diametre} mm non disponible dans le barème.`);
  if (!Number.isFinite(computeLignePartielClient(unit, { id: 'validation', ...line }))) errors.push('Le résultat du calcul dépasse la capacité numérique. Vérifiez les dimensions et les répétitions.');
  return errors;
}

export interface ClipboardPreview {
  rows: { sourceRow: number; line: MeasurementDraft; errors: string[] }[];
  mapping: ClipboardField[];
  headers: string[];
  hasHeader: boolean;
  errors: string[];
}

export function parseMetreClipboard(text: string, unit: string, mapping?: ClipboardField[], headerMode: 'auto' | 'yes' | 'no' = 'auto'): ClipboardPreview {
  const empty: ClipboardPreview = { rows: [], mapping: [], headers: [], hasHeader: false, errors: [] };
  if (!text.trim()) return empty;
  if (text.length > CLIPBOARD_LIMIT) return { ...empty, errors: [`Le collage dépasse ${CLIPBOARD_LIMIT.toLocaleString('fr')} caractères. Collez au maximum ${ENTRY_LIMIT} mesures à la fois.`] };
  const grid = readGrid(text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, ''));
  if (grid.errors.length || !grid.records.length) return { ...empty, errors: grid.errors };
  const first = grid.records[0].cells;
  const inferred = first.map(headerField);
  const hasHeader = headerMode === 'yes' || headerMode === 'auto' && inferred.filter((field) => field !== undefined).length >= 2 && !first.some((value) => readMetreNumber(value) !== undefined);
  const records = hasHeader ? grid.records.slice(1) : grid.records;
  if (records.length > ENTRY_LIMIT) return { ...empty, errors: [`Maximum ${ENTRY_LIMIT} mesures par collage ; ${records.length} reçues.`] };
  const size = Math.max(first.length, ...records.map((record) => record.cells.length));
  if (size > 32) return { ...empty, errors: ['Trop de colonnes : collez uniquement le tableau des mesures.'] };
  const columns = entryColumns(unit);
  const fields = Array.from({ length: size }, (_, i) => mapping?.[i] ?? (hasHeader ? inferred[i] ?? 'unmapped' : columns[i]?.field ?? 'unmapped'));
  const errors: string[] = [];
  if (!mapping && !hasHeader && size > columns.length) errors.push('Colonnes supplémentaires : associez les colonnes ci-dessous avant d’ajouter les mesures.');
  if (fields.includes('unmapped')) errors.push('Certaines colonnes restent à associer. Choisissez leur destination ou confirmez explicitement « Ignorer ».');
  const destinations = fields.filter((field) => field !== 'ignore' && field !== 'unmapped');
  if (new Set(destinations).size !== destinations.length) errors.push('Un champ est associé à plusieurs colonnes. Chaque destination doit être unique.');
  const allowed = new Set<ClipboardField>([...columns.map((column) => column.field), 'unit', 'ignore', 'unmapped']);
  if (fields.some((field) => !allowed.has(field))) errors.push('Une colonne est incompatible avec l’unité de ce prix.');
  fields.forEach((field, index) => {
    if (hasHeader && ['longueur', 'largeur', 'profondeur'].includes(field) && /(?:cm|mm)$/.test(normal(first[index] ?? ''))) errors.push(`Colonne « ${first[index]} » : convertissez les dimensions en mètres avant l’import.`);
  });
  const rows = records.map(({ cells, sourceRow }) => {
    const line: MeasurementDraft = {};
    const rowErrors: string[] = [];
    fields.forEach((field, index) => {
      const raw = cells[index]?.trim() ?? '';
      // A recognized source unit is checked even when its column is ignored.
      const looksLikeUnit = field === 'ignore' && ['M³', 'M²', 'ML', 'KG', 'T', 'U'].includes(normalizedUnit(raw));
      if (field === 'unit' || hasHeader && inferred[index] === 'unit' || looksLikeUnit) {
        if (raw && normalizedUnit(raw) !== normalizedUnit(unit)) rowErrors.push(`Unité ${raw} incompatible avec ${unit} ; aucune conversion automatique.`);
      }
      if (field === 'designation') line.designation = raw;
      else if (field !== 'ignore' && field !== 'unit' && field !== 'unmapped' && raw) {
        const value = readMetreNumber(raw);
        if (value === undefined) rowErrors.push(`${columns.find((column) => column.field === field)?.label ?? field} : « ${raw} » n’est pas un nombre décimal valide.`);
        else line[field] = value;
      }
    });
    return { sourceRow, line, errors: [...rowErrors, ...validateMeasurement(unit, line)] };
  });
  return { rows, mapping: fields, hasHeader, headers: Array.from({ length: size }, (_, i) => hasHeader ? first[i] || `Colonne ${i + 1}` : `Colonne ${i + 1}`), errors };
}

export interface WorkTemplate { id: string; label: string; description: string; type: MetreCalcType }
const TEMPLATES: WorkTemplate[] = [
  { id: 'semelle', label: 'Semelles / massifs', description: 'Fondations rectangulaires répétées', type: 'volume' },
  { id: 'radier', label: 'Radier / dalle', description: 'Longueur × largeur × épaisseur', type: 'volume' },
  { id: 'poteau', label: 'Poteaux / voiles', description: 'Section rectangulaire × hauteur', type: 'volume' },
  { id: 'fouille', label: 'Fouilles / tranchées', description: 'Excavation à section rectangulaire', type: 'volume' },
  { id: 'surface', label: 'Surface rectangulaire', description: 'Dallage, étanchéité ou parement plan', type: 'surface' },
  { id: 'lineaire', label: 'Canalisation / longueur', description: 'Éléments linéaires identiques', type: 'lineaire' },
  { id: 'armatures', label: 'Armatures droites', description: 'Barres par élément × éléments × longueur développée', type: 'poids' },
  { id: 'comptage', label: 'Comptage d’ouvrages', description: 'Nombre d’éléments à mesurer', type: 'unite' },
];
export const templatesForUnit = (unit: string) => TEMPLATES.filter((template) => template.type === metreCalcType(unit));

export function buildTemplateLine(unit: string, templateId: string, values: MeasurementDraft, deduction = false) {
  const template = templatesForUnit(unit).find((candidate) => candidate.id === templateId);
  if (!template) return { line: {} as MeasurementDraft, errors: ['Ce modèle est incompatible avec l’unité du prix.'] };
  const line: MeasurementDraft = { designation: values.designation?.trim() || template.label };
  for (const column of entryColumns(unit)) {
    if (column.field !== 'designation' && column.field !== 'unit' && column.field !== 'ignore' && column.field !== 'unmapped') {
      const value = values[column.field];
      if (value != null) line[column.field] = value;
    }
  }
  if (template.type === 'poids') line.nombreElements = deduction ? -Math.abs(line.nombreElements ?? 1) : line.nombreElements ?? 1;
  else if (template.type === 'unite') { if (line.nombre != null && deduction) line.nombre = -Math.abs(line.nombre); }
  else line.nombreSemblables = deduction ? -Math.abs(line.nombreSemblables ?? 1) : line.nombreSemblables ?? 1;
  line.observations = `Modèle : ${template.label}${deduction ? ' · Déduction' : ''}`;
  return { line, errors: validateMeasurement(unit, line) };
}
