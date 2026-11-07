import { describe, expect, test } from 'vitest';
import {
  SESSION_PROBE_INTERVAL_MS,
  SESSION_PROBE_MAX_INTERVAL_MS,
  buildReauthUrl,
  classifySessionProbeFailure,
  classifySessionProbeResponse,
  nextSessionProbeDelayMs,
  shouldReleaseBlockingSessionCheck,
} from './session-check';

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

describe('session probe classification', () => {
  test('only an explicit 401 (or an explicit false flag) means "expired"', () => {
    expect(classifySessionProbeResponse({ status: 401 })).toBe('unauthenticated');
    expect(classifySessionProbeResponse({ status: 200, authenticated: false })).toBe(
      'unauthenticated',
    );
  });

  test('a healthy answer is usable — with or without the JSON flag', () => {
    expect(classifySessionProbeResponse({ status: 200, authenticated: true })).toBe('ok');
    expect(classifySessionProbeResponse({ status: 204 })).toBe('ok');
  });

  test('server and transport failures are UNKNOWN, never "expired"', () => {
    // The regression that produced the recurring « Session expirée » banner:
    // the probe endpoint answered 500 and the watchdog called it an expiry.
    for (const status of [500, 502, 503, 504, 429, 403, 302]) {
      expect(classifySessionProbeResponse({ status })).toBe('unknown');
    }
    expect(classifySessionProbeFailure()).toBe('unknown');
  });
});

describe('session probe scheduling', () => {
  test('steady state uses the central cadence, below the Keycloak token TTL', () => {
    expect(nextSessionProbeDelayMs(0)).toBe(SESSION_PROBE_INTERVAL_MS);
    expect(SESSION_PROBE_INTERVAL_MS).toBeLessThan(300_000);
  });

  test('unknown outcomes back off exponentially and stay bounded', () => {
    // Pure exponential growth (explicit bounds keep the assertion readable).
    expect(nextSessionProbeDelayMs(1, 1_000, 1_000_000)).toBe(2_000);
    expect(nextSessionProbeDelayMs(2, 1_000, 1_000_000)).toBe(4_000);
    expect(nextSessionProbeDelayMs(3, 1_000, 1_000_000)).toBe(8_000);

    // Shipped bounds: the first step doubles the cadence, then it is capped.
    const first = nextSessionProbeDelayMs(1);
    expect(first).toBeGreaterThan(SESSION_PROBE_INTERVAL_MS);
    for (const streak of [2, 3, 10, 50]) {
      expect(nextSessionProbeDelayMs(streak)).toBe(SESSION_PROBE_MAX_INTERVAL_MS);
    }
  });
});

describe('buildReauthUrl', () => {
  test('carries the current page so re-authentication never dumps the operator elsewhere', () => {
    expect(buildReauthUrl('/login', '/projects/abc/metres/p2?tab=metre')).toBe(
      `/login?callbackUrl=${encodeURIComponent('/projects/abc/metres/p2?tab=metre')}`,
    );
  });

  test('refuses open-redirects and the login screen itself', () => {
    expect(buildReauthUrl('/login', '//evil.example.com')).toBe(
      `/login?callbackUrl=${encodeURIComponent('/')}`,
    );
    expect(buildReauthUrl('/login', '/login')).toBe(
      `/login?callbackUrl=${encodeURIComponent('/')}`,
    );
  });
});
