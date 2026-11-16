import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Avenant } from '@/lib/btp-shared';
import { AvenantForm } from './AvenantForm';

const draft = {
  id: 'avenant', numero: 2, objet: 'Buses et terrassement', reference: 'AV-02',
  statut: 'brouillon', typeAvenant: 'mixte', montantDeltaMad: 5280, delaiDeltaMois: 1,
  dateAvenant: '2026-05-01', observations: 'Pièce déjà vérifiée',
  bordereauImpact: {
    version: 1, tauxTva: 20, dateEffet: '2026-05-02', dateSignatureTitulaire: '2026-04-28',
    quantities: [{ ligneId: 'line', ancienneQuantite: 18.5, nouvelleQuantite: 12 }],
    additions: [{ numero: 8, designation: 'Gravier', unite: 'M³', quantite: 4, prixUnitaire: 7.2, origine: 'negocie', formuleId: 'stored-formula' }],
  },
} as Avenant;

describe('editing a recorded amendment', () => {
  it('renders the stored baseline and every signed input before a current catalogue is loaded', () => {
    const html = renderToStaticMarkup(<AvenantForm projectId="project" formulas={[]} draft={draft}
      createAction={async () => ({})} loadBordereauAction={async () => ({ lines: [] })} />);
    const input = (name: string, value: string) => new RegExp(`<input(?=[^>]*name="${name}")(?=[^>]*value="${value}")[^>]*>`);
    expect(html).toMatch(input('oldQuantity', '18.5'));
    expect(html).toMatch(input('newQuantity', '12'));
    expect(html).toMatch(input('articleDesignation', 'Gravier'));
    expect(html).toMatch(input('articlePrixUnitaire', '7.2'));
    expect(html).toMatch(input('impactDateSignatureTitulaire', '2026-04-28'));
    expect(html).toMatch(input('observations', 'Pièce déjà vérifiée'));
    expect(html).toContain('Formule enregistrée dans l’avenant');
    expect(html).toContain('Enregistrer les modifications du brouillon');
  });
});
