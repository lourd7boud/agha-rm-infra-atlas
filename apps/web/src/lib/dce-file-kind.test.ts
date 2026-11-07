import { describe, expect, test } from 'vitest';
import { classifyDceFile, isDceRawInlineSafe } from './dce-file-kind';

describe('DCE viewer file classification', () => {
  test.each([
    ['BPDE.xlsx', 'excel'],
    ['ancien.xls', 'excel'],
    ['classeur.xlsb', 'excel'],
    ['tableau.ods', 'excel'],
    ['CPS.docx', 'word'],
    ['CPS.docm', 'word'],
    ['modèle.dotm', 'word'],
    ['ancien.doc', 'word'],
    ['document.odt', 'word'],
    ['présentation.pptx', 'presentation'],
    ['présentation.pptm', 'presentation'],
    ['diaporama.ppsm', 'presentation'],
    ['modèle.potx', 'presentation'],
    ['présentation.odp', 'presentation'],
    ['scan.tiff', 'image'],
    ['notes.txt', 'text'],
    ['data.xml', 'text'],
    ['active.svg', 'other'],
    ['plan.pdf', 'pdf'],
  ] as const)('classifies %s as %s', (filename, kind) => {
    expect(classifyDceFile(filename)).toBe(kind);
  });

  test('never serves active XML or SVG inline from the authenticated origin', () => {
    expect(isDceRawInlineSafe('notes.txt')).toBe(true);
    expect(isDceRawInlineSafe('data.xml')).toBe(false);
    expect(isDceRawInlineSafe('active.svg')).toBe(false);
  });
});
