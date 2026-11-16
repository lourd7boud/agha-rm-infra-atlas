import { Injectable } from '@nestjs/common';
import { load, type CheerioAPI } from 'cheerio';
import { readBoundedResponse } from '../tender/dossier-archive-safety';
import { cookieHeader, mergeCookieHeaders, PORTAL_UA, PORTAL_TIMEOUT } from './portal-fetch';
import { parseFormInputs } from './prado';

/**
 * Autonomous DCE (Dossier de Consultation des Entreprises) download from
 * marchespublics.gov.ma (Atexo MPE / PRADO) — datao's "Télécharger" extra,
 * reproduced on our own infra with NO portal login and NO manual form-filling.
 *
 * The portal serves the dossier behind the `EntrepriseDemandeTelechargementDce`
 * form (accept conditions + identity). The working flow, reverse-engineered from
 * a real browser submit, is a 4-step PRADO dance:
 *   1. GET   the demande page                      → cookie + PRADO_PAGESTATE
 *   2. POST  validateButton (accept + identity)    → re-render w/ completeDownload
 *   3. POST  EntrepriseDownloadDce$completeDownload → 302 to the file URL
 *   4. GET   EntrepriseDownloadCompleteDce         → the ZIP (application/zip)
 * Identity is a fixed company contact (env-overridable); the portal only uses it
 * to notify of rectificatifs — exactly the bidder's normal "retrait du dossier".
 */

const BASE = 'https://www.marchespublics.gov.ma/';
const EFD = 'ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$';
const FORM_CLIENT_ID = 'ctl0_CONTENU_PAGE_EntrepriseFormulaireDemande';
const DEMANDE_PAGE = 'entreprise.EntrepriseDemandeTelechargementDce';
const VALIDATE_TARGET = 'ctl0$CONTENU_PAGE$validateButton';
const COMPLETE_TARGET = 'ctl0$CONTENU_PAGE$EntrepriseDownloadDce$completeDownload';

export interface DceIdentity {
  nom: string;
  prenom: string;
  email: string;
  raisonSocial: string;
  ice: string;
  pays: string;
  address: string;
}

/** Default = AGHA RM INFRA / AGHID coordinates captured from the portal. The
 *  email is a placeholder — set PORTAL_DCE_EMAIL to a mailbox you monitor so
 *  rectificatif notifications actually reach you. */
const DEFAULT_IDENTITY: DceIdentity = {
  nom: 'AGHA RM INFRA',
  prenom: 'Service Marches',
  email: 'contact@agharminfra.ma',
  raisonSocial: 'AGHA RM INFRA',
  ice: '001532975000060',
  pays: '0',
  address: 'Inzgane',
};

export function dceIdentityFromEnv(env: NodeJS.ProcessEnv = process.env): DceIdentity {
  return {
    nom: env.PORTAL_DCE_NOM?.trim() || DEFAULT_IDENTITY.nom,
    prenom: env.PORTAL_DCE_PRENOM?.trim() || DEFAULT_IDENTITY.prenom,
    email: env.PORTAL_DCE_EMAIL?.trim() || DEFAULT_IDENTITY.email,
    raisonSocial: env.PORTAL_DCE_RAISON?.trim() || DEFAULT_IDENTITY.raisonSocial,
    ice: env.PORTAL_DCE_ICE?.trim() || DEFAULT_IDENTITY.ice,
    pays: env.PORTAL_DCE_PAYS?.trim() || DEFAULT_IDENTITY.pays,
    address: env.PORTAL_DCE_ADDRESS?.trim() || DEFAULT_IDENTITY.address,
  };
}

export interface PortalRef {
  refConsultation: string;
  orgAcronyme: string;
}

/** Extracts (refConsultation, orgAcronyme) from a portal detail/download URL.
 *  Tolerates both naming variants (refConsultation|reference, orgAcronyme|orgAcronym). */
