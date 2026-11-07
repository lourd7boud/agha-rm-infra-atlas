import { BtpTransitionError } from './btp-registres.domain';
import { computeMetreTotals, type MetreLigne, type MetreSousSection } from './btp-metre.domain';

const unitKey = (value: string) => value.trim().toUpperCase().replace('3', '³').replace('2', '²');

export function appendTerrainMeasurement(
  unite: string,
  lignes: MetreLigne[],
  source: { id: string; designation: string; unite: string; quantite: number; note: string | null },
  sousSections: MetreSousSection[] = [],
) {
  if (unitKey(unite) !== unitKey(source.unite)) throw new BtpTransitionError('Unité terrain différente du bordereau');
  if (!Number.isFinite(source.quantite) || source.quantite <= 0) throw new BtpTransitionError('Quantité terrain invalide');
  const id = `terrain-${source.id}`;
  const next = lignes.some((l) => l.id === id) ? lignes : [...lignes, {
    id,
    designation: source.designation,
    partiel: source.quantite,
    observations: `Attachement terrain ${source.id}${source.note ? ` · ${source.note}` : ''}`,
  }];
  return computeMetreTotals(unite, sousSections, next);
}

/** Linked quantities must be corrected through their source, never silently edited in a métré. */
export function assertTerrainMeasurementsPreserved(before: MetreLigne[], after: MetreLigne[]): void {
  if (new Set(after.map((l) => l.id)).size !== after.length) {
    throw new BtpTransitionError('Identifiants de lignes dupliqués dans le métré');
  }
  for (const ligne of before.filter((l) => l.id.startsWith('terrain-'))) {
    const replacement = after.find((l) => l.id === ligne.id);
    const dimensions: (keyof MetreLigne)[] = ['partiel', 'longueur', 'largeur', 'profondeur', 'nombre', 'nombreSemblables', 'nombreElements', 'diametre', 'subSectionId', 'sectionId'];
    if (!replacement || dimensions.some((key) => replacement[key] !== ligne[key])) {
      throw new BtpTransitionError('Une quantité terrain intégrée ne peut pas être modifiée ou supprimée dans le métré');
    }
  }
  if (after.some((l) => l.id.startsWith('terrain-') && !before.some((old) => old.id === l.id))) {
    throw new BtpTransitionError('Une quantité terrain doit être intégrée depuis son attachement');
  }
}
