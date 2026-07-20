import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import type { PriceEvidenceAdapter, PriceEvidenceQuery } from "./bdc-evidence.types";
import type { PriceObservation } from "./bdc-pricing.types";

export interface SearchHit {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchClient {
  search(query: string): Promise<SearchHit[]>;
}

export interface FetchedPage {
  url: string;
  html: string;
  snapshotHash: string;
  fetchedAt: Date;
  contentType?: string;
}

export interface PricePageFetcher {
  fetch(url: string): Promise<FetchedPage>;
}

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type ResolveHost = (hostname: string) => Promise<string[]>;

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

export class BraveSearchClient implements WebSearchClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async search(query: string): Promise<SearchHit[]> {
    if (!this.apiKey.trim()) throw new Error("BRAVE_SEARCH_API_KEY is not configured");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "10");
    url.searchParams.set("country", "MA");
    url.searchParams.set("search_lang", "fr");
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Brave search failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> };
    };
    return (payload.web?.results ?? [])
      .filter(
        (item): item is { title: string; url: string; description?: unknown } =>
          typeof item.title === "string" && typeof item.url === "string",
      )
      .map((item) => ({
        title: item.title.slice(0, 300),
        url: item.url,
        description:
          typeof item.description === "string" ? item.description.slice(0, 1_000) : "",
      }));
  }
}

export interface SafePricePageFetcherOptions {
  allowHosts: string[];
  resolveHost?: ResolveHost;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBodyBytes?: number;
  now?: () => Date;
}

export class SafePricePageFetcher implements PricePageFetcher {
  private readonly allowHosts: Set<string>;
  private readonly resolveHost: ResolveHost;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly now: () => Date;

