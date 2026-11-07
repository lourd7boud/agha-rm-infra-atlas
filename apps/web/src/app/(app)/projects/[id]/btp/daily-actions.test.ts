import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/auth';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { dailyIdentity, writeDaily } from './daily-actions';
import { emptyDaily } from './daily-draft';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  API_WRITE_TIMEOUT_MS: 120000,
  AtlasApiError: class extends Error {
    constructor(
      _path: string,
      public status: number,
    ) {
      super('upstream error');
    }
  },
}));
const token = `header.${Buffer.from(JSON.stringify({ sub: 'account-a', iss: 'atlas-local' })).toString('base64url')}.signature`;
const payload = {
  ...emptyDaily('2026-10-27'),
  zone: 'Bloc A',
  summary: 'Fondations',
};
const serverRecord = { id: 'daily-id', version: 4, payload, status: 'draft' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    accessToken: token,
    roles: ['chantier'],
  } as never);
  vi.stubGlobal('fetch', vi.fn());
});

describe('daily writes preserve optimistic concurrency', () => {
  it('returns the remote version on conflict, retaining caller payload and stable id', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 409 }));
    vi.mocked(apiGet).mockResolvedValue([serverRecord]);
    const result = await writeDaily(
      'project-a',
      'daily-id',
      3,
      'save',
      payload,
      undefined,
      accountScope,
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'conflict',
      current: serverRecord,
    });
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
    ).toEqual({ expectedVersion: 3, payload });
    expect(payload.summary).toBe('Fondations');
  });
  it('retries the same UUID/version after an uncertain network outcome', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(fetch).mockRejectedValue(new Error('network unavailable'));
    const first = await writeDaily(
      'project-a',
      'daily-id',
      3,
      'save',
      payload,
      undefined,
      accountScope,
    );
    const second = await writeDaily(
      'project-a',
      'daily-id',
      3,
      'save',
      payload,
      undefined,
      accountScope,
    );
    expect(first).toMatchObject({ ok: false, code: 'network' });
    expect(second).toMatchObject({ ok: false, code: 'network' });
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe(calls[1][0]);
    expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  });
  it('rejects a changed account before sending a draft', async () => {
    const result = await writeDaily(
      'project-a',
      'daily-id',
      0,
      'save',
      payload,
      undefined,
      'other-account',
    );
    expect(result).toMatchObject({ ok: false, code: 'session' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('prevents field users from invoking office review', async () => {
    const { accountScope } = await dailyIdentity();
    expect(
      await writeDaily(
        'project-a',
        'daily-id',
        3,
        'review',
        undefined,
        undefined,
        accountScope,
      ),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('returns conflict details for a transition without retrying a write', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(apiPost).mockRejectedValue(new AtlasApiError('/daily', 409));
    vi.mocked(apiGet).mockResolvedValue([serverRecord]);
    expect(
      await writeDaily(
        'project-a',
        'daily-id',
        3,
        'submit',
        undefined,
        undefined,
        accountScope,
      ),
    ).toMatchObject({ ok: false, code: 'conflict', current: serverRecord });
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
  it('distinguishes a business refusal from a newer concurrent version', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(auth).mockResolvedValue({
      accessToken: token,
      roles: ['travaux'],
    } as never);
    vi.mocked(apiPost).mockRejectedValue(new AtlasApiError('/daily', 409));
    vi.mocked(apiGet).mockResolvedValue([{ ...serverRecord, version: 3 }]);
    expect(
      await writeDaily(
        'project-a',
        'daily-id',
        3,
        'reopen',
        undefined,
        'Correction',
        accountScope,
      ),
    ).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('reports an expired session without sending or clearing input', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(
      await writeDaily(
        'project-a',
        'daily-id',
        3,
        'save',
        payload,
        undefined,
        'account',
      ),
    ).toMatchObject({ ok: false, code: 'session' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('resolves a blocker with optimistic version on its dedicated endpoint', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(apiPost).mockResolvedValue(serverRecord);
    expect(
      await writeDaily(
        'project-a',
        'daily-id',
        3,
        'resolve',
        undefined,
        undefined,
        accountScope,
        'blocker-id',
      ),
    ).toMatchObject({ ok: true });
    expect(apiPost).toHaveBeenCalledWith(
      '/btp/projects/project-a/terrain/journees/daily-id/blockers/blocker-id/resolve',
      { expectedVersion: 3 },
    );
  });
  it('shows an existing same-day record when another client created it first', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 409 }));
    const existing = { ...serverRecord, id: 'other-client-id' };
    vi.mocked(apiGet).mockResolvedValue([existing]);
    expect(
      await writeDaily(
        'project-a',
        'new-client-id',
        0,
        'save',
        payload,
        undefined,
        accountScope,
      ),
    ).toMatchObject({ ok: false, code: 'conflict', current: existing });
  });
  it('sends only reviewed settlement mappings and version, preserving quantities', async () => {
    const { accountScope } = await dailyIdentity();
    vi.mocked(auth).mockResolvedValue({
      accessToken: token,
      roles: ['travaux'],
    } as never);
    vi.mocked(apiPost).mockResolvedValue(serverRecord);
    const mapping = {
      attendanceMapping: [
        { lineId: 'temporary-row', assignmentId: 'assignment-id' },
      ],
      productionMapping: [],
      reason: 'Affectation confirmée',
    };
    expect(
      await writeDaily(
        'project-a',
        'daily-id',
        3,
        'settle',
        undefined,
        undefined,
        accountScope,
        undefined,
        mapping,
      ),
    ).toMatchObject({ ok: true });
    expect(apiPost).toHaveBeenCalledWith(
      '/btp/projects/project-a/terrain/journees/daily-id/settle',
      { expectedVersion: 3, ...mapping },
    );
    expect(payload).toEqual({
      ...emptyDaily('2026-10-27'),
      zone: 'Bloc A',
      summary: 'Fondations',
    });
  });
});
