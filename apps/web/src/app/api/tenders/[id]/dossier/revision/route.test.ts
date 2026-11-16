import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET, POST } from './route';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const context = { params: Promise.resolve({ id: 'tender 1' }) };
const req = (method: 'GET' | 'POST') => new NextRequest('http://localhost/api/tenders/tender-1/dossier/revision', { method });

test('revision evidence and source checks both require authentication', async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await GET(req('GET'), context)).status).toBe(401);
  expect((await POST(req('POST'), context)).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test('GET reads only saved proof and POST explicitly requests a source check', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(async () => Response.json({ state: 'not_checked' }));
  vi.stubGlobal('fetch', fetch);
  expect((await GET(req('GET'), context)).status).toBe(200);
  expect((await POST(req('POST'), context)).status).toBe(200);
  expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/tender/tenders/tender%201/dossier/revision'), expect.objectContaining({ method: 'GET', cache: 'no-store', signal: expect.any(AbortSignal) }));
  expect(fetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ method: 'POST' }));
});

test('revision proxy preserves failure status without exposing internal responses', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('internal object keys or parser paths', { status: 503 })));
  const response = await POST(req('POST'), context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('internal object keys');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

test('the revision proxy keeps the retry time for rate limited withdrawals', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private rate limiter details', {
    status: 429, headers: { 'Retry-After': '41' },
  })));
  const response = await POST(req('POST'), context);
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('41');
  expect(await response.text()).not.toContain('private rate limiter details');
});

test('only an explicit same-origin account POST is forwarded in account mode', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(async () => Response.json({ state: 'downloaded' }));
  vi.stubGlobal('fetch', fetch);
  const response = await POST(new NextRequest(`${req('POST').url}?mode=account&untrusted=other`, {
    method: 'POST', headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
  }), context);
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/dossier\/revision\?mode=account$/), expect.objectContaining({ method: 'POST' }));
});

test('invalid or duplicated modes and modes on GET cannot reach Core', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const query of ['mode=', 'mode=anonymous', 'mode=ACCOUNT', 'mode=account&mode=anonymous']) {
    expect((await POST(new NextRequest(`${req('POST').url}?${query}`, { method: 'POST' }), context)).status).toBe(400);
  }
  expect((await GET(new NextRequest(`${req('GET').url}?mode=account`), context)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test('cross-origin account withdrawals are rejected', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const url = `${req('POST').url}?mode=account`;
  for (const headers of [
    { Origin: 'https://other.example' },
    { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-site' },
  ]) {
    expect((await POST(new NextRequest(url, { method: 'POST', headers: new Headers(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined)) }), context)).status).toBe(403);
  }
  expect(fetch).not.toHaveBeenCalled();
});
