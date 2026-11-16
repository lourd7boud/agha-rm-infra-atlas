import { describe, expect, it } from 'vitest';
import { avenantBordereauImpactSchema, priceAvenantBordereau, projectAvenantBordereau, type AppliedBordereauImpact } from './btp-avenant-bordereau.domain';

const original = [{ id: 'line-1', numero: 1, designation: 'Canal', unite: 'ML', quantite: 10, prixUnitaire: 5, montant: 50 }];
const proposed = avenantBordereauImpactSchema.parse({
  version: 1, tauxTva: 20, dateEffet: '2026-10-10', dateSignatureTitulaire: '2026-10-15',
  quantities: [{ ligneId: 'line-1', ancienneQuantite: 10, nouvelleQuantite: 8 }],
  additions: [{ numero: 2, designation: 'Béton', unite: 'M³', quantite: 2, prixUnitaire: 100, origine: 'negocie' }],
});
const applied: AppliedBordereauImpact = { id: 'signed-1', numero: 1, reference: 'AV-SIG-1', order: 1, impact: proposed };

describe('signed BPU amendment projection', () => {
  it('prices signed quantities once and preserves original lines before the effective day', () => {
    expect(priceAvenantBordereau(original, [], proposed)).toBe(228);
    expect(projectAvenantBordereau(original, [applied], '2026-10-09')).toEqual(original);
    expect(projectAvenantBordereau(original, [applied], '2026-10-10')).toMatchObject([
      { id: 'line-1', quantite: 8, prixUnitaire: 5, montant: 40 },
      { id: 'avenant:signed-1:2', quantite: 2, prixUnitaire: 100, avenant: {
        reference: 'AV-SIG-1', dateEffet: '2026-10-10', baseDate: '2026-10-15', formuleId: null,
      } },
    ]);
    expect(original[0]?.quantite).toBe(10);
  });

  it('folds by booking order and prevents earlier changes to a line with a later booked quantity', () => {
    const next = { ...applied, id: 'signed-2', numero: 2, order: 2, impact: {
      ...proposed, additions: [], quantities: [{ ligneId: 'line-1', ancienneQuantite: 8, nouvelleQuantite: 12 }],
    } };
    expect(projectAvenantBordereau(original, [next, applied])[0]?.quantite).toBe(12);
    expect(() => priceAvenantBordereau(original, [applied], { ...next.impact, dateEffet: '2026-10-09' })).toThrow(/ultérieure/);
    expect(() => priceAvenantBordereau(original, [applied], proposed)).toThrow(/diffère/);
    expect(() => priceAvenantBordereau(original, [applied], { ...proposed, quantities: [] })).toThrow(/existe déjà/);
  });

  it('requires titular signature for negotiated prices and disallows a supplied formula snapshot', () => {
    expect(avenantBordereauImpactSchema.safeParse({ ...proposed, dateSignatureTitulaire: undefined }).success).toBe(false);
    expect(avenantBordereauImpactSchema.safeParse({ ...proposed, additions: [{ ...proposed.additions[0], formuleSnapshot: {} }] }).success).toBe(false);
  });

  it('rejects a derived TTC amount outside the supported amendment range', () => {
    const impact = { ...proposed, quantities: [], additions: [{ ...proposed.additions[0]!, quantite: 1_000_000, prixUnitaire: 1_000_000 }] };
    expect(() => priceAvenantBordereau(original, [], impact)).toThrow(/limite autorisée/);
  });
});
