import { describe, expect, test } from 'vitest';
import { safeCallbackUrl } from './callback-url';

describe('safeCallbackUrl', () => {
  test('accepts same-origin absolute paths and preserves query/hash/unicode', () => {
    expect(safeCallbackUrl('/')).toBe('/');
    expect(safeCallbackUrl('/projects/123/edit?tab=metre#sections')).toBe(
      '/projects/123/edit?tab=metre#sections',
    );
    expect(safeCallbackUrl('/compta/tva')).toBe('/compta/tva');
    expect(safeCallbackUrl('/marchés/régions')).toBe('/marchés/régions');
  });

  test('rejects open-redirect payloads', () => {
    expect(safeCallbackUrl('https://evil.example')).toBe('/');
    expect(safeCallbackUrl('http://evil.example/path')).toBe('/');
    expect(safeCallbackUrl('//evil.example/path')).toBe('/');
    expect(safeCallbackUrl('///evil.example/path')).toBe('/');
    expect(safeCallbackUrl('/\\evil.example')).toBe('/');
  });

  test('never lands the user back on the login screen', () => {
    expect(safeCallbackUrl('/login')).toBe('/');
    expect(safeCallbackUrl('/login?callbackUrl=/')).toBe('/');
    expect(safeCallbackUrl('/login/')).toBe('/');
  });

  test('rejects missing, blank and oversized values', () => {
    expect(safeCallbackUrl(undefined)).toBe('/');
    expect(safeCallbackUrl('')).toBe('/');
    expect(safeCallbackUrl('   ')).toBe('/');
    expect(safeCallbackUrl('x'.repeat(513))).toBe('/');
  });

  test('rejects control characters and honors a custom fallback', () => {
    expect(safeCallbackUrl('/ok\nHost: evil.example')).toBe('/');
    expect(safeCallbackUrl(null, '/dashboard')).toBe('/dashboard');
    expect(safeCallbackUrl('/projects', '/dashboard')).toBe('/projects');
  });
});