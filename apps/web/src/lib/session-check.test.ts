import { describe, expect, test } from 'vitest';
import { shouldReleaseBlockingSessionCheck } from './session-check';

describe('shouldReleaseBlockingSessionCheck', () => {
  test('never lets a periodic or stale request reveal protected content', () => {
    expect(
      shouldReleaseBlockingSessionCheck({
        blocking: false,
        requestId: 0,
        latestBlockingRequestId: 2,
        usable: true,
      }),
    ).toBe(false);
    expect(
      shouldReleaseBlockingSessionCheck({
        blocking: true,
        requestId: 1,
        latestBlockingRequestId: 2,
        usable: true,
      }),
    ).toBe(false);
  });

  test('releases only the latest explicitly usable blocking request', () => {
    expect(
      shouldReleaseBlockingSessionCheck({
        blocking: true,
        requestId: 2,
        latestBlockingRequestId: 2,
        usable: false,
      }),
    ).toBe(false);
    expect(
      shouldReleaseBlockingSessionCheck({
        blocking: true,
        requestId: 2,
        latestBlockingRequestId: 2,
        usable: true,
      }),
    ).toBe(true);
  });
});
