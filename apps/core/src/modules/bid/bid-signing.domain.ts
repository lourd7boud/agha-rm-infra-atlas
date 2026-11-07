import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits, base64url without padding (43 characters). */
export function createSigningSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSigningSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function verifySigningSecret(secret: string, expectedSha256: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) return false;
  const actual = Buffer.from(hashSigningSecret(secret), 'hex');
  const expected = Buffer.from(expectedSha256, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
