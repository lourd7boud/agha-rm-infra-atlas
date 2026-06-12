import { describe, expect, test } from 'vitest';
import { decideSnapshot } from './snapshot.domain';

describe('decideSnapshot', () => {
  test('first fetch is always a change', () => {
    const decision = decideSnapshot('<html>avis</html>', null);
    expect(decision.changed).toBe(true);
    expect(decision.sha256).toHaveLength(64);
    expect(decision.bytes).toBeGreaterThan(0);
  });

  test('identical content is detected as unchanged', () => {
    const first = decideSnapshot('<html>avis</html>', null);
    const second = decideSnapshot('<html>avis</html>', first.sha256);
    expect(second.changed).toBe(false);
    expect(second.sha256).toBe(first.sha256);
  });

  test('any content drift flips the fingerprint', () => {
    const first = decideSnapshot('<html>avis A</html>', null);
    const second = decideSnapshot('<html>avis B</html>', first.sha256);
    expect(second.changed).toBe(true);
    expect(second.sha256).not.toBe(first.sha256);
  });
});
