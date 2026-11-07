import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { LocalSigningDriver } from './driver';
import { PortalSigningClient } from './portal-client';
import { runSigningTask } from './orchestrator';

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

function taskResponse(input: Buffer) {
  return {
    task: {
      id: '3d4df59e-c466-4e4c-9338-61f08f91a4aa',
      workspaceId: 'd78c64d7-6823-4263-9d9a-e0ddcf82a45f',
      manifestSha256: 'a'.repeat(64),
      state: 'claimed',
    },
    files: [
      {
        id: '469d64e6-c299-4de0-9508-b7da7f956ef0',
        filename: 'acte.pdf',
        mime: 'application/pdf',
        sizeBytes: input.length,
        sha256: sha256(input),
      },
    ],
    leaseSecret: 'l'.repeat(43),
  };
}

describe('Windows signing bridge orchestration', () => {
  it('verifies frozen input bytes before invoking the token driver and stages output', async () => {
    const input = Buffer.from('frozen-input');
    const signed = Buffer.from('signed-output');
    const claimed = taskResponse(input);
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith('/claim')) {
        return Response.json(claimed);
      }
      if (init?.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData);
        return Response.json({ id: 'artifact-1', verifiedAt: null });
      }
      return new Response(input, {
        headers: { 'content-type': 'application/pdf' },
      });
    });
    const driver: LocalSigningDriver = {
      id: 'test-driver',
      inspect: vi.fn(async () => ({ available: true, certificates: [] })),
      sign: vi.fn(async () => ({
        body: signed,
        mime: 'application/pdf',
        filename: 'acte-signed.pdf',
        certificateThumbprint: 'b'.repeat(40),
        certificateSubject: 'CN=AGHID CONSTRUCTION',
        signedAt: new Date('2026-10-28T12:00:00Z'),
      })),
    };
    const client = new PortalSigningClient({
      baseUrl: 'http://localhost:13000/api',
      accessToken: 'oidc-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await runSigningTask({
      client,
      driver,
      taskId: claimed.task.id,
      pairingSecret: 'p'.repeat(43),
      deviceId: 'device-1',
      deviceName: 'Windows PC',
      confirmManifest: async (manifest, files) =>
        manifest === 'a'.repeat(64) && files.length === 1,
    });

    expect(result).toEqual({ taskId: claimed.task.id, stagedArtifacts: 1 });
    expect(driver.sign).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(3);
  });

  it('fails closed on a download hash mismatch before touching the token', async () => {
    const expected = Buffer.from('expected');
    const claimed = taskResponse(expected);
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/claim')
        ? Response.json(claimed)
        : new Response(Buffer.from('tampered')),
    );
    const driver: LocalSigningDriver = {
      id: 'test-driver',
      inspect: vi.fn(async () => ({ available: true, certificates: [] })),
      sign: vi.fn(),
    };

    await expect(
      runSigningTask({
        client: new PortalSigningClient({
          baseUrl: 'http://localhost:13000/api',
          accessToken: 'oidc-token',
          fetchImpl: fetchImpl as typeof fetch,
        }),
        driver,
        taskId: claimed.task.id,
        pairingSecret: 'p'.repeat(43),
        deviceId: 'device-1',
        deviceName: 'Windows PC',
        confirmManifest: async () => true,
      }),
    ).rejects.toThrow(/hash mismatch/i);
    expect(driver.sign).not.toHaveBeenCalled();
  });

  it('refuses cleartext transport except loopback development', () => {
    expect(
      () => new PortalSigningClient({ baseUrl: 'http://atlas.example/api', accessToken: 'token' }),
    ).toThrow(/HTTPS/);
    expect(
      () => new PortalSigningClient({ baseUrl: 'https://atlas.example/api', accessToken: 'token' }),
    ).not.toThrow();
  });

  it('can obtain a fresh signer token through an async provider', async () => {
    const tokenProvider = vi.fn(async () => 'fresh-token');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ task: {}, files: [], leaseSecret: 'lease' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new PortalSigningClient({
      baseUrl: 'https://atlas.example/api',
      accessTokenProvider: tokenProvider,
      fetchImpl,
    });

    await client.claim({
      taskId: 'task-1',
      pairingSecret: 'pairing',
      deviceId: 'device-1',
      deviceName: 'Windows PC',
    });

    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer fresh-token',
    });
  });
});
