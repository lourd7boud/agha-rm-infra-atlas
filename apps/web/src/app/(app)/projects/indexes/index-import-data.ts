import type { IndexImportPayload } from './index-import-types';

function text(entry: FormDataEntryValue | null): string {
  return typeof entry === 'string' ? entry.trim() : '';
}

export function parseCodeValues(form: FormData, codeField: string, valueField: string, allowEmpty = false): Record<string, number> {
  const codes = form.getAll(codeField);
  const values = form.getAll(valueField);
  const parsed: Record<string, number> = Object.create(null) as Record<string, number>;
  codes.forEach((entry, index) => {
    const code = text(entry);
    const raw = text(values[index] ?? null);
    if (!code && !raw) return;
    const value = Number(raw.replace(',', '.'));
    if (!code || !raw || !Number.isFinite(value) || value < 0) throw new Error('Complétez chaque code et sa valeur avec un nombre valide.');
    if (Object.hasOwn(parsed, code)) throw new Error(`Le code ${code} figure plusieurs fois.`);
    parsed[code] = value;
  });
  if (!allowEmpty && !Object.keys(parsed).length) throw new Error('Renseignez au moins un code et sa valeur.');
  return parsed;
}

export function reviewedIndexImport(form: FormData): IndexImportPayload {
  const reference = text(form.get('reference'));
  const publishedOn = text(form.get('publishedOn'));
  const publicationEvidence = text(form.get('publicationEvidence'));
  if (!reference || !/^\d{4}-\d{2}-\d{2}$/.test(publishedOn) || !publicationEvidence) {
    throw new Error('Renseignez la référence, la date de publication et la pièce qui établit cette date.');
  }
  const selected = form.getAll('reviewedMonth').map(text);
  if (!selected.length) throw new Error('Sélectionnez au moins un mois après vérification des valeurs et du statut.');
  const months = selected.map((key) => {
    const month = text(form.get(`month:${key}`)).slice(0, 7);
    const status = text(form.get(`status:${key}`));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (status !== 'provisoire' && status !== 'definitif')) {
      throw new Error('Vérifiez le mois et choisissez son statut officiel.');
    }
    const indexValues = parseCodeValues(form, `code:${key}`, `value:${key}`);
    if (Object.values(indexValues).some((value) => value <= 0)) throw new Error('Les valeurs des indices doivent être supérieures à zéro.');
    return { month, status, indexValues } as IndexImportPayload['months'][number];
  });
  if (new Set(months.map(({ month }) => month)).size !== months.length) throw new Error('Chaque mois doit figurer une seule fois.');
  return { reference, publishedOn, publicationEvidence, months };
}
