import { describe, expect, test } from 'vitest';
import {
  InMemoryObjectStorage,
  MAX_UPLOAD_BYTES,
  sanitizeFilename,
  sha256Hex,
  validateUpload,
} from './storage';

describe('sha256Hex', () => {
  test('matches the known SHA-256 vector for "abc"', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('validateUpload', () => {
  test('accepts a PDF of reasonable size', () => {
    expect(validateUpload('application/pdf', 1024)).toEqual({ ok: true });
  });

  test('rejects disallowed mime types', () => {
    const result = validateUpload('application/x-msdownload', 1024);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('non autorisé');
  });

  test('rejects empty files', () => {
    expect(validateUpload('application/pdf', 0).ok).toBe(false);
  });

  test('rejects files above the size cap', () => {
    const result = validateUpload('application/pdf', MAX_UPLOAD_BYTES + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('volumineux');
  });
});

describe('sanitizeFilename', () => {
  test('strips accents and unsafe characters', () => {
    expect(sanitizeFilename('Attestation fiscale n°12 (2026).pdf')).toBe(
      'Attestation_fiscale_n_12_2026_.pdf',
    );
  });

  test('never returns an empty key segment', () => {
    expect(sanitizeFilename('***')).toBe('document');
  });
});

describe('InMemoryObjectStorage', () => {
  test('stores and exposes objects with integrity hash', async () => {
    const storage = new InMemoryObjectStorage();
    const body = Buffer.from('%PDF-1.4 test');
    const stored = await storage.put('kind/id/test.pdf', body, 'application/pdf');

    expect(stored.sha256).toBe(sha256Hex(body));
    expect(stored.sizeBytes).toBe(body.length);
    expect(storage.get('kind/id/test.pdf')?.body.equals(body)).toBe(true);
    await expect(storage.presignedGetUrl('kind/id/test.pdf')).resolves.toContain(
      'memory://',
    );
  });
});