  constructor(options: SafePricePageFetcherOptions) {
    this.allowHosts = new Set(
      options.allowHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
    );
    this.resolveHost =
      options.resolveHost ??
      (async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map(
          (entry) => entry.address,
        ));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  async fetch(input: string): Promise<FetchedPage> {
    let current = new URL(input);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await this.assertSafeUrl(current);
      const response = await this.fetchOnce(current);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect response has no location");
        if (redirects === 3) throw new Error("Too many redirects");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`Price page failed with HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml|application\/json/i.test(contentType)) {
        throw new Error(`Unsupported price page content type: ${contentType}`);
      }
      const html = await readBoundedBody(response, this.maxBodyBytes);
      return {
        url: current.toString(),
        html,
        snapshotHash: createHash("sha256").update(html).digest("hex"),
        fetchedAt: this.now(),
        contentType,
      };
    }
    throw new Error("Too many redirects");
  }

  private async assertSafeUrl(url: URL): Promise<void> {
    if (url.protocol !== "https:") throw new Error("Only HTTPS price sources are allowed");
    if (url.username || url.password) throw new Error("Credentialed URLs are forbidden");
    if (url.port && url.port !== "443") throw new Error("Nonstandard ports are forbidden");
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const allowlisted = [...this.allowHosts].some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
    if (!allowlisted) throw new Error(`Host is not in the price-source allowlist: ${hostname}`);
    const addresses = isIP(hostname) ? [hostname] : await this.resolveHost(hostname);
    if (addresses.length === 0) throw new Error(`No DNS address for ${hostname}`);
    for (const address of addresses) {
      if (isPrivateAddress(address)) {
        throw new Error(`Private or local address is forbidden: ${address}`);
      }
    }
  }

  private async fetchOnce(url: URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json;q=0.8",
          "User-Agent": "ATLAS-Market-Evidence/1.0",
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Price page timeout after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedBody(
  response: Response,
  maxBodyBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new Error("Price page exceeds the 2 MB limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBodyBytes) {
      await reader.cancel();
      throw new Error("Price page exceeds the 2 MB limit");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) {
      return true;
    }
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? isPrivateAddress(mapped) : false;
  }
  return true;
}

interface ExtractedPrice {
  designation: string;
  price: number;
  taxBasis: "HT" | "TTC" | "unknown";
  packageQuantity: number | null;
  packageUnit: string | null;
  extractionMethod: "json_ld_offer" | "visible_mad_price";
}

function parseMoney(raw: string): number | null {
  let value = raw.replace(/\s|\u00a0/g, "");
  if (value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findJsonLdOffer(html: string): { price: number; name: string } | null {
  const $ = load(html);
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(element).text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const queue: unknown[] = [parsed];
    let visited = 0;
    while (queue.length > 0 && visited < 1_000) {
      visited += 1;
      const item = queue.shift();
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item)) {
        queue.push(...item);
        continue;
      }
      const record = item as Record<string, unknown>;
      const currency = typeof record.priceCurrency === "string" ? record.priceCurrency.toUpperCase() : "";
      const price =
        typeof record.price === "number"
          ? record.price
          : typeof record.price === "string"
            ? parseMoney(record.price)
            : null;
      if (price && (!currency || ["MAD", "DH", "DHS"].includes(currency))) {
        return {
          price,
          name: typeof record.name === "string" ? record.name : "",
        };
      }
      queue.push(...Object.values(record));
    }
  }
  return null;
}

function extractPrice(html: string, fallbackDesignation: string): ExtractedPrice | null {
  const $ = load(html);
  $('script,style,noscript,template').remove();
  const text = $.root().text().replace(/\s+/g, " ").trim();
  const jsonLd = findJsonLdOffer(html);
  const visible = text.match(
    /(?:prix\s*(?:ht|ttc)?\s*[:\-]?\s*)?(\d+(?:[ .]\d{3})*(?:[,.]\d{1,2})?)\s*(?:MAD|DHS?|DH)\b/i,
  );
  const visiblePrice = visible?.[1] ? parseMoney(visible[1]) : null;
  const price = jsonLd?.price ?? visiblePrice;
  if (!price) return null;
  const packageMatch = text.match(
    /(?:pack|lot|bo[iî]te|seau|carton)?\s*(?:de|x)\s*(\d+(?:[,.]\d+)?)\s*(unit[eé]s?|u|pi[eè]ces?)?/i,
  );
  const packageQuantity = packageMatch?.[1] ? parseMoney(packageMatch[1]) : null;

  return {
    designation: jsonLd?.name || fallbackDesignation,
    price,
    taxBasis: /\bTTC\b/i.test(text) ? "TTC" : /\bHT\b/i.test(text) ? "HT" : "unknown",
    packageQuantity,
    packageUnit: packageQuantity ? "u" : null,
    extractionMethod: jsonLd ? "json_ld_offer" : "visible_mad_price",
  };
}

export class MoroccanWebPriceAdapter implements PriceEvidenceAdapter {
  constructor(
    private readonly searchClient: WebSearchClient,
    private readonly pageFetcher: PricePageFetcher,
    private readonly options: { maxPagesPerSearch?: number } = {},
  ) {}

  async search(query: PriceEvidenceQuery): Promise<PriceObservation[]> {
    const limit = Math.max(1, Math.min(30, query.limit));
    const searchQuery = [
      query.line.designation,
      query.line.specification,
      query.line.region,
      "prix Maroc MAD",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 500);
    const hits = await this.searchClient.search(searchQuery);
    const output: PriceObservation[] = [];
    const maxPages = Math.max(
      1,
      Math.min(limit, this.options.maxPagesPerSearch ?? limit),
    );
    for (const hit of hits.slice(0, maxPages)) {
      try {
        const page = await this.pageFetcher.fetch(hit.url);
        const extracted = extractPrice(page.html, query.line.designation);
        if (!extracted) continue;
        const packageMetadata = extracted.packageQuantity
          ? {
              packageQuantity: extracted.packageQuantity,
              packageUnit: extracted.packageUnit,
            }
          : {};
        output.push({
          designation: extracted.designation,
          category: query.line.category,
          unit: extracted.packageQuantity ? "pack" : query.line.unit,
          unitPriceHtMad: extracted.price,
          region: query.line.region,
          observedAt: page.fetchedAt.toISOString(),
          sourceType: "web",
          sourceRef: `${new URL(page.url).hostname} — ${hit.title}`.slice(0, 300),
          sourceUrl: page.url,
          snapshotHash: page.snapshotHash,
          verified: false,
          reliability: 0.6,
          metadata: {
            taxBasis: extracted.taxBasis,
            extractionMethod: extracted.extractionMethod,
            fetchedLandingPage: true,
            ...packageMetadata,
          },
        });
      } catch {
        continue;
      }
    }
    return output;
  }
}
