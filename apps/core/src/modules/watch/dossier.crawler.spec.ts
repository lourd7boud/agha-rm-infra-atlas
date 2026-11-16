import { describe, expect, test, vi } from 'vitest';
import {
  buildCompleteDownloadBody,
  buildDemandeBody,
  dceIdentityFromEnv,
  downloadDce,
  parsePortalRef,
  type DceIdentity,
} from './dossier.crawler';

const IDENT: DceIdentity = {
  nom: 'X',
  prenom: 'Y',
  email: 'e@e.ma',
  raisonSocial: 'X SARL',
  ice: '001',
  pays: '0',
  address: 'A',
};
const EFD = 'ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$';
const ANONYMOUS_FORM = `<input type="hidden" name="PRADO_PAGESTATE" value="ABC"><input type="radio" name="${EFD}RadioGroup" value="${EFD}choixAnonyme">`;
const COMPLETE_PAGE = '<input type="hidden" name="PRADO_PAGESTATE" value="DEF"><a id="ctl0_CONTENU_PAGE_EntrepriseDownloadDce_completeDownload" href="javascript:;">Télécharger</a><script>new Prado.WebUI.TLinkButton({\'ID\':"ctl0_CONTENU_PAGE_EntrepriseDownloadDce_completeDownload",\'EventTarget\':"ctl0$CONTENU_PAGE$EntrepriseDownloadDce$completeDownload"});</script>';
const ACCOUNT_FIELDS = {
  nom: 'Compte', prenom: 'Document', email: 'compte@example.test',
  raisonSocial: 'Société &amp; Atelier', ICE: '123456', address: 'Adresse de test',
};
const ACCOUNT_FORM = `<a href="?page=entreprise.Logout">Déconnexion</a>
  <form method="post" action="/index.php?page=entreprise.EntrepriseDemandeTelechargementDce&amp;refConsultation=1&amp;orgAcronyme=x">
    <input type="hidden" name="PRADO_PAGESTATE" value="ABC">
    <input type="hidden" name="${EFD}clientId" value="ctl0_CONTENU_PAGE_EntrepriseFormulaireDemande">
    <span style="display:none"><input type="radio" name="${EFD}RadioGroup" value="${EFD}choixTelechargement" checked></span>
    <input type="checkbox" name="${EFD}accepterConditions">
    <input type="submit" name="ctl0$CONTENU_PAGE$validateButton">
    ${Object.entries(ACCOUNT_FIELDS).map(([name, value]) => `<input type="text" name="${EFD}${name}" value="${value}">`).join('')}
    <select name="${EFD}pays"><option value="xx" selected>Compte</option></select>
    <input name="${EFD}tel" value="optional telephone">
    <input type="hidden" name="${EFD}extra" value="private detail">
  </form>`;
const ACCOUNT_COMPLETE_PAGE = `<form method="post" action="/index.php?page=entreprise.EntrepriseDemandeTelechargementDce&amp;refConsultation=1&amp;orgAcronyme=x">
  ${COMPLETE_PAGE}<input name="${EFD}nom" value="private detail"></form>`;

interface ResOpts {
  ok?: boolean;
  status?: number;
  setCookie?: string[];
  headers?: Record<string, string>;
  text?: string;
  buf?: ArrayBuffer;
}

function res(opts: ResOpts) {
  const bodyBytes = opts.buf
    ? new Uint8Array(opts.buf)
    : new TextEncoder().encode(opts.text ?? '');
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      getSetCookie: () => opts.setCookie ?? [],
      get: (h: string) => (opts.headers ?? {})[h.toLowerCase()] ?? null,
    },
    text: async () => opts.text ?? '',
    arrayBuffer: async () => opts.buf ?? new ArrayBuffer(0),
    body: new Response(bodyBytes).body,
  };
}

describe('parsePortalRef', () => {
  test('reads both naming variants', () => {
    expect(
      parsePortalRef('https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=1015386&orgAcronyme=q1s'),
    ).toEqual({ refConsultation: '1015386', orgAcronyme: 'q1s' });
    expect(
      parsePortalRef('https://x/?reference=1015386&orgAcronym=q1s'),
    ).toEqual({ refConsultation: '1015386', orgAcronyme: 'q1s' });
  });
  test('returns null for non-portal / missing params', () => {
    expect(parsePortalRef(null)).toBeNull();
    expect(parsePortalRef('not a url')).toBeNull();
    expect(parsePortalRef('https://x/?refConsultation=1')).toBeNull();
  });
});

