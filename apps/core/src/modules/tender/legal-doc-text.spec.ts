import { describe, expect, test } from 'vitest';
import { strToU8 } from 'fflate';
import { InMemoryObjectStorage } from '../vault/storage';
import {
  extractLegalDocText,
  extractAndCacheLegalDocText,
  readCachedLegalDocText,
  legalDocTextCacheKey,
  MAX_LEGAL_DOC_TEXT_CHARS,
} from './legal-doc-text';

// NOTE: the OCR path (ocr=true on PDFs/images) shells out to ocrmypdf — not
// exercised here; these cover the routing, bounding, and cache round-trip with
// the in-house parser path (office/text), which needs no external binary.

describe('extractLegalDocText', () => {
  test('reads a plaintext/office file via the in-house parser (no OCR)', async () => {
    const text = await extractLegalDocText(strToU8('Attestation CNSS: à jour.'), 'att.txt', false);
    expect(text).toBe('Attestation CNSS: à jour.');
  });

  test('returns empty (never throws) on unreadable bytes', async () => {
    expect(await extractLegalDocText(new Uint8Array([1, 2, 3]), 'x.docx', false)).toBe('');
  });

  test('bounds the text to MAX_LEGAL_DOC_TEXT_CHARS', async () => {
    const text = await extractLegalDocText(strToU8('A'.repeat(10_000)), 'big.txt', false);
    expect(text.length).toBe(MAX_LEGAL_DOC_TEXT_CHARS);
  });
});

describe('extractAndCacheLegalDocText + readCachedLegalDocText', () => {
  test('caches non-empty text and reads it back under legal-doc-text/{id}.md', async () => {
    const storage = new InMemoryObjectStorage();
    const out = await extractAndCacheLegalDocText(storage, 'd1', strToU8('contenu réel'), 'a.txt', false);
    expect(out).toBe('contenu réel');
    expect(legalDocTextCacheKey('d1')).toBe('legal-doc-text/d1.md');
    expect(await readCachedLegalDocText(storage, 'd1')).toBe('contenu réel');
  });

  test('does NOT cache empty extraction (so a scan can be re-indexed later)', async () => {
    const storage = new InMemoryObjectStorage();
    await extractAndCacheLegalDocText(storage, 'd2', new Uint8Array([1, 2, 3]), 'x.docx', false);
    expect(await readCachedLegalDocText(storage, 'd2')).toBeNull();
  });
});
