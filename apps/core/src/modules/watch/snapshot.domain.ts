import { createHash } from 'node:crypto';

/**
 * Live-portal coverage core: every fetch is fingerprinted; unchanged
 * content is skipped (politeness + efficiency), changed content is
 * archived for audit and re-parsing without re-crawling.
 */

export interface SnapshotDecision {
  sha256: string;
  bytes: number;
  changed: boolean;
}

export function decideSnapshot(
  html: string,
  previousSha256: string | null,
): SnapshotDecision {
  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  return {
    sha256,
    bytes: Buffer.byteLength(html, 'utf8'),
    changed: sha256 !== previousSha256,
  };
}
