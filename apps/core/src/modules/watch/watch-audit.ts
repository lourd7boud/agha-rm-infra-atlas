import { createHash } from 'node:crypto';

export function pmmpIdentity(href: string, base?: string): string | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.searchParams.get('page') !== 'entreprise.EntrepriseDetailsConsultation') return null;
  const ref = url.searchParams.get('refConsultation');
  const org = url.searchParams.get('orgAcronyme');
  if (!ref || !/^\d{1,20}$/.test(ref) || !org || !/^[a-z\d_]{1,40}$/i.test(org)) return null;
  return `${ref}/${org}`;
}

interface AuditPage {
  page: number;
  declared: number | null;
  /** Ordered identities as observed on official cards. Null denotes an unidentified card. */
  sourceRows: readonly (string | null)[] | null;
  parsed: readonly string[];
  skippedRows: number;
}

export interface WatchAudit {
  version: 1;
  scopeHash: string;
  truncated: boolean;
  pages: readonly AuditPage[];
}

/** Keeps only the identity evidence. BullMQ already bounds retained completed runs. */
export class WatchAuditCapture {
  private readonly pages: AuditPage[] = [];
  private readonly scopeHash: string;
  private entries = 0;
  private truncated = false;

  constructor(scopeUrl: string) {
    // Hash instead of persisting configuration URLs that might contain credentials.
    this.scopeHash = createHash('sha256').update(scopeUrl).digest('hex');
  }

  record(page: AuditPage): void {
    const entries = (page.sourceRows?.length ?? 0) + page.parsed.length;
    if (this.truncated || this.pages.length >= 250 || this.entries + entries > 30_000) {
      this.truncated = true;
      return;
    }
    this.pages.push(page);
    this.entries += entries;
  }

  finish(): WatchAudit {
    return { version: 1, scopeHash: this.scopeHash, truncated: this.truncated, pages: this.pages };
  }
}
