import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DceRevisionActions, DceRevisionResult, revisionUpdatesDossier, type DceRevisionEvidence } from './DceRevisionCheck';

const base = {
  version: 1 as const, officialIdentity: '1058286/o8p', checkedAt: '2026-11-13T20:00:00Z',
  changedFiles: [], addedFiles: [], removedFiles: [],
};

test('unchanged documents are confirmed only as of the dated source check', () => {
  const html = renderToStaticMarkup(<DceRevisionResult evidence={{ ...base, state: 'unchanged', documentsIdentical: true }} />);
  expect(html).toContain('Documents identiques lors du contrôle');
  expect(html).toContain('20:00');
  expect(html).toContain('ne valide pas les conditions de participation');
  expect(html).not.toContain('lecture à reprendre');
  expect(revisionUpdatesDossier({ ...base, state: 'unchanged' })).toBe(false);
});

test('updated and newly downloaded archives require document reading', () => {
  const evidence: DceRevisionEvidence = { ...base, state: 'updated', changedFiles: ['RC.pdf'], addedFiles: ['Rectificatif.pdf'] };
  const html = renderToStaticMarkup(<DceRevisionResult evidence={evidence} />);
  expect(html).toContain('Dossier actualisé · lecture à reprendre');
  expect(html).toContain('RC.pdf');
  expect(html).toContain('Rectificatif.pdf');
  expect(revisionUpdatesDossier(evidence)).toBe(true);
  expect(revisionUpdatesDossier({ ...base, state: 'downloaded' })).toBe(true);
});

test('unavailable or unchecked source does not assert the current official revision', () => {
  const html = renderToStaticMarkup(<DceRevisionResult evidence={{ ...base, state: 'unavailable', reason: 'scheduled_closure', retryAt: '2026-11-14T07:30:00Z' }} />);
  expect(html).toContain('Version officielle non confirmée');
  expect(html).toContain('fermée pour la nuit');
  expect(html).toContain('07:30');
  expect(html).not.toContain('Documents identiques');
  const unchecked = renderToStaticMarkup(<DceRevisionResult evidence={{ state: 'not_checked' }} />);
  expect(unchecked).toContain('Version officielle à vérifier');
  expect(revisionUpdatesDossier({ state: 'not_checked' })).toBe(false);
});

test('an anonymous refusal preserves the official link and offers a separate account withdrawal', () => {
  const evidence: DceRevisionEvidence = { ...base, state: 'unavailable', reason: 'anonymous_unavailable' };
  const html = renderToStaticMarkup(<><DceRevisionResult evidence={evidence} /><DceRevisionActions evidence={evidence} busy={null} onCheck={() => {}} /></>);
  expect(html).toContain('Consulter le DCE sur le portail officiel');
  expect(html).toContain('Vérifier la source officielle');
  expect(html).toContain('Télécharger avec le compte de l’entreprise');
  expect(html).toContain('accepte les conditions du portail et enregistre un retrait au nom de l’entreprise');
  expect(html).toContain('aria-describedby=');
});

test('the account option respects the retry delay and does not follow a generic anonymous failure', () => {
  const evidence: DceRevisionEvidence = { ...base, state: 'unavailable', reason: 'download_failed' };
  const render = (value: DceRevisionEvidence) => renderToStaticMarkup(<DceRevisionActions evidence={value} busy={null} onCheck={() => {}} />);
  expect(render(evidence)).not.toContain('Télécharger avec le compte');
  expect(render({ ...evidence, mode: 'account', retryAt: '9999-11-14T07:30:00Z' })).not.toContain('Télécharger avec le compte');
  expect(render({ ...evidence, mode: 'account' })).toContain('Télécharger avec le compte');
  expect(render({ ...evidence, mode: 'account', officialIdentity: 'other/source' })).not.toContain('Télécharger avec le compte');
});
