import { describe, expect, it } from 'vitest';
import {
  canonicalSigningUploadKey,
  SigningUploadLimiter,
} from './bid-signing-upload-limiter';

describe('SigningUploadLimiter', () => {
  it('permits a dossier of any length while bounding concurrent memory per signer task', () => {
    const limiter = new SigningUploadLimiter();
    const key = 'task-1:signer-1';

    expect(limiter.acquire(key)).toBe(true);
    expect(limiter.acquire(key)).toBe(true);
    expect(limiter.acquire(key)).toBe(false);

    limiter.release(key);
    expect(limiter.acquire(key)).toBe(true);
    limiter.release(key);
    limiter.release(key);

    expect(limiter.acquire(key)).toBe(true);
  });

  it('canonicalizes UUID casing so the same task cannot obtain extra slots', () => {
    expect(
      canonicalSigningUploadKey(
        'ABCDEFAB-1234-4ABC-8DEF-ABCDEFABCDEF',
        'signer-1',
      ),
    ).toBe(
      canonicalSigningUploadKey(
        'abcdefab-1234-4abc-8def-abcdefabcdef',
        'signer-1',
      ),
    );
  });
});
