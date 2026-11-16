import { describe, expect, test } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { buildFullDossierMarkdown, DOSSIER_COVERAGE_MARKER, MAX_DOSSIER_COVERAGE_CHARS, readDossierCoverage } from './dossier-fulltext';
import { createHash } from 'node:crypto';
import type { PdfTextExtractor } from './dossier-text';

// Treat "pdf bytes" as UTF-8 text so we exercise selection + full-read + bounding
// without real PDFs.
const echoPdf: PdfTextExtractor = async (bytes) => strFromU8(bytes);

function coverage(markdown: string) {
  expect(markdown.startsWith(DOSSIER_COVERAGE_MARKER)).toBe(true);
  return JSON.parse(markdown.slice(DOSSIER_COVERAGE_MARKER.length, markdown.indexOf('\n-->')).trim()) as {
    candidateCount: number;
    manifestTruncated: boolean;
    completeDce: boolean;
    latestRevisionVerified: boolean;
    files: { name: string; state: string; usedChars: number }[];
  };
}

describe('buildFullDossierMarkdown', () => {
  test('saved page-labelled OCR is used in chat without invoking a fresh extractor', async () => {
    const zip = zipSync({ 'RC.pdf': strToU8('scanned source') });
    const out = await buildFullDossierMarkdown(zip, async () => { throw new Error('fresh OCR forbidden'); }, undefined, undefined,
      async (name) => name === 'RC.pdf' ? '[Page 3 — OCR local]\nVisite obligatoire.' : null);
    expect(out.markdown).toContain('[Page 3 — OCR local]');
    expect(out.markdown).toContain('Visite obligatoire.');
    expect(coverage(out.markdown).files).toMatchObject([{ name: 'RC.pdf', state: 'readable' }]);
  });
  test('saved coverage is rejected for a changed archive or malformed manifest', async () => {
    const zip = zipSync({ 'CPS.pdf': strToU8('texte') });
    const { markdown } = await buildFullDossierMarkdown(zip, echoPdf);
    const sha = createHash('sha256').update(zip).digest('hex');
    expect(readDossierCoverage(markdown, sha)?.get('CPS.pdf')).toBe('readable');
    expect(readDossierCoverage(markdown, '0'.repeat(64))).toBeNull();
    expect(readDossierCoverage(markdown.replace('"state":"readable"', '"state":"invented"'), sha)).toBeNull();
    expect(readDossierCoverage(`${DOSSIER_COVERAGE_MARKER}\n{broken}\n-->`, sha)).toBeNull();
  });
  test('reads every data-bearing file in full, as ## Markdown sections, skipping templates', async () => {
    const zip = zipSync({
      'AVIS.pdf': strToU8('avis complet ' + 'x'.repeat(100)),
      'RC.pdf': strToU8('reglement complet ' + 'y'.repeat(100)),
      'DH AE.docx': strToU8('bidder template — must be excluded'),
    });

    const out = await buildFullDossierMarkdown(zip, echoPdf);

    expect(out.markdown).toContain('## AVIS.pdf');
    expect(out.markdown).toContain('## RC.pdf');
    expect(out.markdown).toContain('avis complet');
    expect(out.markdown).toContain('reglement complet');
    expect(out.markdown).not.toContain('must be excluded'); // template excluded
    // AVIS(0) before RC(2) by docPriority.
    expect(out.files.map((f) => f.name)).toEqual(['AVIS.pdf', 'RC.pdf']);
  });

  test('does NOT apply the summary bucket budget — a big RC is kept in full', async () => {
    // 80k chars — far past extractDossierText's 24k RC bucket cap.
    const zip = zipSync({ 'RC.pdf': strToU8('A'.repeat(80_000)) });
    const out = await buildFullDossierMarkdown(zip, echoPdf);
    expect(out.files[0]!.chars).toBe(80_000);
    expect(out.markdown.length).toBeGreaterThan(70_000);
  });

  test('bounds the total to maxChars', async () => {
    const zip = zipSync({ 'RC.pdf': strToU8('A'.repeat(5_000)) });
    const out = await buildFullDossierMarkdown(zip, echoPdf, undefined, 200);
    const body = out.markdown.slice(out.markdown.indexOf('\n-->') + 4).trim();
    expect(body.length).toBeLessThanOrEqual(260); // historical body budget + header
    expect(coverage(out.markdown).files).toEqual([{ name: 'RC.pdf', state: 'truncated', usedChars: 200 }]);
  });

  test('invalid archive → empty', async () => {
    const out = await buildFullDossierMarkdown(new Uint8Array([1, 2, 3]), echoPdf);
    expect(out.markdown).toBe('');
    expect(out.files).toEqual([]);
  });

  test('rejects a stored ZIP entry with inconsistent allocation sizes', async () => {
    const zip = zipSync({ 'AVIS.txt': strToU8('readable source') }, { level: 0 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let patched = false;
    for (let offset = 0; offset + 46 <= zip.byteLength; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 1, true);
        patched = true;
        break;
      }
    }
    expect(patched).toBe(true);
    const out = await buildFullDossierMarkdown(zip, echoPdf);
    expect(out).toEqual({ markdown: '', files: [] });
  });

  test('represents readable AVIS and empty CPS without claiming full DCE or current revision', async () => {
    const zip = zipSync({ 'AVIS.pdf': strToU8('avis lisible'), 'CPS.pdf': new Uint8Array() });
    const out = await buildFullDossierMarkdown(zip, echoPdf);
    expect(coverage(out.markdown)).toMatchObject({
      candidateCount: 2, manifestTruncated: false, completeDce: false, latestRevisionVerified: false,
      files: [
        { name: 'AVIS.pdf', state: 'readable', usedChars: 12 },
        { name: 'CPS.pdf', state: 'no_readable_text', usedChars: 0 },
      ],
    });
    expect(out.markdown).toContain('avis lisible');
  });

  test('represents files after exhaustion rather than silently dropping the tail', async () => {
    const zip = zipSync({ 'AVIS.pdf': strToU8('A'.repeat(30)), 'RC.pdf': strToU8('reglement') });
    const out = await buildFullDossierMarkdown(zip, echoPdf, undefined, 10);
    expect(coverage(out.markdown).files).toEqual([
      { name: 'AVIS.pdf', state: 'truncated', usedChars: 10 },
      { name: 'RC.pdf', state: 'skipped_budget', usedChars: 0 },
    ]);
  });

  test('PDF page sentinels do not count as readable document content', async () => {
    const out = await buildFullDossierMarkdown(zipSync({ 'CPS.pdf': strToU8('-- 1 of 2 --\n\n-- 2 of 2 --') }), echoPdf);
    expect(coverage(out.markdown).files).toEqual([{ name: 'CPS.pdf', state: 'no_readable_text', usedChars: 0 }]);
    expect(out.files).toEqual([]);
  });

  test('distinguishes known extraction failure from an empty text layer', async () => {
    const zip = zipSync({ 'CPS.pdf': strToU8('bad pdf'), 'RC.pdf': strToU8('empty') });
    const out = await buildFullDossierMarkdown(zip, async (data) => {
      if (strFromU8(data) === 'bad pdf') throw new Error('private parser error');
      return '';
    });
    expect(coverage(out.markdown).files).toEqual([
      { name: 'RC.pdf', state: 'no_readable_text', usedChars: 0 },
      { name: 'CPS.pdf', state: 'failed', usedChars: 0 },
    ]);
    expect(out.markdown).not.toContain('private parser error');
    expect(out.markdown).not.toContain('scanned');
  });

  test('caps the manifest and explicitly reports omitted records while retaining body text', async () => {
    const entries = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`document-${i}.txt`, strToU8(`text-${i}`)]));
    const out = await buildFullDossierMarkdown(zipSync(entries), echoPdf);
    const manifest = coverage(out.markdown);
    expect(manifest).toMatchObject({ candidateCount: 205, manifestTruncated: true });
    expect(manifest.files).toHaveLength(200);
    expect(out.files).toHaveLength(205);
    expect(out.markdown.indexOf('\n-->') + 4).toBeLessThanOrEqual(MAX_DOSSIER_COVERAGE_CHARS);
  });

  test('records an oversized candidate without inflating or extracting it', async () => {
    const zip = zipSync({ 'CPS.pdf': new Uint8Array(40 * 1024 * 1024 + 1), 'AVIS.pdf': strToU8('avis') });
    const out = await buildFullDossierMarkdown(zip, echoPdf);
    expect(coverage(out.markdown).files).toEqual([
      { name: 'AVIS.pdf', state: 'readable', usedChars: 4 },
      { name: 'CPS.pdf', state: 'skipped_size', usedChars: 0 },
    ]);
  });
});
