import { NextRequest } from 'next/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: { accessToken: 'test-token' } as { accessToken: string },
}));

vi.mock('@/auth', () => ({
  auth: async () => state.session,
}));

import { GET } from './route';

describe('BTP asset proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('forwards thumbnail requests to the optimized Core endpoint with a long cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('thumbnail', {
        headers: { 'Content-Type': 'image/webp', 'Content-Length': '9' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const projectId = 'e30ff28c-ec44-4374-a6cd-c9c496d4593a';
    const assetId = '88467363-7fde-43fc-8a31-268194e74818';

    const response = await GET(
      new NextRequest(
        `http://localhost:3001/api/btp-asset/${projectId}/${assetId}?variant=thumbnail`,
      ),
      { params: Promise.resolve({ projectId, assetId }) },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://localhost:3000/api/btp/projects/${projectId}/assets/${assetId}/thumbnail`,
    );
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=86400, stale-while-revalidate=604800',
    );
  });
});
