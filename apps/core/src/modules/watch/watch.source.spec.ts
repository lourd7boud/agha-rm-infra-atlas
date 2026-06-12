import { describe, expect, test, vi } from 'vitest';
import { HttpPortalSource } from './watch.source';

const okResponse = (html: string) =>
  ({ ok: true, status: 200, text: async () => html }) as Response;
const errResponse = (status: number) =>
  ({ ok: false, status, text: async () => '' }) as Response;

describe('HttpPortalSource retry', () => {
  test('returns the page on the first successful fetch', async () => {
    const fetchImpl = vi.fn(async () => okResponse('<html>avis</html>'));
    const source = new HttpPortalSource('https://portal/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const page = await source.fetch();

    expect(page.html).toContain('avis');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('retries a transient failure then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse('<html>recovered</html>'));
    const source = new HttpPortalSource('https://portal/', {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const page = await source.fetch();

    expect(page.html).toContain('recovered');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('propagates the last error after exhausting attempts', async () => {
    const fetchImpl = vi.fn(async () => errResponse(503));
    const source = new HttpPortalSource('https://portal/', {
      attempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(source.fetch()).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