export function parsePortalRef(sourceUrl: string | null | undefined): PortalRef | null {
  if (!sourceUrl) return null;
  try {
    const u = new URL(sourceUrl);
    const ref = u.searchParams.get('refConsultation') ?? u.searchParams.get('reference');
    const org = u.searchParams.get('orgAcronyme') ?? u.searchParams.get('orgAcronym');
    if (ref && org) return { refConsultation: ref, orgAcronyme: org };
  } catch {
    /* not a parseable URL */
  }
  return null;
}

export interface DceDossier {
  filename: string;
  bytes: Buffer;
  mime: string;
  sizeBytes: number;
}

export interface DceDownloadStep {
  step: 1 | 2 | 3 | 4;
  status?: number;
  elapsedMs: number;
  pageState?: boolean;
  anonymousControl?: 'visible' | 'hidden' | 'absent' | 'disabled';
  nextControl?: boolean;
  officialRedirect?: boolean;
  archiveSignature?: boolean;
}

export class AnonymousDceUnavailableError extends Error {
  constructor() { super('DCE download: anonymous mode unavailable in the official form'); }
}

export function demandeUrl(ref: PortalRef): string {
  return `${BASE}index.php?page=${DEMANDE_PAGE}&refConsultation=${encodeURIComponent(ref.refConsultation)}&orgAcronyme=${encodeURIComponent(ref.orgAcronyme)}`;
}

/** Step-2 body. Null selects the portal's explicit anonymous withdrawal mode. */
export function buildDemandeBody(
  parsed: Record<string, string>,
  identity: DceIdentity | null,
): string {
  const body = new URLSearchParams(parsed);
  if (identity === null) {
    // The page can contain prefilled contact controls even in anonymous mode.
    // Keep server state, but never replay any contact data or unknown form field.
    for (const key of [...body.keys()]) if (key.startsWith(EFD)) body.delete(key);
  }
  body.set('PRADO_POSTBACK_TARGET', VALIDATE_TARGET);
  body.set('PRADO_POSTBACK_PARAMETER', 'undefined');
  body.set(`${EFD}RadioGroup`, `${EFD}${identity === null ? 'choixAnonyme' : 'choixTelechargement'}`);
  body.set(`${EFD}accepterConditions`, 'on');
  body.set(`${EFD}clientId`, FORM_CLIENT_ID);
  if (identity === null) return body.toString();
  body.set(`${EFD}etablissementEntreprise`, `${EFD}france`);
  body.set(`${EFD}nom`, identity.nom);
  body.set(`${EFD}prenom`, identity.prenom);
  body.set(`${EFD}email`, identity.email);
  body.set(`${EFD}raisonSocial`, identity.raisonSocial);
  body.set(`${EFD}ICE`, identity.ice);
  body.set(`${EFD}pays`, identity.pays);
  body.set(`${EFD}address`, identity.address);
  body.set(`${EFD}idNational`, '');
  return body.toString();
}

/** Step-3 body: postback to the completeDownload control. */
export function buildCompleteDownloadBody(parsed: Record<string, string>, anonymous = false): string {
  const body = new URLSearchParams(anonymous ? buildDemandeBody(parsed, null) : parsed);
  body.set('PRADO_POSTBACK_TARGET', COMPLETE_TARGET);
  body.set('PRADO_POSTBACK_PARAMETER', '');
  return body.toString();
}

function filenameFromDisposition(cd: string | null, fallback: string): string {
  const m = /filename="?([^"]+?)"?;?\s*$/i.exec(cd ?? '');
  return m?.[1]?.trim() || fallback;
}

const FORM_HEADERS = {
  'User-Agent': PORTAL_UA,
  Accept: '*/*',
  'Content-Type': 'application/x-www-form-urlencoded',
};

function officialDownloadUrl(value: string, base = BASE): string {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['www.marchespublics.gov.ma', 'marchespublics.gov.ma'].includes(url.hostname)) {
    throw new Error('DCE download: expected an official HTTPS PMMP URL');
  }
  return url.href;
}

