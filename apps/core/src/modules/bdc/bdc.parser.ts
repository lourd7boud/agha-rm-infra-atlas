// Parsers du module /bdc du portail PMMP (bons de commande) — fonctions pures
// sur le HTML (server-rendered Bootstrap). Les positions accentuées utilisent
// `.` dans les regex: les fixtures/flux peuvent porter des octets latin-1 mal
// décodés (U+FFFD) sans casser l'ancrage structurel.

export interface BdcListeItem {
  portalId: number;
  reference: string;
  objet: string;
  acheteur: string;
  statut: 'en_cours' | 'annule' | 'cloture' | 'attribue';
  dateLimite: Date | null;
  lieu: string | null;
}

export interface BdcListe {
  total: number | null;
  items: BdcListeItem[];
}

export interface BdcArticle {
  numero: number;
  designation: string;
  caracteristiques: string;
  unite: string | null;
  quantite: number | null;
  tvaPct: number | null;
  garanties: string | null;
}

export interface BdcPiece {
  label: string;
  downloadPath: string;
}

export interface BdcDetail {
  reference: string | null;
  objet: string | null;
  acheteur: string | null;
  datePublication: Date | null;
  dateLimite: Date | null;
  lieu: string | null;
  categorie: string | null;
  naturePrestation: string | null;
  pieces: BdcPiece[];
  articles: BdcArticle[];
}

/** Groupe de capture sûr: '' si le groupe n'a pas matché (strict indexing). */
const grp = (m: RegExpExecArray | null, i: number): string => m?.[i] ?? '';

const clean = (value: string): string =>
  decodeEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function decodeEntities(value: string): string {
  return value
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** dd/mm/yyyy [hh:mm] → Date à l'heure marocaine (UTC+01). */
export function parseDateFr(date: string | null | undefined, time?: string | null): Date | null {
  if (!date) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(date.trim());
  if (!m) return null;
  const hh = m[4] ?? (time ? time.trim().slice(0, 2) : '00');
  const mm = m[5] ?? (time ? time.trim().slice(3, 5) : '00');
  const iso = `${m[3]}-${m[2]}-${m[1]}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00+01:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapBadge(label: string | null): BdcListeItem['statut'] {
  const norm = (label ?? '').toLowerCase();
  if (norm.startsWith('annul')) return 'annule';
  if (norm.startsWith('cl')) return 'cloture';
  if (norm.startsWith('attribu')) return 'attribue';
  return 'en_cours';
}

/** Liste des avis d'achat (/bdc/entreprise/consultation/?page=N). */
export function parseBdcListe(html: string): BdcListe {
  const totalMatch = /Nombre de r.sultats\s*:\s*(\d+)/.exec(html);
  const total = totalMatch ? Number(totalMatch[1]) : null;

  const items: BdcListeItem[] = [];
  const blocks = html.split(/entreprise__card/).slice(1);
  for (const block of blocks) {
    const idMatch = /consultation\/show\/(\d+)/.exec(block);
    if (!idMatch) continue;
    const portalId = Number(idMatch[1]);
    if (items.some((item) => item.portalId === portalId)) continue;

    const reference = /R.f.rence\s*:\s*([^<]+)</.exec(block);
    const badge = /badge bg-\w+"\s*>([^<]+)</.exec(block);
    const objet = /Objet\s*:\s*<\/span>\s*([^<]+)/.exec(block);
    const acheteur = /Acheteur\s*:\s*<\/span>\s*([^<]+)/.exec(block);
    const dateLimite = /fa-calendar"><\/i>\s*([\d/]+)/.exec(block);
    const heureLimite = /fa-clock"><\/i>\s*([\d:]+)/.exec(block);
    const lieu = /data-bs-title="([^"]+)"/.exec(block);

    items.push({
      portalId,
      reference: reference ? clean(grp(reference, 1)) : `#${portalId}`,
      objet: objet ? clean(grp(objet, 1)) : '',
      acheteur: acheteur ? clean(grp(acheteur, 1)) : '',
      statut: mapBadge(badge ? grp(badge, 1) : null),
      dateLimite: parseDateFr(dateLimite?.[1] ?? null, heureLimite?.[1] ?? null),
      lieu: lieu ? clean(grp(lieu, 1)) : null,
    });
  }
  return { total, items };
}

