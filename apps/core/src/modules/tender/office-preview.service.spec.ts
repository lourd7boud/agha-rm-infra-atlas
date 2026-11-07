import { describe, expect, test } from 'vitest';
import {
  OfficePreviewService,
  officePreviewExtension,
  UnsupportedOfficePreviewError,
} from './office-preview.service';

describe('office preview conversion', () => {
  test.each([
    'BPDE.xlsx',
    'BPU.XLS',
    'CPS.docx',
    'RC.odt',
    'Présentation.pptx',
    'Tableau.ods',
    'Archive.rtf',
    'Scan.tiff',
    'Classeur.xlsb',
    'CPS.docm',
    'Modèle.dotm',
    'Présentation.pptm',
    'Diaporama.ppsm',
    'Modèle.potx',
  ])('accepts the DCE office format %s', (filename) => {
    expect(officePreviewExtension(filename)).not.toBeNull();
  });

  test('returns and caches the PDF produced by the isolated worker', async () => {
    const expected = Buffer.from('%PDF-1.7\nlocal-preview');
    let calls = 0;
    const service = new OfficePreviewService(async () => {
      calls += 1;
      return expected;
    });
    await expect(service.render(new Uint8Array([1, 2, 3]), 'BPDE.xlsx')).resolves.toEqual(expected);
    await expect(service.render(new Uint8Array([1, 2, 3]), 'BPDE.xlsx')).resolves.toEqual(expected);
    expect(calls).toBe(1);
  });

  test('rejects unknown executable and archive formats', async () => {
    const service = new OfficePreviewService(async () => Buffer.from('%PDF-'));
    await expect(
      service.render(new Uint8Array([1]), 'payload.exe'),
    ).rejects.toBeInstanceOf(UnsupportedOfficePreviewError);
  });
});
