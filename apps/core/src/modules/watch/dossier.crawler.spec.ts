import { describe, expect, test } from 'vitest';
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

interface ResOpts {
  ok?: boolean;
  status?: number;
  setCookie?: string[];
  headers?: Record<string, string>;
  text?: string;
  buf?: ArrayBuffer;
}

function res(opts: ResOpts) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      getSetCookie: () => opts.setCookie ?? [],
      get: (h: string) => (opts.headers ?? {})[h.toLowerCase()] ?? null,
    },
    text: async () => opts.text ?? '',
    arrayBuffer: async () => opts.buf ?? new ArrayBuffer(0),
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
