// Crawler du module /bdc (bons de commande) du portail PMMP.
//
// Le module BDC vit derrière un postback PRADO: la home entreprise porte un
// menu "Bon de commande → Avis d'achat en cours" dont le TLinkButton
// (ctl0$menuGaucheEntreprise$ctl67) redirige, une fois cliqué, vers
// /bdc/entreprise/consultation/ (app Symfony/Bootstrap classique, paginée par
// ?page=N). On rejoue donc le postback UNE fois pour amorcer la session, puis
// on pagine en GET simple avec le cookie jar.
import { parseFormInputs } from '../watch/prado';
import { parseBdcDetail, parseBdcListe, type BdcDetail, type BdcListe } from './bdc.parser';

const BASE = 'https://www.marchespublics.gov.ma';
const SEARCH_URL = `${BASE}/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons&searchAnnCons`;
const BDC_LISTE = `${BASE}/bdc/entreprise/consultation/`;
const BDC_MENU_TARGET = 'ctl0$menuGaucheEntreprise$ctl67';
const USER_AGENT = 'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marches publics)';

export interface BdcCrawlerOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Fetch qui accumule les cookies Set-Cookie (session PRADO + Symfony). */
class CookieClient {
  private cookies = new Map<string, string>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
  ) {}

  private header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(response: Response): void {
    // getSetCookie() est la voie standard; fallback sur le header brut.
    const raw =
      (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : []);
    for (const line of raw) {
      const pair = line.split(';', 1)[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  async get(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', Cookie: this.header() },
      redirect: 'follow',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    this.absorb(response);
    if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
    return response.text();
  }

  async postForm(url: string, body: Record<string, string>): Promise<string> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.header(),
      },
      body: new URLSearchParams(body).toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    this.absorb(response);
    if (!response.ok) throw new Error(`POST ${url} → HTTP ${response.status}`);
    return response.text();
  }
}

/**
 * Ouvre la session BDC via le postback PRADO puis retourne le client à jour.
 * Idempotent: chaque run recommence proprement (cookies neufs).
 */
async function openBdcSession(client: CookieClient): Promise<void> {
  const searchHtml = await client.get(SEARCH_URL);
  const inputs = parseFormInputs(searchHtml);
  await client.postForm(SEARCH_URL, {
    ...inputs,
    PRADO_POSTBACK_TARGET: BDC_MENU_TARGET,
    PRADO_POSTBACK_PARAMETER: '',
  });
}

export class BdcCrawler {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BdcCrawlerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Une page de la liste des avis d'achat (1-based). */
  async fetchListe(page = 1): Promise<BdcListe> {
    const client = new CookieClient(this.fetchImpl, this.timeoutMs);
    await openBdcSession(client);
    const url = page > 1 ? `${BDC_LISTE}?page=${page}` : BDC_LISTE;
    return parseBdcListe(await client.get(url));
  }

  /** Le détail d'un avis (articles structurés). */
  async fetchDetail(portalId: number): Promise<BdcDetail> {
    const client = new CookieClient(this.fetchImpl, this.timeoutMs);
    await openBdcSession(client);
    const html = await client.get(`${BDC_LISTE}show/${portalId}`);
    return parseBdcDetail(html);
  }

  /**
   * Balaye les N premières pages de la liste en une seule session (cookie
   * réutilisé) — l'appelant persiste les items au fur et à mesure.
   */
  async *crawlListe(maxPages: number): AsyncGenerator<{ page: number; liste: BdcListe }> {
    const client = new CookieClient(this.fetchImpl, this.timeoutMs);
    await openBdcSession(client);
    for (let page = 1; page <= maxPages; page += 1) {
      const url = page > 1 ? `${BDC_LISTE}?page=${page}` : BDC_LISTE;
      const liste = parseBdcListe(await client.get(url));
      yield { page, liste };
      if (liste.items.length === 0) break;
    }
  }

  /** Détails de plusieurs avis dans une session partagée. */
  async fetchDetailsBatch(portalIds: number[]): Promise<Map<number, BdcDetail>> {
    const out = new Map<number, BdcDetail>();
    const client = new CookieClient(this.fetchImpl, this.timeoutMs);
    await openBdcSession(client);
    for (const portalId of portalIds) {
      try {
        const html = await client.get(`${BDC_LISTE}show/${portalId}`);
        out.set(portalId, parseBdcDetail(html));
      } catch {
        // On saute un détail en erreur; le prochain run le retentera.
      }
    }
    return out;
  }
}
