import { describe, expect, test } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { compareDceArchives } from './dossier-revision';

function patchCentral(zip: Uint8Array, change: (view: DataView, offset: number, index: number) => void): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  let index = 0;
  for (let offset = 0; offset + 46 <= copy.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) change(view, offset, index++);
  }
  if (!index) throw new Error('fixture has no central directory');
  return copy;
}

describe('compareDceArchives', () => {
  test('distinguishes archive bytes from identical documents across repacking and order changes', () => {
    const old = zipSync({ 'RC.pdf': strToU8('règlement '.repeat(50)), 'CPS.pdf': strToU8('conditions'), 'folder/': new Uint8Array() }, { level: 0 });
    const next = zipSync({ 'folder/': new Uint8Array(), 'CPS.pdf': strToU8('conditions'), 'RC.pdf': strToU8('règlement '.repeat(50)) }, { level: 9 });
    const result = compareDceArchives(old, next);
    expect(result.identicalArchives).toBe(false);
    expect(result.identicalDocuments).toBe(true);
    expect(result.previousContentSha256).toBe(result.nextContentSha256);
    expect(result.previousArchiveSha256).not.toBe(result.nextArchiveSha256);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(compareDceArchives(old, old).identicalArchives).toBe(true);
  });

  test('reports additions, removals and changed file bytes by their exact names', () => {
    const old = zipSync({ 'RC.pdf': strToU8('version 1'), 'CPS.pdf': strToU8('unchanged'), 'old.txt': strToU8('remove') });
    const next = zipSync({ 'RC.pdf': strToU8('version 2'), 'CPS.pdf': strToU8('unchanged'), 'new.txt': strToU8('add') });
    expect(compareDceArchives(old, next)).toMatchObject({
      identicalDocuments: false, added: ['new.txt'], removed: ['old.txt'], changed: ['RC.pdf'],
    });
  });

  test('invalid or document-free archives are errors, never successful equality', () => {
    const valid = zipSync({ 'RC.pdf': strToU8('source') });
    expect(() => compareDceArchives(valid, new Uint8Array([1, 2, 3]))).toThrow(/archive DCE invalide/i);
    expect(() => compareDceArchives(zipSync({}), zipSync({}))).toThrow(/archive DCE invalide/i);
  });

  test('rejects inconsistent stored-entry sizes before allocating its payload', () => {
    const zip = zipSync({ 'RC.pdf': strToU8('stored data') }, { level: 0 });
    const bad = patchCentral(zip, (view, offset) => view.setUint32(offset + 24, 1, true));
    expect(() => compareDceArchives(zip, bad)).toThrow(/archive DCE invalide/i);
  });

  test('rejects duplicate entry names rather than letting the last one win', () => {
    const zip = zipSync({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b') });
    const bad = patchCentral(zip, (view, offset, index) => {
      if (index === 1) view.setUint8(offset + 46, 'a'.charCodeAt(0));
    });
    expect(() => compareDceArchives(zip, bad)).toThrow(/archive DCE invalide/i);
  });

  test('rejects oversized entry and aggregate inflation metadata before decompression', () => {
    const zip = zipSync({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b'), 'c.txt': strToU8('c'), 'd.txt': strToU8('d') });
    const tooLarge = patchCentral(zip, (view, offset) => view.setUint32(offset + 24, 25 * 1024 * 1024 + 1, true));
    const tooMuch = patchCentral(zip, (view, offset) => {
      view.setUint16(offset + 10, 8, true);
      view.setUint32(offset + 24, 25 * 1024 * 1024, true);
    });
    expect(() => compareDceArchives(zip, tooLarge)).toThrow(/archive DCE invalide/i);
    expect(() => compareDceArchives(zip, tooMuch)).toThrow(/archive DCE invalide/i);
  });

  test('applies shared filename and entry-count limits', () => {
    const valid = zipSync({ 'a.txt': strToU8('a') });
    const longName = zipSync({ ['x'.repeat(1025)]: strToU8('a') });
    const many = zipSync(Object.fromEntries(Array.from({ length: 4001 }, (_, i) => [`${i}.txt`, new Uint8Array()])));
    expect(() => compareDceArchives(valid, longName)).toThrow(/archive DCE invalide/i);
    expect(() => compareDceArchives(valid, many)).toThrow(/archive DCE invalide/i);
  });
});
