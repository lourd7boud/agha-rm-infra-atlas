import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { POST } from './route';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const context = { params: Promise.resolve({ id: 'tender 1' }) };
const req = () => new NextRequest('http://localhost/api/tenders/tender-1/files/ocr?name=DCE%2FRC%20AO.pdf', { method: 'POST' });

test('unauthenticated OCR requests never start processing', async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await POST(req(), context)).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test('OCR requires an explicitly selected filename', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const response = await POST(new NextRequest('http://localhost/api/tenders/tender-1/files/ocr', { method: 'POST' }), context);
  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test('explicit OCR forwards POST and selected identity but hides upstream details', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(async () => new Response('private parser paths', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const response = await POST(req(), context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private parser paths');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/tender/tenders/tender%201/dossier/file-ocr?name=DCE%2FRC%20AO.pdf'), expect.objectContaining({ method: 'POST', cache: 'no-store', signal: expect.any(AbortSignal) }));
});

test('successful OCR returns the bounded evidence without caching it publicly', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state: 'mixed', coverage: 'partial', totalPages: 21, pagesProcessed: 20 })));
  const response = await POST(req(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: 'mixed', coverage: 'partial', pagesProcessed: 20 });
  expect(response.headers.get('cache-control')).toContain('private, no-store');
});
