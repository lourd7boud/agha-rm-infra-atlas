import { describe, expect, it } from 'vitest';
import {
  createSigningSecret,
  hashSigningSecret,
  verifySigningSecret,
} from './bid-signing.domain';

describe('bid signing secret protocol', () => {
  it('creates high-entropy URL-safe secrets and stores only a SHA-256 digest', () => {
    const secret = createSigningSecret();
    const digest = hashSigningSecret(secret);

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(secret);
  });

  it('verifies secrets without accepting a different value', () => {
    const secret = createSigningSecret();
    const digest = hashSigningSecret(secret);

    expect(verifySigningSecret(secret, digest)).toBe(true);
    expect(verifySigningSecret(`${secret}x`, digest)).toBe(false);
    expect(verifySigningSecret(secret, 'malformed')).toBe(false);
  });
});