async function requireOk(response: Response, step: number): Promise<void> {
  if (response.ok && response.status >= 200 && response.status < 300) return;
  await response.body?.cancel().catch(() => {});
  throw new Error(`DCE download: step ${step} HTTP ${response.status}`);
}

function hasPageState($: ReturnType<typeof load>): boolean {
  const field = $('input[type="hidden"][name="PRADO_PAGESTATE"]');
  return field.length === 1 && Boolean(field.val()?.toString().trim());
}

type HtmlControl = ReturnType<ReturnType<CheerioAPI['root']>['find']>;

function isStaticallyHidden($: ReturnType<typeof load>, control: HtmlControl): boolean {
  return control.parents().add(control).toArray().some(node => {
    const element = $(node);
    return element.attr('hidden') !== undefined || element.attr('aria-hidden') === 'true' ||
      element.attr('type')?.toLowerCase() === 'hidden' || element.hasClass('d-none') ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(element.attr('style') ?? '');
  });
}

function inspectAnonymousControl($: ReturnType<typeof load>): NonNullable<DceDownloadStep['anonymousControl']> {
  const selector = `input[type="radio"][name="${EFD}RadioGroup"][value="${EFD}choixAnonyme"]`;
  const controls = $(selector);
  if (!controls.length) return 'absent';
  const enabled = controls.not('[disabled]');
  if (!enabled.length) return 'disabled';
  const staticallyHidden = enabled.toArray().every(control => isStaticallyHidden($, $(control)));
  return staticallyHidden ? 'hidden' : 'visible';
}

function completeDownloadControl($: ReturnType<typeof load>, scope?: HtmlControl): HtmlControl {
  const id = COMPLETE_TARGET.replaceAll('$', '_');
  const selector = `a[id="${id}"], input[id="${id}"], button[id="${id}"], input[name="${COMPLETE_TARGET}"], button[name="${COMPLETE_TARGET}"]`;
  return (scope ?? $('html')).find(selector).not('[disabled]');
}

function canonicalAccountForm($: ReturnType<typeof load>, url: string): HtmlControl | null {
  const expected = new URL(url);
  const forms = $('form').filter((_idx, node) => {
    const form = $(node);
    const action = form.attr('action');
    if (!action || form.attr('method')?.toLowerCase() !== 'post') return false;
    try {
      const target = new URL(officialDownloadUrl(action, url));
      return target.origin === expected.origin && ['/', '/index.php'].includes(target.pathname) && !target.hash &&
        ['page', 'refConsultation', 'orgAcronyme'].every(key => {
          const values = target.searchParams.getAll(key);
          return values.length === 1 && values[0] === expected.searchParams.get(key);
        });
    } catch { return false; }
  });
  return forms.length === 1 ? forms : null;
}

function accountPageState(form: HtmlControl): string | null {
  const state = form.find('input[type="hidden"][name="PRADO_PAGESTATE"]').not('[disabled]');
  const value = state.attr('value');
  return state.length === 1 && value?.trim() ? value : null;
}

function isActiveAccountControl($: ReturnType<typeof load>, control: HtmlControl): boolean {
  return control.length === 1 && !control.is('[disabled], [aria-disabled="true"]') &&
    !control.parents('fieldset[disabled]').length && !isStaticallyHidden($, control);
}