describe('body builders', () => {
  test('anonymous body keeps state and acceptance without replaying identity prefills', () => {
    const parsed = { PRADO_PAGESTATE: 'ABC', [`${EFD}nom`]: 'old name', [`${EFD}email`]: 'old@example.test', [`${EFD}ICE`]: 'old ICE', [`${EFD}unknownContactField`]: 'private' };
    const body = new URLSearchParams(buildDemandeBody(parsed, null));
    expect(body.get('PRADO_PAGESTATE')).toBe('ABC');
    expect(body.get(`${EFD}RadioGroup`)).toBe(`${EFD}choixAnonyme`);
    expect(body.get(`${EFD}accepterConditions`)).toBe('on');
    expect(body.has(`${EFD}nom`)).toBe(false);
    expect(body.has(`${EFD}email`)).toBe(false);
    expect(body.has(`${EFD}ICE`)).toBe(false);
    expect(body.has(`${EFD}unknownContactField`)).toBe(false);
    expect(buildCompleteDownloadBody(parsed, true)).not.toContain('private');
    expect(buildCompleteDownloadBody(parsed, true)).not.toContain('old');
  });
  test('demande body carries the validateButton target, accept and identity', () => {
    const body = buildDemandeBody({ PRADO_PAGESTATE: 'ABC' }, IDENT);
    expect(body).toContain('PRADO_PAGESTATE=ABC');
    expect(body).toContain('PRADO_POSTBACK_TARGET=ctl0%24CONTENU_PAGE%24validateButton');
    expect(body).toContain('accepterConditions=on');
    expect(body).toContain('choixTelechargement');
    expect(body).toContain('nom=X');
    expect(body).toContain('ICE=001');
  });
  test('completeDownload body targets the download control', () => {
    const body = buildCompleteDownloadBody({ PRADO_PAGESTATE: 'DEF' });
    expect(body).toContain('PRADO_PAGESTATE=DEF');
    expect(body).toContain('EntrepriseDownloadDce%24completeDownload');
  });
});

describe('dceIdentityFromEnv', () => {
  test('falls back to defaults and honours overrides', () => {
    expect(dceIdentityFromEnv({} as NodeJS.ProcessEnv).raisonSocial).toBe('AGHA RM INFRA');
    expect(
      dceIdentityFromEnv({ PORTAL_DCE_EMAIL: 'me@co.ma' } as NodeJS.ProcessEnv).email,
    ).toBe('me@co.ma');
  });
});

