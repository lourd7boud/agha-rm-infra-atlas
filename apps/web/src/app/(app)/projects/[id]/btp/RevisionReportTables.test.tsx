import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RevisionReport } from '@/lib/btp-shared';
import { RevisionReportTables } from './RevisionReportTables';

describe('standalone desktop price revision tables', () => {
  it('shows base indices, monthly ratios and signed amounts directly for reconstructed paid statements', () => {
    const report = {
      project: { reference: 'TEST', name: 'Travaux' }, mode: 'final_only', cutoff: '2026-03-10', baseDate: '2025-12-01',
      coefficientGroups: [{ id: 'base', label: 'Marché', baseDate: '2025-12-01', baseValues: { TEST: 100 }, basePublication: null,
        indices: ['TEST'], formula: 'C = 0.2 + 0.8 × TEST/TEST0 − 1',
        months: [{ month: '2026-01', values: { TEST: 87.5 }, ratios: { TEST: 0.875 }, coefficient: -0.1,
          publication: { source: 'Bulletin', publishedOn: null, status: 'definitif' }, statementNumeros: [1] }] }],
      rows: [{ decompteId: 'd1', numero: 1, isDernier: true, dateDecompte: null, statut: 'paid', origin: 'reconstituted',
        cutoff: '2026-03-10',
        start: '2026-01-01', end: '2026-01-31', totalDays: 31, ht: 1000, appliedCoefficient: -0.1, amount: -100,
        postedCumulative: 0, issues: [], warnings: ['Publication à vérifier.'],
        months: [{ month: '2026-01', days: 31, ht: 1000, coefficient: -0.1, amount: -100, publication: null, missing: [] }] }],
      warnings: [], summary: { calculatedTotal: -100, availableTotal: -100, postedTotal: 0, balance: -100, pendingCount: 0, final: true },
    } as RevisionReport;
    const html = renderToStaticMarkup(<RevisionReportTables report={report} projectId="project" />);
    expect(html.match(/<table\b/g)).toHaveLength(2);
    expect(html).toContain('Calcul des coefficients');
    expect(html).toContain('Calcul de la révision');
    expect(html).toContain('0,8750');
    expect(html).toContain('-0,1000');
    expect(html).toContain('Reconstitution');
    expect(html).toContain('Date de publication à vérifier');
    expect(html).toContain('Montant total de la révision HT');
    expect(html).toContain('-100,00');
  });
});
