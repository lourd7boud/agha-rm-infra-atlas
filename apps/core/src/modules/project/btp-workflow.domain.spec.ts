import { describe, expect, it } from 'vitest';
import { resolveRevisionDates } from './btp-workflow.domain';

const project = {
  ordreServiceDate: new Date('2026-01-01T00:00:00Z'), executionStartDate: null,
  dateLimiteRemiseOffres: new Date('2025-12-15T00:00:00Z'),
  typeMarche: 'normal', modePassation: 'ao_ouvert', delaiMois: 6, arrets: [],
};

describe('réutilisation des références contractuelles', () => {
  it('reprend le dépôt de l’offre et le calendrier existants sans ressaisie', () => {
    expect(resolveRevisionDates(project, null)).toMatchObject({
      baseDate: project.dateLimiteRemiseOffres, baseSource: 'offres',
      contractDeadline: new Date('2026-07-02T00:00:00Z'), deadlineSource: 'calendrier',
    });
    expect(resolveRevisionDates({ ...project, typeMarche: 'negocie' }, null).baseDate).toBeNull();
    expect(resolveRevisionDates({ ...project, modePassation: 'negocie' }, null).baseDate).toBeNull();
    expect(resolveRevisionDates({ ...project, modePassation: 'Marché négocié' }, null).baseDate).toBeNull();
  });

  it('conserve les corrections explicites et suit les prolongations approuvées', () => {
    const explicit = { baseDate: new Date('2025-12-20'), contractDeadline: new Date('2026-08-20') };
    expect(resolveRevisionDates(project, explicit, 1)).toMatchObject(explicit);
    expect(resolveRevisionDates(project, null, 1).contractDeadline).toEqual(new Date('2026-08-02'));
  });
});
