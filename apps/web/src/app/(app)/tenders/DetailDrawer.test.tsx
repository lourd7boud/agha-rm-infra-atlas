import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetailDrawer } from './DetailDrawer';
import type { TenderItem } from '@/lib/tenders';

test('the visible drawer heading uses the complete published subject', () => {
  const item: TenderItem = {
    id: '11111111-1111-4111-8111-111111111111', reference: 'TEST/1', buyerName: 'Commune X',
    procedure: 'AOO', procedureLabel: "Appel d'offres ouvert", objet: 'Travaux hydrauliques...',
    deadlineAt: '2027-01-01T10:00:00Z', publishedAt: '2026-11-09T10:00:00Z', pipelineState: 'detected', daysLeft: 10,
    region: 'Rabat', ville: 'Rabat', location: 'Rabat', category: 'Travaux', secteur: 'Hydraulique', lotCount: 1,
    lifecycleStatus: 'en_cours', lifecycleLabel: 'En cours', winner: null, competitors: [],
    portalDetail: { objet: 'Travaux hydrauliques - objet integral publie sur le portail', deadline: 'Mer 23 Dec 2026 10:00' },
  };
  const html = renderToStaticMarkup(<DetailDrawer item={item} onClose={() => {}} />);
  const headings = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/g)?.join(' ');
  expect(headings).toContain('Travaux hydrauliques - objet integral publie sur le portail');
  expect(headings).not.toContain('Travaux hydrauliques...');
  expect(html).toContain('Échéance relevée sur la fiche du portail');
  expect(html).toContain('23 décembre 2026 à 10:00');
});
