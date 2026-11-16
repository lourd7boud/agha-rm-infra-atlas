import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from './route';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const context = { params: Promise.resolve({ id: 'tender-1' }) };
const req = () => new NextRequest('http://localhost/api/tenders/tender-1/files/evidence?name=RC%20AO.pdf');

test('unauthenticated requests never touch the archive', async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await GET(req(), context)).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test('forwards selected identity and hides upstream failures', async () => {
  vi.mocked(auth).mockResolvedValue({ accessToken: 'test-token' } as never);
  const fetch = vi.fn(async () => new Response('private parser paths', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  const response = await GET(req(), context);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('private parser paths');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/tender/tenders/tender-1/dossier/file-evidence?name=RC%20AO.pdf'), expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
});
