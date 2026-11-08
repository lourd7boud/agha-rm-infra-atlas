import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ValidationQueue, toggleSelectedId } from './ValidationQueue';

vi.mock('../actions', () => ({
  validateSelectedEntries: vi.fn(),
  retrySalesReconciliation: vi.fn(),
}));

test('retains explicit selection across pages without selecting invisible entries', () => {
  const selected = toggleSelectedId(['first-page-id'], 'second-page-id');
  expect(selected).toEqual(['first-page-id', 'second-page-id']);
  expect(toggleSelectedId(selected, 'first-page-id')).toEqual(['second-page-id']);
});

test('requires explicit confirmation and exposes accessible status', () => {
  const html = renderToStaticMarkup(
    <ValidationQueue entries={[]} events={[]} canApprove={false} />,
  );
  expect(html).toContain('Confirmer la sélection');
  expect(html).toContain('aria-live="polite"');
  expect(html).not.toContain('Tout valider');
  expect(html).toContain('Lecture seule');
});
