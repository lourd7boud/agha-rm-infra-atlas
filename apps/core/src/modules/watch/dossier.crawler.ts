import { Injectable } from '@nestjs/common';
import { cookieHeader, PORTAL_UA, PORTAL_TIMEOUT } from './portal-fetch';
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

export function demandeUrl(ref: PortalRef): string {
  return `${BASE}index.php?page=entreprise.EntrepriseDemandeTelechargementDce&refConsultation=${encodeURIComponent(ref.refConsultation)}&orgAcronyme=${encodeURIComponent(ref.orgAcronyme)}`;
}

/** Step-2 body: replay the parsed form + accept + identity + the PRADO target. */
export function buildDemandeBody(
  parsed: Record<string, string>,
  identity: DceIdentity,
): string {
  const body = new URLSearchParams(parsed);
  body.set('PRADO_POSTBACK_TARGET', VALIDATE_TARGET);
  body.set('PRADO_POSTBACK_PARAMETER', 'undefined');
  body.set(`${EFD}RadioGroup`, `${EFD}choixTelechargement`);
  body.set(`${EFD}accepterConditions`, 'on');
  body.set(`${EFD}clientId`, 'ctl0_CONTENU_PAGE_EntrepriseFormulaireDemande');
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
export function buildCompleteDownloadBody(parsed: Record<string, string>): string {
  const body = new URLSearchParams(parsed);
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

/**
 * Runs the 4-step flow and returns the dossier ZIP bytes. Throws a clear error
 * if any step fails or the final response is not a ZIP (e.g. consultation
 * withdrawn, portal layout changed). `fetchImpl` is injectable for tests.
 */
export async function downloadDce(
  ref: PortalRef,
  identity: DceIdentity,
  fetchImpl: typeof fetch = fetch,
): Promise<DceDossier> {
  const url = demandeUrl(ref);

  // 1. GET the demande form.
  const get = await fetchImpl(url, {
    headers: { 'User-Agent': PORTAL_UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  let cookie = cookieHeader(get.headers.getSetCookie());
  const html1 = await get.text();

  // 2. POST the identity form (validateButton).
  const post1 = await fetchImpl(url, {
    method: 'POST',
    headers: { ...FORM_HEADERS, Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
    body: buildDemandeBody(parseFormInputs(html1), identity),
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  cookie = cookieHeader(post1.headers.getSetCookie()) || cookie;
  const html2 = await post1.text();

  // 3. POST the completeDownload postback → 302 to the file URL.
  const post2 = await fetchImpl(url, {
    method: 'POST',
    headers: { ...FORM_HEADERS, Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
    body: buildCompleteDownloadBody(parseFormInputs(html2)),
    redirect: 'manual',
    signal: AbortSignal.timeout(PORTAL_TIMEOUT),
  });
  cookie = cookieHeader(post2.headers.getSetCookie()) || cookie;
  const location = post2.headers.get('location');
  if (!location) {
    throw new Error('DCE download: no redirect to the file (step 3 did not advance)');
  }

  // 4. GET the file.
  const fileUrl = new URL(location, BASE).toString();
  const fileRes = await fetchImpl(fileUrl, {
    headers: { 'User-Agent': PORTAL_UA, Accept: '*/*', Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(PORTAL_TIMEOUT * 3),
  });
  if (!fileRes.ok) {
    throw new Error(`DCE download: file HTTP ${fileRes.status}`);
  }
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  const ct = fileRes.headers.get('content-type') ?? '';
  if (!isZip && !ct.includes('zip')) {
    throw new Error(
      `DCE download: unexpected response (content-type "${ct}", ${bytes.length} bytes)`,
    );
  }
  return {
    filename: filenameFromDisposition(
      fileRes.headers.get('content-disposition'),
      `DAO ${ref.refConsultation}.zip`,
    ),
    bytes,
    mime: 'application/zip',
    sizeBytes: bytes.length,
  };
}

@Injectable()
export class DossierCrawlerService {
  async download(ref: PortalRef): Promise<DceDossier> {
    return downloadDce(ref, dceIdentityFromEnv());
  }
}