describe('downloadDce', () => {
  test('portal account withdrawal uses only confirmed form values and retains the same session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ text: ACCOUNT_FORM, setCookie: ['PHPSESSID=fixture-after-get; Path=/', 'prefs=fixture'] }))
      .mockResolvedValueOnce(res({ text: ACCOUNT_COMPLETE_PAGE, setCookie: ['PHPSESSID=fixture-rotated; Path=/'] }))
      .mockResolvedValueOnce(res({ status: 302, headers: { location: '/archive.zip' } }))
      .mockResolvedValueOnce(res({ buf: new Uint8Array([0x50, 0x4b, 3, 4, 1]).buffer }));
    const onStep = vi.fn();
    const result = await downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchMock as unknown as typeof fetch, { usePortalAccount: true, onStep });
    expect(result.sizeBytes).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const validate = new URLSearchParams(String(fetchMock.mock.calls[1]![1]!.body));
    expect(validate.get('PRADO_PAGESTATE')).toBe('ABC');
    expect(validate.get(`${EFD}RadioGroup`)).toBe(`${EFD}choixTelechargement`);
    expect(validate.get(`${EFD}accepterConditions`)).toBe('on');
    expect(validate.get(`${EFD}raisonSocial`)).toBe('Société & Atelier');
    expect(validate.get(`${EFD}email`)).toBe(ACCOUNT_FIELDS.email);
    expect(validate.get(`${EFD}ICE`)).toBe(ACCOUNT_FIELDS.ICE);
    expect(validate.get(`${EFD}pays`)).toBe('xx');
    expect(validate.has(`${EFD}tel`)).toBe(false);
    expect(validate.has(`${EFD}extra`)).toBe(false);
    expect(validate.has(`${EFD}idNational`)).toBe(false);
    const complete = new URLSearchParams(String(fetchMock.mock.calls[2]![1]!.body));
    expect(complete.get('PRADO_PAGESTATE')).toBe('DEF');
    expect(complete.get('PRADO_POSTBACK_TARGET')).toContain('completeDownload');
    expect(complete.has(`${EFD}nom`)).toBe(false);
    expect(fetchMock.mock.calls[2]![1]!.headers.Cookie).toBe('PHPSESSID=fixture-rotated; prefs=fixture');
    expect(JSON.stringify(onStep.mock.calls)).not.toMatch(/fixture|example\.test|private detail|123456/);
  });

  test.each([
    ACCOUNT_FORM.replace('Déconnexion', 'Connexion'),
    ACCOUNT_FORM.replace('refConsultation=1', 'refConsultation=2'),
    ACCOUNT_FORM.replace('value="ABC"', 'value=""'),
    ACCOUNT_FORM.replace(' checked>', '>'),
    ACCOUNT_FORM.replace('value="compte@example.test"', 'value=""'),
    ACCOUNT_FORM.replace('name="ctl0$CONTENU_PAGE$validateButton"', 'name="ctl0$CONTENU_PAGE$validateButton" disabled'),
    ACCOUNT_FORM.replace(`name="${EFD}accepterConditions"`, `name="${EFD}accepterConditions" checked`),
    ACCOUNT_FORM.replace(`name="${EFD}ICE"`, `name="${EFD}ICE" disabled`),
  ])('portal account withdrawal fails before posting when authenticated form proof is incomplete', async (html) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res({ text: html }));
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchMock as unknown as typeof fetch, { usePortalAccount: true }))
      .rejects.toThrow(/portal account withdrawal form unavailable/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('portal account withdrawal stops when validation does not reveal a continuation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res({ text: ACCOUNT_FORM })).mockResolvedValueOnce(res({ text: ACCOUNT_FORM }));
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchMock as unknown as typeof fetch, { usePortalAccount: true }))
      .rejects.toThrow(/portal account continuation form unavailable/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('portal account mode refuses legacy explicit identity before fetching', async () => {
    const fetchMock = vi.fn();
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, IDENT, fetchMock as unknown as typeof fetch, { usePortalAccount: true }))
      .rejects.toThrow(/portal account mode requires identity from the portal form/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('downloads anonymously only through the advertised control and never posts identity', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) return res({ text: `${ANONYMOUS_FORM}<input name="${EFD}nom" value="old name">`, setCookie: ['session=1; Path=/'] });
      if (calls.length === 2) return res({ text: `${COMPLETE_PAGE}<input name="${EFD}email" value="old@example.test">` });
      if (calls.length === 3) return res({ status: 302, headers: { location: '/index.php?page=entreprise.EntrepriseDownloadCompleteDce' } });
      return res({ buf: new Uint8Array([0x50, 0x4b, 3, 4, 1]).buffer, headers: { 'content-type': 'application/zip' } });
    }) as unknown as typeof fetch;
    expect((await downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchImpl)).sizeBytes).toBe(5);
    expect(calls).toHaveLength(4);
    expect(String(calls[1]!.init!.body)).toContain('choixAnonyme');
    for (const call of calls.slice(1, 3)) {
      const params = new URLSearchParams(String(call.init!.body));
      expect(params.has(`${EFD}nom`)).toBe(false);
      expect(params.has(`${EFD}email`)).toBe(false);
      expect(call.init!.redirect).toBe('manual');
    }
  });

  test.each([
    [ANONYMOUS_FORM, true, false],
    [COMPLETE_PAGE.replace('value="DEF"', 'value=""'), false, true],
    [COMPLETE_PAGE.replace(/<a .*?<\/a>/, ''), true, false],
  ])('does not send the completeDownload postback without a valid continuation form', async (html, pageState, nextControl) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res({ text: ANONYMOUS_FORM })).mockResolvedValueOnce(res({ text: html }));
    const onStep = vi.fn();
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchMock as unknown as typeof fetch, { onStep }))
      .rejects.toThrow(/anonymous.*continuation form/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStep).toHaveBeenLastCalledWith({ step: 2, status: 200, elapsedMs: expect.any(Number), pageState, nextControl });
  });

  test('reports sanitized step status, source redirect and archive signature', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ text: ANONYMOUS_FORM, setCookie: ['privateCookie=secret'] }))
      .mockResolvedValueOnce(res({ text: COMPLETE_PAGE }))
      .mockResolvedValueOnce(res({ status: 302, headers: { location: '/archive.zip?token=secret' } }))
      .mockResolvedValueOnce(res({ buf: new Uint8Array([0x50, 0x4b, 3, 4, 1]).buffer }));
    const onStep = vi.fn();
    await downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchMock as unknown as typeof fetch, { onStep });
    expect(onStep.mock.calls.map(([event]) => event)).toEqual([
      { step: 1, status: 200, elapsedMs: expect.any(Number), pageState: true, anonymousControl: 'visible' },
      { step: 2, status: 200, elapsedMs: expect.any(Number), pageState: true, nextControl: true },
      { step: 3, status: 302, elapsedMs: expect.any(Number), officialRedirect: true },
      { step: 4, status: 200, elapsedMs: expect.any(Number), archiveSignature: true },
    ]);
    expect(JSON.stringify(onStep.mock.calls)).not.toMatch(/secret|privateCookie|ABC|DEF|archive\.zip/);
  });

  test('reports the attempted step on transport errors without copying the error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('transport detail that should stay private'));
    const onStep = vi.fn();
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchMock as unknown as typeof fetch, { onStep })).rejects.toThrow('transport detail');
    expect(onStep.mock.calls).toEqual([[{ step: 1, elapsedMs: expect.any(Number) }]]);
  });

  test.each([
    '<input name="PRADO_PAGESTATE" value="ABC">',
    ANONYMOUS_FORM.replace('type="radio"', 'type="radio" disabled'),
    `<div style="display:none">${ANONYMOUS_FORM}</div>`,
    ANONYMOUS_FORM.replace('value="ABC"', 'value=""'),
  ])('does not submit or fall back to identified mode when anonymous download is unavailable', async html => {
    const fetchImpl = vi.fn(async () => res({ text: html })) as unknown as typeof fetch;
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchImpl)).rejects.toThrow(/anonymous.*unavailable/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('rejects a foreign download redirect before sending portal cookies', async () => {
    let count = 0;
    const fetchImpl = vi.fn(async () => {
      count++;
      if (count === 1) return res({ text: ANONYMOUS_FORM, setCookie: ['session=secret; Path=/'] });
      if (count === 2) return res({ text: COMPLETE_PAGE });
      return res({ status: 302, headers: { location: 'https://foreign.example/archive.zip' } });
    }) as unknown as typeof fetch;
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchImpl)).rejects.toThrow(/official.*URL/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test.each([1, 2, 3, 4])('stops immediately on an HTTP error at step %s', async failureStep => {
    let count = 0;
    const fetchImpl = vi.fn(async () => {
      count++;
      if (count === failureStep) return res({ status: 503, ok: false });
      if (count === 1) return res({ text: ANONYMOUS_FORM });
      if (count === 2) return res({ text: COMPLETE_PAGE });
      return res({ status: 302, headers: { location: '/archive.zip' } });
    }) as unknown as typeof fetch;
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchImpl)).rejects.toThrow(/HTTP 503/i);
    expect(fetchImpl).toHaveBeenCalledTimes(failureStep);
  });

  test('respects caller cancellation before creating any request', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(downloadDce({ refConsultation: '1', orgAcronyme: 'x' }, null, fetchImpl, { signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('runs the 4-step flow and returns the ZIP', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const html1 = '<input type="hidden" name="PRADO_PAGESTATE" value="ABC">';
    const html2 =
      '<input type="hidden" name="PRADO_PAGESTATE" value="DEF"><a href="javascript:;//ctl0_CONTENU_PAGE_EntrepriseDownloadDce_completeDownload">x</a>';
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer;
    const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
      const n = calls.length;
      if (n === 1) return res({ setCookie: ['s=1; Path=/'], text: html1 });
      if (n === 2) return res({ text: html2 });
      if (n === 3)
        return res({
          status: 302,
          headers: {
            location:
              'index.php?page=entreprise.EntrepriseDownloadCompleteDce&reference=R&orgAcronym=O',
          },
        });
      return res({
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="DAO 58.zip";',
        },
        buf: zip,
      });
    }) as unknown as typeof fetch;

    const dossier = await downloadDce(
      { refConsultation: 'R', orgAcronyme: 'O' },
      IDENT,
      fetchImpl,
    );
    expect(dossier.sizeBytes).toBe(7);
    expect(dossier.filename).toBe('DAO 58.zip');
    expect(dossier.mime).toBe('application/zip');
    expect(calls).toHaveLength(4);
    expect(calls[1]!.body).toContain('validateButton');
    expect(calls[1]!.body).toContain('accepterConditions=on');
    expect(calls[2]!.body).toContain('completeDownload');
    expect(calls[3]!.url).toContain('EntrepriseDownloadCompleteDce');
  });

  test('throws when the final response is not a ZIP', async () => {
    const fetchImpl = (async () =>
      res({
        text: '<html>form</html>',
        headers: { 'content-type': 'text/html', location: 'index.php?x=1' },
      })) as unknown as typeof fetch;
    await expect(
      downloadDce({ refConsultation: 'R', orgAcronyme: 'O' }, IDENT, fetchImpl),
    ).rejects.toThrow(/unexpected response|no redirect/i);
  });
});
