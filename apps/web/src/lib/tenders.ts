import type { PipelineState, TenderProcedure } from '@atlas/contracts';

/** Legal trichotomy of Moroccan public procurement. */
export type TenderCategory = 'Travaux' | 'Fournitures' | 'Services';

/**
 * One row of the datao-style catalogue — the enriched shape served by
 * GET /tender/inventory. Dates arrive as ISO strings over HTTP; money as
 * numbers (MAD).
 */
export interface TenderItem {
  id: string;
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  procedureLabel: string;
  objet: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: string;
  publishedAt: string;
  pipelineState: PipelineState;
  daysLeft: number;
  region: string;
  ville: string | null;
  category: TenderCategory;
  secteur: string;
  lotCount: number;
  sourceUrl?: string;
  // AI enrichment (fast model) — present once the tender has been enriched.
  aiResume?: string;
  faq?: Array<{ question: string; reponse: string }>;
  lotsDetail?: Array<{ designation: string; description?: string | null }>;
  conditions?: {
    cautionDefinitivePct?: number | null;
    retenueGarantiePct?: number | null;
    delaiGarantieMois?: number | null;
  };
  reserveAuxPme?: boolean;
  enrichedAt?: string;
}

export interface TenderFacet {
  key: string;
  label: string;
  count: number;
}

export interface TenderFacets {
  procedures: TenderFacet[];
  categories: TenderFacet[];
  secteurs: TenderFacet[];
  regions: TenderFacet[];
  buyers: TenderFacet[];
  states: TenderFacet[];
}

export interface TenderInventory {
  total: number;
  filteredCount: number;
  returnedCount: number;
  facets: TenderFacets;
  items: TenderItem[];
}

/** Category chip tones — mirrors the procedure/state palette in labels.ts. */
export const CATEGORY_TONES: Record<TenderCategory, string> = {
  Travaux: 'bg-ochre-soft text-ochre-deep',
  Fournitures: 'bg-teal-soft text-teal',
  Services: 'bg-emerald-soft text-emerald',
};

const DATE_SHORT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};
const DATE_LONG: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

export function fmtDateShort(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-MA', DATE_SHORT);
}

export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-MA', DATE_LONG)} à ${d.toLocaleTimeString(
    'fr-MA',
    TIME_OPTS,
  )}`;
}

/** Returns the URL only when it is a safe http(s) link, else undefined. */
export function safeHttpUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * Concise auto-summary assembled from structured fields — deterministic, no
 * LLM. The richer AI résumé (datao-style) lands in Phase C once the dossier is
 * downloaded and summarised.
 */
export function buildResume(item: TenderItem): string {
  const place = item.ville ? `${item.ville} (${item.region})` : item.region;
  return [
    `Marché de ${item.category.toLowerCase()} lancé par ${item.buyerName} — ${place}.`,
    `Objet : ${item.objet}.`,
    `Procédure : ${item.procedureLabel}.`,
  ].join(' ');
}
