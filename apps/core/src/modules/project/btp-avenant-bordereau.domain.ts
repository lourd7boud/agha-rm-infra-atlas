import { z } from 'zod';
import { round2, toDecimal, type NormalizedBordereauLigne } from './btp-finance.domain';
import { BtpTransitionError } from './btp-registres.domain';

const qty = z.number().min(0).max(1_000_000_000);
const quantity = z.strictObject({
  ligneId: z.string().trim().min(1).max(100),
  ancienneQuantite: qty,
  nouvelleQuantite: qty,
});
const addition = z.strictObject({
  numero: z.number().int().positive().max(2_147_483_647),
  designation: z.string().trim().min(1).max(2_000),
  unite: z.string().trim().min(1).max(20),
  quantite: qty.refine((value) => value > 0),
  prixUnitaire: z.number().min(0).max(1_000_000_000),
  origine: z.enum(['marche', 'negocie']),
  formuleId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
});

export const avenantBordereauImpactSchema = z.strictObject({
  version: z.literal(1),
  tauxTva: z.number().min(0).max(100),
  dateEffet: z.iso.date(),
  dateSignatureTitulaire: z.iso.date().optional(),
  quantities: z.array(quantity).max(2_000),
  additions: z.array(addition).max(2_000),
}).superRefine((impact, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!impact.quantities.length && !impact.additions.length) issue('Ajouter au moins un poste ou une modification de quantité.');
  if (new Set(impact.quantities.map(({ ligneId }) => ligneId)).size !== impact.quantities.length) issue('Une ligne ne peut être modifiée qu’une fois par avenant.');
  if (new Set(impact.additions.map(({ numero }) => numero)).size !== impact.additions.length) issue('Numéros de prix en double.');
  if (impact.additions.some(({ origine }) => origine === 'negocie') && !impact.dateSignatureTitulaire) issue('Renseigner le jour de signature du titulaire pour les prix négociés.');
});

export type AvenantBordereauImpact = z.infer<typeof avenantBordereauImpactSchema>;

const formulaSnapshot = z.strictObject({
  id: z.string().uuid(),
  name: z.string().min(1),
  fixedPart: z.number().min(0).max(1),
  weights: z.record(z.string(), z.number().min(0).max(1)),
});

export const storedAvenantBordereauImpactSchema = avenantBordereauImpactSchema.safeExtend({
  additions: z.array(addition.extend({ formuleSnapshot: formulaSnapshot.optional() })).max(2_000),
});

export type StoredAvenantBordereauImpact = z.infer<typeof storedAvenantBordereauImpactSchema>;

export interface AppliedBordereauImpact {
  id: string;
  numero: number;
  reference: string;
  order: number;
  impact: StoredAvenantBordereauImpact;
}

export function projectAvenantBordereau(
  original: NormalizedBordereauLigne[], approved: AppliedBordereauImpact[], asOf?: string | null,
): NormalizedBordereauLigne[] {
  if (asOf === null || approved.length === 0) return original;
  const byId = new Map(original.map((line) => [line.id ?? String(line.numero), line]));
  for (const { id, numero, reference, impact } of [...approved].sort((a, b) => a.order - b.order)) {
    if (asOf !== undefined && impact.dateEffet > asOf) continue;
    for (const { ligneId, nouvelleQuantite } of impact.quantities) {
      const line = byId.get(ligneId);
      if (!line) throw new BtpTransitionError('Une modification approuvée ne retrouve plus son poste du bordereau.');
      byId.set(ligneId, {
        ...line, quantite: nouvelleQuantite,
        montant: round2(toDecimal(nouvelleQuantite).times(line.prixUnitaire)).toNumber(),
      });
    }
    for (const added of impact.additions) {
      const lineId = `avenant:${id}:${added.numero}`;
      byId.set(lineId, {
        id: lineId, numero: added.numero, designation: added.designation, unite: added.unite,
        quantite: added.quantite, prixUnitaire: added.prixUnitaire,
        montant: round2(toDecimal(added.quantite).times(added.prixUnitaire)).toNumber(),
        avenant: {
          id, numero, reference, dateEffet: impact.dateEffet,
          baseDate: added.origine === 'negocie' ? impact.dateSignatureTitulaire! : null,
          formuleId: added.formuleId ?? null,
          ...(added.formuleSnapshot ? { formuleSnapshot: added.formuleSnapshot } : {}),
        },
      });
    }
  }
  return [...byId.values()];
}

/** Validate a proposed signature against the price catalogue on its effect date. */
export function priceAvenantBordereau(
  original: NormalizedBordereauLigne[], approved: AppliedBordereauImpact[], impact: AvenantBordereauImpact,
): number {
  if (new Set(original.map((line) => line.id ?? String(line.numero))).size !== original.length) {
    throw new BtpTransitionError('Deux postes partagent le même identifiant dans le bordereau.');
  }
  const current = projectAvenantBordereau(original, approved);
  const occupied = new Set(current.map(({ numero }) => numero));
  const byId = new Map(projectAvenantBordereau(original, approved, impact.dateEffet)
    .map((line) => [line.id ?? String(line.numero), line]));
  const laterChanges = new Set(approved.filter((row) => row.impact.dateEffet > impact.dateEffet)
    .flatMap((row) => row.impact.quantities.map(({ ligneId }) => ligneId)));
  let ht = toDecimal(0);
  for (const { ligneId, ancienneQuantite, nouvelleQuantite } of impact.quantities) {
    const line = byId.get(ligneId);
    if (!line) throw new BtpTransitionError('Le poste à modifier n’existe pas à la date d’effet.');
    if (laterChanges.has(ligneId)) throw new BtpTransitionError('Un avenant approuvé à une date d’effet ultérieure modifie déjà ce poste.');
    if (!toDecimal(line.quantite).eq(ancienneQuantite)) throw new BtpTransitionError(`La quantité actuelle du prix n°${line.numero} diffère de la quantité portée sur l’avenant.`);
    ht = ht.plus(toDecimal(nouvelleQuantite).minus(ancienneQuantite).times(line.prixUnitaire));
  }
  for (const line of impact.additions) {
    if (occupied.has(line.numero)) throw new BtpTransitionError(`Le prix n°${line.numero} existe déjà dans le bordereau.`);
    ht = ht.plus(toDecimal(line.quantite).times(line.prixUnitaire));
  }
  const ttc = round2(ht.times(toDecimal(impact.tauxTva).div(100).plus(1))).toNumber();
  if (!Number.isFinite(ttc) || Math.abs(ttc) > 1_000_000_000) {
    throw new BtpTransitionError('Le montant calculé de l’avenant dépasse la limite autorisée.');
  }
  return ttc;
}
