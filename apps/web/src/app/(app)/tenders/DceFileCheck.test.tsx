import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DceFileCheckResult, DceOcrResult, type DceFileEvidence, type DceOcrEvidence } from './DceFileCheck';

test('a scanned sample never claims complete reading or current official revision', () => {
  const evidence: DceFileEvidence = {
    filename: 'RC.pdf', sha256: 'abc123', sizeBytes: 1200, checkedAt: '2026-11-12T20:00:00Z',
    state: 'needs_ocr', coverage: 'partial', totalPages: 21, pagesInspected: 5,
    pages: [{ num: 1, characterCount: 0, snippet: '', textTruncated: false }],
  };
  const html = renderToStaticMarkup(<DceFileCheckResult evidence={evidence} />);
  expect(html).toContain('5/21 pages examinées');
  expect(html).toContain('OCR nécessaire');
  expect(html).toContain('Échantillon des premières pages');
  expect(html).not.toContain('Toutes les pages');
  expect(html).toContain('ne valide ni les conditions du marché ni la version officielle actuelle');
  expect(html).toContain('abc123');
  expect(html).toContain('20:00');
});

test('partial OCR keeps unreadable and unprocessed pages explicit', () => {
  const evidence: DceOcrEvidence = {
    filename: 'CPS.pdf', sha256: 'source-hash', checkedAt: '2026-11-13T20:00:00Z',
    state: 'mixed', coverage: 'partial', totalPages: 3, pagesProcessed: 2,
    pages: [
      { num: 1, state: 'text', characterCount: 99, snippet: 'Article 7 — visite obligatoire.', textTruncated: true },
      { num: 2, state: 'no_text', characterCount: 0, snippet: '', textTruncated: false },
      { num: 3, state: 'not_processed', characterCount: 0, snippet: '', textTruncated: false },
    ],
  };
  const html = renderToStaticMarkup(<DceOcrResult evidence={evidence} />);
  expect(html).toContain('2/3 pages traitées');
  expect(html).toContain('Lecture partielle');
  expect(html).toContain('Sans texte exploitable après OCR');
  expect(html).toContain('Non traitée');
  expect(html).toContain('texte limité');
  expect(html).toContain('Article 7 — visite obligatoire.');
  expect(html).toContain('source-hash');
  expect(html).not.toContain('Toutes les pages traitées');
  expect(html).toContain('ne valide ni les conditions du marché ni la version officielle actuelle');
});

test('failed OCR does not turn unknown page count into a completed reading', () => {
  const html = renderToStaticMarkup(<DceOcrResult evidence={{
    filename: 'RC.pdf', sha256: 'source-hash', checkedAt: '2026-11-13T20:00:00Z',
    state: 'failed', coverage: 'none', totalPages: null, pagesProcessed: 0, pages: [],
  }} />);
  expect(html).toContain('Lecture OCR non aboutie');
  expect(html).toContain('Nombre de pages non déterminé');
  expect(html).not.toContain('0/0');
  expect(html).not.toContain('Toutes les pages traitées');
});
