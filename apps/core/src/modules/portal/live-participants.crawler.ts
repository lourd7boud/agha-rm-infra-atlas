import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PortalAuthSession } from './portal-auth';

/**
 * Live participants intel — the feature that beats datao.
 *
 * Datao caches its dataset daily and never surfaces live activity on OPEN
 * consultations. PMMP, on the other hand, DOES publish counters on every
 * consultation detail page:
 *   • nombreElementTelechargement — companies that retrieved the DCE
 *   • nombreElementQuestion       — public questions posted (with buyer's answers)
 *   • nombreElementCaution        — cautions provisoires filed (strong bidder signal)
 *   • nombreElementMessagerie     — secured messages exchanged
 *
 * These spans are TEMPLATED in the anonymous HTML but always empty ("Aucun
 * résultat" for anonymous callers); the banner "Vous n'êtes pas authentifié"
 * confirms auth is the gate. The exact same URL served to a logged-in
 * PortalAuthSession returns the populated counts.
 *
 * The workflow this enables in the ATLAS UI: on any active tender detail, an
 * operator clicks "Voir concurrents live" → we hit PMMP once, parse the four
 * counters plus the deadline, and return them. Result cached briefly server
 * side (see the wired endpoint) so a stampede of clicks does not abuse PMMP.
 */

const PMMP_BASE = 'https://www.marchespublics.gov.ma';

/** Result of ONE live pull from PMMP. All counters null when auth is off. */
export interface LiveParticipants {
  refConsultation: string;
  orgAcronyme: string;
  retraits: number | null;
  questions: number | null;
  cautions: number | null;
  messagerie: number | null;
  /** Portal-displayed deadline (extracted from the same page — used to detect
   *  extensions vs the deadline_at we already have stored on the tender). */
  deadline: Date | null;
  fetchedAt: Date;
  sourceUrl: string;
  /** false when PortalAuthSession is not configured (no PMMP credentials in
   *  env); the endpoint still resolves, the UI shows a clear disabled state. */
  authenticated: boolean;
}

/** Parse (refConsultation, orgAcronyme) out of a stored tender.source_url. */
export function parsePmmpRefs(
  sourceUrl: string,
): { refConsultation: string; orgAcronyme: string } | null {
  try {
    const u = new URL(sourceUrl);
    const ref = u.searchParams.get('refConsultation');
    const org = u.searchParams.get('orgAcronyme');
    if (!ref || !org) return null;
    // Strip anything unreasonable — the portal always uses [A-Za-z0-9] here.
    if (!/^[A-Za-z0-9-]{1,40}$/.test(ref)) return null;
    if (!/^[A-Za-z0-9]{1,20}$/.test(org)) return null;
    return { refConsultation: ref, orgAcronyme: org };
  } catch {
    return null;
  }
}

/** Build the canonical authed URL from the extracted refs. */
export function buildDetailsUrl(refConsultation: string, orgAcronyme: string): string {
  const q = new URLSearchParams({
    page: 'entreprise.EntrepriseDetailsConsultation',
    refConsultation,
    orgAcronyme,
  });
  return `${PMMP_BASE}/?${q.toString()}`;
}

/** "5" → 5, ""/null/"—" → null. Whitespace-tolerant. */
function parseIntOrNull(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return null;
  const n = Number(trimmed.replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull ONE `<span id="…{suffix}">…</span>` payload out of the detail HTML.
 * Suffix-match (not exact) because PRADO prefixes with `ctl0_CONTENU_PAGE_`
 * on the detail page but with slight variations on other layouts.
 */
function extractSpanContentBySuffix(html: string, suffix: string): string | null {
  const re = new RegExp(
    `<span[^>]*\\bid="[^"]*${suffix}"[^>]*>([\\s\\S]*?)</span>`,
    'i',
  );
  const m = re.exec(html);
  return m ? m[1] ?? null : null;
}

/** "14/07/2026 12:00" → Date(UTC). Returns null on bad input. */
export function parsePmmpDeadline(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MM] = m;
  const iso = `${yyyy}-${mm}-${dd}T${HH}:${MM}:00Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Turn a PMMP detail HTML page into the four counters + the deadline. When
 * called with anonymous HTML every counter is null (that IS the signal the
 * caller uses to render the "authentication required" disabled state).
 */
export function parseLiveParticipants(input: {
  html: string;
  refConsultation: string;
  orgAcronyme: string;
  sourceUrl: string;
  authenticated: boolean;
  now: Date;
}): LiveParticipants {
  const { html, refConsultation, orgAcronyme, sourceUrl, authenticated, now } = input;
  const deadlineRaw = extractSpanContentBySuffix(html, 'dateHeureLimiteRemisePlis');
  return {
    refConsultation,
    orgAcronyme,
    retraits: parseIntOrNull(extractSpanContentBySuffix(html, 'nombreElementTelechargement')),
    questions: parseIntOrNull(extractSpanContentBySuffix(html, 'nombreElementQuestion')),
    cautions: parseIntOrNull(extractSpanContentBySuffix(html, 'nombreElementCaution')),
    messagerie: parseIntOrNull(extractSpanContentBySuffix(html, 'nombreElementMessagerie')),
    deadline: parsePmmpDeadline(deadlineRaw),
    fetchedAt: now,
    sourceUrl,
    authenticated,
  };
}

@Injectable()
export class LiveParticipantsCrawlerService {
  private readonly logger = new Logger('LiveParticipants');

  constructor(
    @Optional() private readonly session: PortalAuthSession | null,
  ) {}

  /**
   * Fetch the live counters for ONE tender. Falls back cleanly when
   * PMMP credentials are absent (throws 503 with a clear operator hint)
   * so the UI can still render a disabled state pointing at the fix.
   */
  async fetch(
    refConsultation: string,
    orgAcronyme: string,
  ): Promise<LiveParticipants> {
    const url = buildDetailsUrl(refConsultation, orgAcronyme);
    if (!this.session) {
      throw new ServiceUnavailableException(
        'PORTAL_AUTH_LOGIN + PORTAL_AUTH_PASSWORD requis pour le live PMMP (voir platform/.env.apps)',
      );
    }
    const html = await this.session.authedFetch(url);
    const result = parseLiveParticipants({
      html,
      refConsultation,
      orgAcronyme,
      sourceUrl: url,
      authenticated: true,
      now: new Date(),
    });
    this.logger.log(
      `live-participants ${refConsultation}/${orgAcronyme}: retraits=${result.retraits} q=${result.questions} c=${result.cautions}`,
    );
    return result;
  }
}
