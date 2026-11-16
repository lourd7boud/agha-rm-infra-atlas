import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/auth', () => ({ auth }));
import { GET, POST } from './route';

describe('authenticated radar proxy', () => {
  beforeEach(() => { vi.unstubAllGlobals(); auth.mockReset(); });
  test('does not query Core without a valid session', async () => {
    auth.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });
  test('preserves upstream access denial instead of hiding it as an empty radar', async () => {
    auth.mockResolvedValue({ accessToken: 'test' });
    vi.stubGlobal('fetch', async () => new Response('{"error":"Forbidden"}', { status: 403 }));
    expect((await GET()).status).toBe(403);
  });
  test('reports network failure without exposing internal error details', async () => {
    auth.mockResolvedValue({ accessToken: 'test' });
    vi.stubGlobal('fetch', async () => { throw new Error('internal connection details'); });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('internal connection details');
  });
  test('rejects cross-origin manual crawl requests', async () => {
    auth.mockResolvedValue({ accessToken: 'test' });
    const response = await POST(new NextRequest('http://localhost:13001/api/watch', { method: 'POST', headers: { Origin: 'https://other.example' } }));
    expect(response.status).toBe(403);
  });
});
