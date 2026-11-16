import { describe, expect, it } from 'vitest';
import { parseAvenantBordereauImpact } from './avenant-form-data';

const structuredForm = () => {
  const form = new FormData();
  form.set('avenantMode', 'bordereau');
  form.set('impactDateEffet', '2026-02-01');
  form.set('impactTauxTva', '20');
  return form;
};

function addQuantity(form: FormData, newQuantity: string) {
  form.append('quantityLine', 'existing-line');
  form.append('oldQuantity', '5');
  form.append('newQuantity', newQuantity);
}

function addArticle(form: FormData, origine: string, formuleId = '') {
  for (const [name, value] of Object.entries({
    articleNumero: '17', articleDesignation: 'Pompe', articleUnite: 'U', articleQuantite: '2',
    articlePrixUnitaire: '230,50', articleOrigine: origine, articleFormuleId: formuleId,
  })) form.append(name, value);
}

describe('signed amendment impact form', () => {
  it('leaves total-only amendments on the existing flow', () => {
    const form = structuredForm();
    form.set('avenantMode', 'total');
    addQuantity(form, '2');
    expect(parseAvenantBordereauImpact(form)).toBeUndefined();
  });

  it('keeps the source quantity and an explicit zero when the signed item is removed', () => {
    const form = structuredForm();
    addQuantity(form, '0');
    expect(parseAvenantBordereauImpact(form)).toEqual({
      version: 1, tauxTva: 20, dateEffet: '2026-02-01',
      quantities: [{ ligneId: 'existing-line', ancienneQuantite: 5, nouvelleQuantite: 0 }], additions: [],
    });
  });

  it('rejects a blank or unchanged quantity instead of silently reducing the item to zero', () => {
    for (const value of ['', '5']) {
      const form = structuredForm();
      addQuantity(form, value);
      expect(() => parseAvenantBordereauImpact(form)).toThrow(/quantité/i);
    }
  });

  it('preserves the price origin and an explicit signed formula without requiring an override', () => {
    const form = structuredForm();
    form.set('impactDateSignatureTitulaire', '2026-01-31');
    addArticle(form, 'marche', 'other-formula');
    const result = parseAvenantBordereauImpact(form);
    expect(result).toMatchObject({ additions: [{ numero: 17, prixUnitaire: 230.5, origine: 'marche', formuleId: 'other-formula' }] });
    expect(result?.dateSignatureTitulaire).toBeUndefined();
    const negotiated = structuredForm();
    negotiated.set('impactDateSignatureTitulaire', '2026-01-31');
    addArticle(negotiated, 'negocie');
    expect(parseAvenantBordereauImpact(negotiated)).toMatchObject({ dateSignatureTitulaire: '2026-01-31', additions: [{ origine: 'negocie' }] });
  });

  it('requires the signed base date for negotiated additions', () => {
    const form = structuredForm();
    addArticle(form, 'negocie');
    expect(() => parseAvenantBordereauImpact(form)).toThrow(/signature par le titulaire/);
  });

  it('requires at least one structured item and an explicit VAT rate', () => {
    const form = structuredForm();
    expect(() => parseAvenantBordereauImpact(form)).toThrow(/au moins/i);
    addArticle(form, 'marche');
    form.set('impactTauxTva', '');
    expect(() => parseAvenantBordereauImpact(form)).toThrow(/TVA/i);
  });
});
