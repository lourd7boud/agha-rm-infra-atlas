import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { TenderItem } from '@/lib/tenders';
import { TenderReviewList } from './TenderReviewList';

const tender: TenderItem = {
  id: 'example', reference: '21/2026', buyerName: 'Commune de Rabat',
  objet: 'Travaux de réhabilitation du réseau hydraulique',
  procedure: 'AOO', procedureLabel: 'Appel d’offres ouvert',
  deadlineAt: '2026-11-18T23:30:00Z', publishedAt: '2026-11-08T10:00:00Z',
  pipelineState: 'detected', daysLeft: 7, region: 'Rabat-Salé-Kénitra',
  ville: 'Rabat', location: 'Salé', category: 'Travaux', secteur: 'Hydraulique', lotCount: 1,
  lifecycleStatus: 'en_cours', lifecycleLabel: 'En cours', winner: null, competitors: [],
};

function render(item: TenderItem) {
  return renderToStaticMarkup(<TenderReviewList items={[item]} selectedId={null} onSelect={() => {}} isSeen={() => true} now={Date.parse('2026-11-18T23:15:00Z')} />);
}

test('shows the Casablanca closing time, published zero caution and DCE state in the result', () => {
  const html = render({ ...tender, cautionProvisoireMad: 0, dossierExtractedAt: '2026-11-10T10:00:00Z' });
  expect(html).toContain('18/11/2026 23:30');
  expect(html).toContain('Moins de 24 h');
  expect(html).toContain('0 MAD');
  expect(html).toContain('DCE analysé');
  expect(html).toContain('Salé');
});

test('labels missing evidence and keeps a closed result out of the urgency state', () => {
  const html = render({ ...tender, location: null, region: 'Non localisé', lifecycleStatus: 'cloture', lifecycleLabel: 'Clôturé' });
  expect(html).toContain('Lieu à confirmer');
  expect(html).toContain('DCE à examiner');
  expect(html.match(/Non renseigné/g)).toHaveLength(2);
  expect(html).toContain('Clôturé');
  expect(html).not.toContain('Moins de 24 h');
});

test('flags inconsistent source deadlines and bases urgency on the earlier one', () => {
  const html = render({ ...tender, deadlineAt: '2026-11-28T12:00:00Z', portalDetailDeadline: 'Jeu 19 Nov 2026 10:00' });
  expect(html).toContain('Deux dates publiées');
  expect(html).toContain('Moins de 24 h');
  expect(render({ ...tender, portalDetailDeadline: 'Mer 18 Nov 2026 23:30' })).not.toContain('Deux dates publiées');
});
