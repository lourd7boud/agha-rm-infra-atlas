import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BtpProjectDetail, Decompte, Periode, RevisionView } from '@/lib/btp-shared';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiGet }));
vi.mock('@/lib/btp', async () => import('@/lib/btp-shared'));
vi.mock('../actions', () => ({ patchDecompte: async () => {} }));
import { ProjectJourney } from './ProjectJourney';
import DecompteDetailPage from '../decomptes/[decompteId]/page';

const project = {
  id: 'marche', reference: 'M/2026', name: 'Travaux', ordreServiceDate: '2026-01-01',
  executionStartDate: null, delaiMois: 6, counts: { bordereauLignes: 3, periodes: 0, decomptes: 0 },
} as BtpProjectDetail;
const period = { id: 'p1', numero: 1, dateFin: '2026-02-28', metresCount: 2 } as Periode;
const decompte = { id: 'd1', periodeId: 'p1', numero: 1, statut: 'draft', isDernier: false } as Decompte;

async function render(overrides: Partial<BtpProjectDetail> = {}, periods: Periode[] = [], decomptes: Decompte[] = [], revision = { config: null, table: [] } as unknown as RevisionView) {
  apiGet.mockImplementation((path: string) => Promise.resolve(path.endsWith('/periodes') ? periods : path.endsWith('/decomptes') ? decomptes : revision));
  return renderToStaticMarkup(await ProjectJourney({ project: { ...project, ...overrides } }));
}

