import { describe, expect, test } from 'vitest';
import { toDossierMarkdown } from './dossier-markdown';

describe('toDossierMarkdown', () => {
  test('turns file headers into ## sections and pipe-rows into a GFM table', () => {
    const text = [
      '===== Bordereau.xlsx =====',
      'Désignation | Unité | Quantité | PU',
      'Béton | m3 | 90 | 1200',
      'Acier | kg | 500 | 15',
      '',
      '===== RC.pdf =====',
      'Article 1 : Objet du marché.',
    ].join('\n');

    const md = toDossierMarkdown(text);

    expect(md).toContain('## Bordereau.xlsx');
    expect(md).toContain('## RC.pdf');
    expect(md).toContain('| Désignation | Unité | Quantité | PU |');
    expect(md).toContain('| --- | --- | --- | --- |');
    expect(md).toContain('| Béton | m3 | 90 | 1200 |');
    expect(md).toContain('Article 1 : Objet du marché.');
    // Table comes before the RC section.
    expect(md.indexOf('Béton')).toBeLessThan(md.indexOf('## RC.pdf'));
  });

  test('empty / whitespace input → empty string', () => {
    expect(toDossierMarkdown('   ')).toBe('');
    expect(toDossierMarkdown('')).toBe('');
  });

  test('a lone pipe-row is kept verbatim, not forced into a table', () => {
    const md = toDossierMarkdown('===== f.pdf =====\nvoir article 3 | alinéa 2');
    expect(md).toContain('## f.pdf');
    expect(md).not.toContain('| --- |');
    expect(md).toContain('voir article 3 | alinéa 2');
  });

  test('pads ragged rows to a well-formed table', () => {
    const md = toDossierMarkdown(['a | b | c', 'x | y'].join('\n'));
    // Widest row has 3 cols → the short row is padded to 3.
    expect(md).toContain('| a | b | c |');
    expect(md).toContain('| x | y |  |');
  });
});
