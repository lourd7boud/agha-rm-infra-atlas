import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISSUER_EMBLEM,
  lookupIssuerLogo,
  normalizeIssuerName,
} from './issuer-logos';
import { NAME_TO_ASSET } from './issuer-logos.data';
import { NAME_TO_ASSET_PART_1 } from './issuer-logos.data-1';
import { NAME_TO_ASSET_PART_2 } from './issuer-logos.data-2';

describe('NAME_TO_ASSET dictionary split', () => {
  it('merges both halves with no key collision (spread would silently drop dupes)', () => {
    // Guards the mechanical 2-file split: a key landing in both halves would
    // make PART_2 shadow PART_1 and shrink the merged map below the sum.
    expect(Object.keys(NAME_TO_ASSET).length).toBe(
      Object.keys(NAME_TO_ASSET_PART_1).length +
        Object.keys(NAME_TO_ASSET_PART_2).length,
    );
  });
});

describe('normalizeIssuerName', () => {
  it('lowercases and strips French diacritics', () => {
    expect(normalizeIssuerName('Délégation Préfectorale')).toBe(
      'delegation prefectorale',
    );
  });

  it('collapses punctuation and whitespace runs to single spaces', () => {
    expect(normalizeIssuerName('  Commune   de/Rabat.. ')).toBe(
      'commune de rabat',
    );
  });

  it('is idempotent — normalizing an already-normal name is a no-op', () => {
    const once = normalizeIssuerName('Wilaya de Casablanca-Settat');
    expect(normalizeIssuerName(once)).toBe(once);
  });
});

describe('lookupIssuerLogo', () => {
  it('returns null for an empty name (caller falls back to initials avatar)', () => {
    expect(lookupIssuerLogo('')).toBeNull();
  });

  it('returns null for a buyer with no curated logo or fallback rule', () => {
    expect(lookupIssuerLogo('Zzz Nonexistent Entity 12345')).toBeNull();
  });

  it('exposes the Royal-emblem default as an absolute public path', () => {
    expect(DEFAULT_ISSUER_EMBLEM).toMatch(/^\/issuers\/datao\/.+\.png$/);
  });
});