describe('next useful action in the project journey', () => {
  beforeEach(() => { apiGet.mockReset(); });

  it('points to the existing project record when the OS or contractual delay is missing', async () => {
    const html = await render({ ordreServiceDate: null, delaiMois: null });
    expect(html).toContain('Renseigner l’OS et le délai');
    expect(html).toContain('/projects/marche?section=admin&amp;tab=apercu');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('uses an explicit execution start without demanding that it be entered as an OS again', async () => {
    const html = await render({ ordreServiceDate: null, executionStartDate: '2026-01-02', counts: { ...project.counts, bordereauLignes: 0 } });
    expect(html).toContain('Compléter le bordereau');
  });

  it('opens service orders when only the effective start is missing', async () => {
    const html = await render({ ordreServiceDate: null });
    expect(html).toContain('Vérifier l’ordre de démarrage');
    expect(html).toContain('tab=ods');
  });

  it('guides a prepared project to its first measurement without another setup form', async () => {
    expect(await render()).toContain('Créer le premier métré');
  });

  it('returns to the incomplete source measurement rather than its empty generated decompte', async () => {
    const html = await render({ counts: { ...project.counts, periodes: 1, decomptes: 1 } }, [{ ...period, metresCount: 0 }], [decompte]);
    expect(html).toContain('Compléter le métré n°1');
    expect(html).toContain('/projects/marche/metres/p1');
  });

  it('takes a measured period directly to the document for date and submission', async () => {
    const html = await render({ counts: { ...project.counts, periodes: 1, decomptes: 1 } }, [period], [decompte]);
    expect(html).toContain('Vérifier et soumettre le décompte n°1');
    expect(html).toContain('/projects/marche/decomptes/d1');
  });

  it('resolves pending revision on a final statement before suggesting validation', async () => {
    const revision = { config: { isEnabled: true }, table: [{ decompteId: 'd1', trace: { status: 'pending' } }] } as unknown as RevisionView;
    const html = await render({ counts: { ...project.counts, periodes: 1, decomptes: 1 } }, [period], [{ ...decompte, isDernier: true, statut: 'submitted', dateDecompte: '2026-03-04' }], revision);
    expect(html).toContain('Compléter la révision du dernier décompte');
    expect(html).toContain('tab=revision');
  });

  it('continues with the next measurement after payment of an interim statement', async () => {
    expect(await render({ counts: { ...project.counts, periodes: 1, decomptes: 1 } }, [period], [{ ...decompte, statut: 'paid' }])).toContain('Créer le prochain métré');
  });

  it('offers exports only after the final statement is paid', async () => {
    const html = await render({ counts: { ...project.counts, periodes: 1, decomptes: 1 } }, [period], [{ ...decompte, statut: 'paid', isDernier: true }]);
    expect(html).toContain('Exporter le dossier');
    expect(html).not.toContain('Créer le prochain métré');
  });

  it('prioritizes a newer draft over an earlier validated statement awaiting payment', async () => {
    const html = await render({ counts: { ...project.counts, periodes: 2, decomptes: 2 } }, [period, { ...period, id: 'p2', numero: 2 }], [{ ...decompte, statut: 'validated' }, { ...decompte, id: 'd2', periodeId: 'p2', numero: 2 }]);
    expect(html).toContain('Vérifier et soumettre le décompte n°2');
    expect(html).not.toContain('Enregistrer le paiement');
  });

  it('sends an undated final statement to validation even when its preview is pending', async () => {
    const revision = { config: { isEnabled: true }, table: [{ decompteId: 'd1', trace: { status: 'pending' } }] } as unknown as RevisionView;
    const html = await render({ counts: { ...project.counts, periodes: 1, decomptes: 1 } }, [period], [{ ...decompte, isDernier: true, statut: 'submitted', dateDecompte: null }], revision);
    expect(html).toContain('Vérifier et valider le décompte n°1');
    expect(html).toContain('/projects/marche/decomptes/d1');
  });
});

describe('date and statement circuit', () => {
  async function renderDocument(values: Partial<Decompte>, query: Record<string, string> = {}) {
    apiGet.mockImplementation((path: string) => Promise.resolve(path.endsWith('/d1') ? {
      ...decompte, lignes: [], dateDecompte: null, ...values,
    } : project));
    return renderToStaticMarkup(await DecompteDetailPage({ params: Promise.resolve({ id: project.id, decompteId: 'd1' }), searchParams: Promise.resolve(query) }));
  }

  it('submits without a date entry and keeps the official external date in a separate disclosure', async () => {
    const html = await renderDocument({});
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0]);
    const statusForm = forms.find((form) => /<button(?=[^>]*name="statut")(?=[^>]*value="submitted")[^>]*>/.test(form));
    expect(statusForm).toContain('La date d’établissement sera enregistrée à la soumission.');
    expect(statusForm).not.toContain('name="dateDecompte"');
    expect(html).toContain('Décompte établi hors ATLAS');
  });

  it('validates using the recorded date without sending it again', async () => {
    const html = await renderDocument({ statut: 'submitted', dateDecompte: '2026-03-04' });
    const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].find((match) => /<button(?=[^>]*name="statut")(?=[^>]*value="validated")[^>]*>/.test(match[0]))?.[0];
    expect(form).toBeDefined();
    expect(form).not.toContain('name="dateDecompte"');
    expect(html).toContain('établi le 04/03/2026');
  });

  it('links to the pending final revision and keeps any official date correction optional', async () => {
    const html = await renderDocument({ statut: 'submitted', isDernier: true, revision: { details: { version: 1, status: 'pending', period: { ht: 50 } }, montantAReviser: null, coefficient: null, montantRevision: null } });
    expect(html).toMatch(/<button(?=[^>]*name="statut")(?=[^>]*value="validated")[^>]*>/);
    expect(html).toContain('name="dateDecompte"');
    expect(html).toContain('Reprendre la date officielle');
    expect(html).toContain('tab=revision');
  });

  it('preserves the read-only date on validated historical statements and offers the existing unlock action', async () => {
    const html = await renderDocument({ statut: 'validated', dateDecompte: null });
    expect(html).not.toContain('name="dateDecompte"');
    expect(html).toContain('Déverrouiller (brouillon)');
    expect(html).toContain('Date historique non renseignée');
  });

  it('shows a failed action beside the date and status controls', async () => {
    const html = await renderDocument({ statut: 'submitted' }, { error: 'patchDecompte', code: 'conflict' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Action non enregistrée');
  });
});
