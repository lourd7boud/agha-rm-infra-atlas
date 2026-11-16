export interface IndexBulletinSource {
  url: string;
  label: string;
}

export interface IndexImportEvidence {
  code: string;
  value: number;
  page: number;
  line: string;
}

export interface IndexImportDraft {
  id: string;
  sourceUrl: string;
  filename: string;
  sha256: string;
  observedAt: string;
  documentDate: string | null;
  reference: string | null;
  status: 'extracting' | 'review' | 'failed' | 'applied';
  automatic?: boolean;
  issues: string[];
  months: {
    month: string;
    status: 'provisoire' | 'definitif' | null;
    values: Record<string, number>;
    evidence: IndexImportEvidence[];
  }[];
  ocrPages?: { num: number; text: string }[];
  failure?: string | null;
  appliedAt?: string | null;
  retryAvailable?: boolean;
  publicationEvidence?: string | null;
}

export interface IndexImportPayload {
  reference: string;
  publishedOn: string;
  publicationEvidence: string;
  months: { month: string; status: 'provisoire' | 'definitif'; indexValues: Record<string, number> }[];
}

export type IndexImportResult<T> = { value: T; error?: never } | { error: string; value?: never };

export interface IndexImportReceipt {
  id: string;
  status: 'applied';
  appliedAt: string;
  months: string[];
}