/** Uses the signed-in portal form's own values, scoped to the target consultation. */
function accountWithdrawalBody($: ReturnType<typeof load>, url: string): string {
  const unavailable = () => new Error('DCE download: portal account withdrawal form unavailable');
  const form = canonicalAccountForm($, url);
  if (!form || !$('a').toArray().some(link => $(link).text().trim() === 'Déconnexion') ||
      $.root().text().includes('Par login et mot de passe')) throw unavailable();

  const state = accountPageState(form);
  const radio = form.find(`input[type="radio"][name="${EFD}RadioGroup"][checked]`).not('[disabled]');
  const acceptance = form.find(`input[type="checkbox"][name="${EFD}accepterConditions"]`);
  const validate = form.find(`input[type="submit"][name="${VALIDATE_TARGET}"], button[name="${VALIDATE_TARGET}"]`);
  const clientId = form.find(`input[type="hidden"][name="${EFD}clientId"]`).not('[disabled]');
  if (!state || radio.length !== 1 || radio.attr('value') !== `${EFD}choixTelechargement` || !isStaticallyHidden($, radio) ||
      !isActiveAccountControl($, acceptance) || acceptance.attr('checked') !== undefined ||
      !isActiveAccountControl($, validate) || clientId.length !== 1 || clientId.attr('value') !== FORM_CLIENT_ID) {
    throw unavailable();
  }

  const body = new URLSearchParams({ PRADO_PAGESTATE: state, PRADO_POSTBACK_TARGET: VALIDATE_TARGET, PRADO_POSTBACK_PARAMETER: 'undefined' });
  body.set(`${EFD}RadioGroup`, radio.attr('value')!);
  body.set(`${EFD}clientId`, clientId.attr('value')!);
  body.set(`${EFD}accepterConditions`, acceptance.attr('value') ?? 'on');
  for (const field of ['nom', 'prenom', 'email', 'raisonSocial', 'ICE', 'address']) {
    const input = form.find(`input[name="${EFD}${field}"]`);
    const value = input.attr('value');
    if (!isActiveAccountControl($, input) || !value?.trim()) throw unavailable();
    body.set(`${EFD}${field}`, value);
  }

  const establishment = form.find(`input[type="radio"][name="${EFD}etablissementEntreprise"][checked]`);
  const establishmentValue = establishment.attr('value');
  if (isActiveAccountControl($, establishment) && [`${EFD}france`, `${EFD}etranger`].includes(establishmentValue ?? '')) {
    body.set(`${EFD}etablissementEntreprise`, establishmentValue!);
  }
  const country = form.find(`select[name="${EFD}pays"]`).not('[multiple]');
  const countryOption = country.find('option[selected]').not('[disabled], optgroup[disabled] option');
  const countryValue = countryOption.attr('value');
  if (isActiveAccountControl($, country) && countryOption.length === 1 && countryValue?.trim()) {
    body.set(`${EFD}pays`, countryValue);
  }
  return body.toString();
}

/**
 * Runs the 4-step flow and returns the dossier ZIP bytes. Throws a clear error
 * if any step fails or the final response is not a ZIP (e.g. consultation
 * withdrawn, portal layout changed). `fetchImpl` is injectable for tests.
 */
