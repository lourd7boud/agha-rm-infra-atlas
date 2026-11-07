import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  convertOfficeToPdf,
  previewExtension,
  PreviewConversionError,
} from './converter.mjs';

test('recognizes modern, legacy, macro, template, and OpenDocument formats', () => {
  for (const name of [
    'BPU.xls', 'BPU.xlsx', 'BPU.xlsb', 'BPU.xlsm', 'table.ods',
    'CPS.doc', 'CPS.docx', 'CPS.docm', 'model.dotm', 'RC.odt', 'note.rtf',
    'slides.ppt', 'slides.pptx', 'slides.pptm', 'show.ppsm', 'model.potx',
    'scan.tiff',
  ]) {
    assert.ok(previewExtension(name), name);
  }
  assert.equal(previewExtension('payload.exe'), null);
});

test('validates the converter output and returns a PDF', async () => {
  const expected = Buffer.from('%PDF-1.7\nisolated');
  const result = await convertOfficeToPdf(
    Buffer.from([1, 2, 3]),
    'BPU.xlsx',
    async ({ outputDir }) => writeFile(`${outputDir}/document.pdf`, expected),
  );
  assert.deepEqual(result, expected);
});

test('rejects a non-PDF converter output', async () => {
  await assert.rejects(
    convertOfficeToPdf(Buffer.from([1]), 'BPU.xlsx', async ({ outputDir }) => {
      await writeFile(`${outputDir}/document.pdf`, Buffer.from('not a pdf'));
    }),
    PreviewConversionError,
  );
});