/** Valeur qui suit un libellé (`<span>Label</span> … valeur`), tolérante. */
function fieldAfter(html: string, labelPattern: string): string | null {
  const re = new RegExp(`${labelPattern}\\s*<\\/[a-z0-9]+>\\s*(?:<[^>]+>\\s*)*([^<]+)`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  const value = clean(grp(m, 1));
  if (!value || value === '-') return null;
  return value;
}

/** Détail d'un avis (/bdc/entreprise/consultation/show/{id}). */
export function parseBdcDetail(html: string): BdcDetail {
  const reference = /(?:^|>)\s*#\s*([^<\n]{1,80}?)\s*</.exec(html);

  const datePub = fieldAfter(html, 'Date mise en ligne');
  const dateLim = fieldAfter(html, 'Date limite de r.ception des devis');
  const pubParts = datePub ? datePub.split(/\s+/) : [];
  const limParts = dateLim ? dateLim.split(/\s+/) : [];

  const pieces: BdcPiece[] = [];
  const pieceRe = /href="(\/bdc\/entreprise\/consultation\/download\/[^"]+)"[^>]*>\s*([^<]+)/g;
  for (let m = pieceRe.exec(html); m; m = pieceRe.exec(html)) {
    pieces.push({ downloadPath: grp(m, 1), label: clean(grp(m, 2)) });
  }

  const articles: BdcArticle[] = [];
  const headingRe =
    /article-(\d+)-heading[\s\S]*?article-\1-panel[\s\S]*?accordion-body[\s\S]*?(?=article-\d+-heading|$)/g;
  for (let m = headingRe.exec(html); m; m = headingRe.exec(html)) {
    const block = m[0];
    const numero = Number(grp(m, 1));
    const specs = /text-black"\s*>([\s\S]*?)<\/span>/.exec(block);
    const caracteristiques = specs
      ? decodeEntities(grp(specs, 1))
          .replace(/<br\s*\/?\s*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .join('\n')
      : '';
    const designation = caracteristiques.split('\n')[0] ?? `Article ${numero}`;
    const unite = fieldAfter(block, 'Unit. de mesure');
    const quantiteRaw = fieldAfter(block, 'Quantit.');
    const tvaRaw = fieldAfter(block, 'TVA \\(%\\)');
    const quantite = quantiteRaw
      ? Number(quantiteRaw.replace(/\s/g, '').replace(',', '.'))
      : null;
    const tvaPct = tvaRaw ? Number(tvaRaw.replace(',', '.')) : null;
    articles.push({
      numero,
      designation,
      caracteristiques,
      unite,
      quantite: Number.isFinite(quantite as number) ? quantite : null,
      tvaPct: Number.isFinite(tvaPct as number) ? tvaPct : null,
      garanties: fieldAfter(block, 'Garanties exig.es'),
    });
  }

  return {
    reference: reference ? clean(grp(reference, 1)) : null,
    objet: fieldAfter(html, 'Objet'),
    acheteur: fieldAfter(html, 'Acheteur public'),
    datePublication: parseDateFr(pubParts[0] ?? null, pubParts[1] ?? null),
    dateLimite: parseDateFr(limParts[0] ?? null, limParts[1] ?? null),
    lieu: fieldAfter(html, "Lieu d.ex.cution"),
    categorie: fieldAfter(html, 'Cat.gorie principale'),
    naturePrestation: fieldAfter(html, 'Nature de prestation'),
    pieces,
    articles,
  };
}
