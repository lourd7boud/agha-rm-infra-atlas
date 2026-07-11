import { describe, expect, test } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { detectArchive, normalizeArchiveToZip } from './dossier-archive';

describe('detectArchive', () => {
  test('recognises ZIP magic', () => {
    expect(detectArchive(zipSync({ 'a.txt': strToU8('hi') }))).toBe('zip');
  });

  test('recognises RAR magic (v4 and v5 signatures)', () => {
    const rar4 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
    const rar5 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    expect(detectArchive(rar4)).toBe('rar');
    expect(detectArchive(rar5)).toBe('rar');
  });

  test('unknown for arbitrary / empty bytes', () => {
    expect(detectArchive(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
    expect(detectArchive(new Uint8Array([]))).toBe('unknown');
  });
});

describe('normalizeArchiveToZip', () => {
  test('passes a ZIP through untouched (same reference)', async () => {
    const zip = zipSync({ 'a.txt': strToU8('hi') });
    expect(await normalizeArchiveToZip(zip)).toBe(zip);
  });

  test('passes non-archive bytes through', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await normalizeArchiveToZip(bytes)).toBe(bytes);
  });

  test('degrades to the input bytes when a RAR cannot be unpacked', async () => {
    // RAR-magic blob that is not a real archive: unar fails (or is absent) →
    // normalize logs + returns the original bytes rather than throwing, so a
    // batch is never aborted by one bad archive.
    const fakeRar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 9, 9, 9]);
    expect(await normalizeArchiveToZip(fakeRar)).toBe(fakeRar);
  });
});
