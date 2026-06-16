/**
 * Stage-2 acquisition — the consultation detail page (Atexo MPE).
 *
 * The listing only yields stubs. Each consultation has a GET-accessible detail
 * page whose URL we can build from the (refConsultation, orgAcronyme) pair found
 * in the listing HTML. The detail page publishes the caution provisoire, the
 * required qualifications, the objet and the category — the estimation is
 * `display:none` on open tenders (confidential until results), so it is usually
 * absent here. We match each detail back to a stored tender by `reference`,
 * avoiding fragile row-by-row table parsing.
 */

const SUMMARY = 'idEntrepriseConsultationSummary';

export interface DetailLink {
  refConsultation: string;
  orgAcronyme: string;
  detailUrl: string;
}

export interface DetailFields {
  reference: string | null;
  objet: string | null;
  categorie: string | null;
  cautionProvisoireMad: number | null;
  estimationMad: number | null;
}

/** "7 000,00 MAD" / "1 250 000,50 Dhs" → number (MAD), or null. */
export function parseMoneyMad(text: string | null | undefined): number | null {
  if (!text) return null;
  // Drop currency words and any non [digit , . space] noise, keep separators.
  const cleaned = text
    .replace(/ /g, ' ')
    .replace(/mad|dhs?|dirhams?|ttc|ht/gi, '')
    .trim();
  const m = /\d[\d .]*(?:,\d+)?/.exec(cleaned);
  if (!m) return null;
  // French format: space = thousands separator, comma = decimal.
  const normalized = m[0].replace(/[ ]/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * All distinct consultations referenced by the listing HTML, as buildable GET
 * detail URLs. Robust against the listing's table markup: it scans the whole
 * page for the detail-link query, not individual rows.
 */
export function extractDetailLinks(html: string, baseUrl: string): DetailLink[] {
  const origin = safeOrigin(baseUrl);
  const re =
    /EntrepriseDetailsConsultation&(?:amp;)?refConsultation=(\d+)&(?:amp;)?orgAcronyme=([A-Za-z0-9_]+)/g;
  const seen = new Set<string>();
  const links: DetailLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const refConsultation = match[1] as string;
    const orgAcronyme = match[2] as string;
    const key = `${refConsultation}:${orgAcronyme}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      refConsultation,
      orgAcronyme,
      detailUrl: `${origin}/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=${refConsultation}&orgAcronyme=${orgAcronyme}`,
    });
  }
  return links;
}

function safeOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'https://www.marchespublics.gov.ma';
  }
}

/** Text content of the labelled summary span `<... id="...SUMMARY_<field>">VALUE<`. */
function fieldText(html: string, field: string): string | null {
  const re = new RegExp(`id="[^"]*${SUMMARY}_${field}"[^>]*>([^<]{0,300})`, 'i');
  const value = re.exec(html)?.[1];
  if (value === undefined) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Extract the publishable fields from a consultation detail page. */
export function parseDetailPage(html: string): DetailFields {
  return {
    reference: fieldText(html, 'reference'),
    objet: fieldText(html, 'objet'),
    categorie: fieldText(html, 'categoriePrincipale'),
    cautionProvisoireMad: parseMoneyMad(fieldText(html, 'cautionProvisoire')),
    // Hidden (display:none) on open tenders → usually null; parsed when present.
    estimationMad: parseMoneyMad(fieldText(html, 'estimation')),
  };
}