export async function downloadDce(
  ref: PortalRef,
  identity: DceIdentity | null,
  fetchImpl: typeof fetch = fetch,
  options: { signal?: AbortSignal; onStep?: (step: DceDownloadStep) => void; usePortalAccount?: boolean } = {},
): Promise<DceDossier> {
  const portalAccount = options.usePortalAccount === true;
  if (portalAccount && identity !== null) throw new Error('DCE download: portal account mode requires identity from the portal form');
  const anonymous = !portalAccount && identity === null;
  const url = demandeUrl(ref);
  type StepDetails = Omit<DceDownloadStep, 'step' | 'elapsedMs'>;
  const runStep = async <T>(step: DceDownloadStep['step'], execute: (details: StepDetails) => Promise<T>): Promise<T> => {
    const startedAt = performance.now();
    const details: StepDetails = {};
    try {
      return await execute(details);
    } finally {
      try { options.onStep?.({ step, elapsedMs: Math.round(performance.now() - startedAt), ...details }); }
      catch { /* Diagnostic consumers must not interrupt the download. */ }
    }
  };
  const request = async (details: StepDetails, target: string, init: RequestInit, timeout = PORTAL_TIMEOUT) => {
    options.signal?.throwIfAborted();
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    const response = await fetchImpl(officialDownloadUrl(target), { ...init, redirect: 'manual', signal });
    details.status = response.status;
    options.signal?.throwIfAborted();
    if (response.url) officialDownloadUrl(response.url);
    return response;
  };

  // 1. GET the demande form.
  let cookie = '';
  const validateBody = await runStep(1, async details => {
    const get = await request(details, url, {
      headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
    });
    await requireOk(get, 1);
    cookie = cookieHeader(get.headers.getSetCookie());
    const html = await get.text();
    if (identity === null || options.onStep) {
      const $ = load(html);
      details.pageState = hasPageState($);
      details.anonymousControl = inspectAnonymousControl($);
      if (portalAccount) return accountWithdrawalBody($, url);
      if (anonymous && details.anonymousControl !== 'visible') throw new AnonymousDceUnavailableError();
      if (anonymous && (!details.pageState || !parseFormInputs(html).PRADO_PAGESTATE?.trim())) {
        throw new Error('DCE download: anonymous mode unavailable without replayable portal state');
      }
    }
    return buildDemandeBody(parseFormInputs(html), identity);
  });

  // 2. POST the selected withdrawal mode (validateButton).
  const completeBody = await runStep(2, async details => {
    const post1 = await request(details, url, {
      method: 'POST',
      headers: { ...FORM_HEADERS, Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
      body: validateBody,
    });
    await requireOk(post1, 2);
    cookie = mergeCookieHeaders(cookie, post1.headers.getSetCookie());
    const html = await post1.text();
    if (identity === null || options.onStep) {
      const $ = load(html);
      details.pageState = hasPageState($);
      details.nextControl = completeDownloadControl($).length > 0;
      if (portalAccount) {
        const form = canonicalAccountForm($, url);
        const state = form && accountPageState(form);
        const complete = form && completeDownloadControl($, form);
        if (!state || !complete || !isActiveAccountControl($, complete)) {
          throw new Error('DCE download: portal account continuation form unavailable after validation');
        }
        return buildCompleteDownloadBody({ PRADO_PAGESTATE: state });
      }
      if (anonymous && (!details.pageState || !details.nextControl || !parseFormInputs(html).PRADO_PAGESTATE?.trim())) {
        throw new Error('DCE download: anonymous continuation form unavailable after validation');
      }
    }
    return buildCompleteDownloadBody(parseFormInputs(html), anonymous);
  });

  // 3. POST the completeDownload postback → 302 to the file URL.
  const fileUrl = await runStep(3, async details => {
    const post2 = await request(details, url, {
      method: 'POST',
      headers: { ...FORM_HEADERS, Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
      body: completeBody,
    });
    cookie = mergeCookieHeaders(cookie, post2.headers.getSetCookie());
    const location = post2.headers.get('location');
    await post2.body?.cancel().catch(() => {});
    details.officialRedirect = false;
    if (!location || ![301, 302, 303, 307, 308].includes(post2.status)) {
      throw new Error(`DCE download: no redirect to the file (step 3 HTTP ${post2.status})`);
    }
    const target = officialDownloadUrl(location, url);
    if (portalAccount && new URL(target).origin !== new URL(url).origin) {
      throw new Error('DCE download: portal account redirect changed origin');
    }
    details.officialRedirect = true;
    return target;
  });

  // 4. GET the file.
  return runStep(4, async details => {
    const fileRes = await request(details, fileUrl, {
      headers: { 'User-Agent': PORTAL_UA, Accept: '*/*', Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
    }, PORTAL_TIMEOUT * 3);
    await requireOk(fileRes, 4);
    const bytes = await readBoundedResponse(fileRes);
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
    details.archiveSignature = isZip && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
    const ct = fileRes.headers.get('content-type') ?? '';
    if (!isZip && !ct.includes('zip')) {
      throw new Error(`DCE download: unexpected archive response (${bytes.length} bytes)`);
    }
    return {
      filename: filenameFromDisposition(fileRes.headers.get('content-disposition'), `DAO ${ref.refConsultation}.zip`),
      bytes,
      mime: 'application/zip',
      sizeBytes: bytes.length,
    };
  });
}

@Injectable()
export class DossierCrawlerService {
  async download(ref: PortalRef): Promise<DceDossier> {
    return downloadDce(ref, dceIdentityFromEnv());
  }
}
