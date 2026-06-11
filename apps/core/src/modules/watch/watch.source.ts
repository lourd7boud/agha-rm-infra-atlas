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

/**
 * Live source — single polite GET with an honest User-Agent and a hard
 * timeout. Scheduling stays respectful (a few runs per day, see WATCH_CRON);
 * heavier crawling needs the runbook's throttling rules first.
 */
export class HttpPortalSource implements PortalSource {
  constructor(private readonly url: string) {}

  async fetch(): Promise<PortalPage> {
    const response = await fetch(this.url, {
      headers: {
        'User-Agent': 'ATLAS-Sentinel/0.1 (AGHA RM INFRA; veille marchés publics)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Portal fetch failed: HTTP ${response.status}`);
    }
    return { html: await response.text(), sourceUrl: this.url };
  }
}
