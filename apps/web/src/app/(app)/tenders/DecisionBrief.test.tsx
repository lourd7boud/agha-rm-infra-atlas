import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionBrief } from './DecisionBrief';
import type { TenderItem } from '@/lib/tenders';

test('Samir displays saved provenance and does not imply a current official DCE revision', () => {
  const item = {
    id: '1', reference: 'TEST/1', objet: 'Travaux', category: 'Travaux', deadlineAt: '2027-01-01T10:00:00Z',
    lifecycleStatus: 'en_cours',
    samirReview: {
      checkedAt: '2026-11-12T21:00:00Z',
      source: { identity: '123/org', state: 'matched_snapshot', observedAt: '2026-11-11T10:00:00Z' },
      checks: { deadline: 'matched', caution: 'unverified', estimate: 'conflict' },
      documents: { state: 'available', filename: 'DAO.zip', cachedAt: '2026-11-10T10:00:00Z', currentRevision: 'unverified',
        complement: { state: 'listed', observedAt: '2026-11-11T10:00:00Z' } },
    },
  } as TenderItem;
  const html = renderToStaticMarkup(<DecisionBrief item={item} />);
  expect(html).toContain('Samir · Contrôle du radar');
  expect(html).toContain('123/org');
  expect(html).toContain('écart à vérifier');
  expect(html).toContain('Version officielle à confirmer');
  expect(html).toContain('DAO.zip');
  expect(html).toContain('Complément signalé sur le portail');
});
