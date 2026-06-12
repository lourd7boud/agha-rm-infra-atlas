import { readFile } from 'node:fs/promises';

export interface PortalPage {
  html: string;
  sourceUrl: string;
}

/** Abstraction over where portal HTML comes from (live HTTP vs recorded fixture). */
export interface PortalSource {
  fetch(): Promise<PortalPage>;
}

export const PORTAL_SOURCE = Symbol('PORTAL_SOURCE');

/** Dev/test source reading a recorded snapshot from disk. */
export class FixturePortalSource implements PortalSource {
  constructor(
    private readonly filePath: string,
    private readonly sourceUrl = 'https://www.marchespublics.gov.ma/',
  ) {}

  async fetch(): Promise<PortalPage> {
    const html = await readFile(this.filePath, 'utf8');
    return { html, sourceUrl: this.sourceUrl };
  }
}

export interface HttpPortalOptions {
  /** Total attempts before giving up (default 3). */
  attempts?: number;
  /** Base backoff in ms; doubles each retry (default 1500). */
  backoffMs?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Live source — a polite GET with an honest User-Agent, hard timeout, and a
 * bounded retry with exponential backoff. Government portals drop requests;
 * a transient failure should not abort the whole Sentinel run. After the
 * final attempt the error propagates so coverage records the miss.
 */
export class HttpPortalSource implements PortalSource {
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly url: string,
    options: HttpPortalOptions = {},
  ) {
    this.attempts = Math.max(1, options.attempts ?? 3);
    this.backoffMs = options.backoffMs ?? 1500;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async fetch(): Promise<PortalPage> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        return await this.fetchOnce();
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts) {
          await this.sleep(this.backoffMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Portal fetch failed');
  }

  private async fetchOnce(): Promise<PortalPage> {
    const response = await this.fetchImpl(this.url, {
      headers: {
        'User-Agent': 'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Portal fetch failed: HTTP ${response.status}`);
    }
    return { html: await response.text(), sourceUrl: this.url };
  }
}
