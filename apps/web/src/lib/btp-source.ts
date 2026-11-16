export interface BtpProjectSource {
  tenderId: string;
  reference: string;
  objet: string;
  buyerName: string;
  commune: string | null;
  procedure: string;
  dateLimite: string;
  sourceUrl: string | null;
  sourceVersion: string;
  sourceUpdatedAt: string;
  extractedAt: string | null;
  sourceFiles: string[];
  delaiMois: number | null;
  cautionProvisoireMad: number | null;
  cautionDefinitivePct: number | null;
  retenueGarantiePct: number | null;
  bpu: Array<{
    numero: number;
    designation: string;
    unite: string | null;
    quantite: number | null;
    prixUnitaire: number | null;
  }>;
}

/** The checked form must supply every contract value; an empty cell is unknown. */
export function reviewedSourceBordereau(form: FormData, source: BtpProjectSource) {
  if (form.get('reuseBpu') !== 'on') return undefined;
  const number = (name: string) => {
    const raw = form.get(name);
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error('BPU incomplet');
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) throw new Error('BPU invalide');
    return value;
  };
  if (source.bpu.length === 0) throw new Error('BPU absent');
  return { lignes: source.bpu.map((line) => {
    const unite = form.get(`bpu:${line.numero}:unite`);
    if (typeof unite !== 'string' || !unite.trim()) throw new Error('Unité manquante');
    return {
      numero: line.numero, designation: line.designation, unite: unite.trim(),
      quantite: number(`bpu:${line.numero}:quantite`),
      prixUnitaire: number(`bpu:${line.numero}:prixUnitaire`),
    };
  }) };
}
