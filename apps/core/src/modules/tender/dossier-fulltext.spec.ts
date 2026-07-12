import { describe, expect, test } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { buildFullDossierMarkdown } from './dossier-fulltext';
import type { PdfTextExtractor } from './dossier-text';

// Treat "pdf bytes" as UTF-8 text so we exercise selection + full-read + bounding
// without real PDFs.
const echoPdf: PdfTextExtractor = async (bytes) => strFromU8(bytes);

describe('buildFullDossierMarkdown', () => {
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
    expect(out.markdown.length).toBeLessThanOrEqual(260); // 200 + the "## RC.pdf" header
  });

  test('invalid archive → empty', async () => {
    const out = await buildFullDossierMarkdown(new Uint8Array([1, 2, 3]), echoPdf);
    expect(out.markdown).toBe('');
    expect(out.files).toEqual([]);
  });
});
