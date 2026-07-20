// Accès données bdc — avis d'achat (mirror portail) + réponse chiffrée de
// l'agent chargé. Token + interface + implémentation Drizzle (Postgres only).
import { and, desc, eq, gte, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  bdcAvis,
  bdcReponses,
  bdcResultats,
  bordereaux,
  invoiceLines,
  invoices,
  purchaseOrderLines,
  purchaseOrders,
  projects,
  quoteLines,
  quotes,
} from '../../db/schema';
import type { BdcArticle, BdcPiece, BdcResultatItem } from './bdc.parser';
import {
  computeReponse,
  seedLignesFromArticles,
  type LigneReponse,
  type LigneReponseInput,
  type PriceCandidate,
} from './bdc-pricing.domain';

export const BDC_REPOSITORY = Symbol('BDC_REPOSITORY');

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface AvisRecord {
  id: string;
  portalId: number;
  reference: string;
  objet: string;
  acheteur: string;
  statut: string;
  datePublication: Date | null;
  dateLimite: Date | null;
  lieu: string | null;
  categorie: string | null;
  naturePrestation: string | null;
  pieces: BdcPiece[];
  articles: BdcArticle[];
  detailFetchedAt: Date | null;
  firstSeenAt: Date;
  hasReponse: boolean;
  reponseStatut: string | null;
  reponseTotalTtc: number | null;
}

export interface ReponseRecord {
  id: string;
  avisId: string;
  statut: string;
  margePct: number;
  lignes: LigneReponse[];
  totalHt: number;
  totalTva: number;
  totalTtc: number;
  notes: string | null;
}

export interface AvisListParams {
  statut?: string;
  categorie?: string;
  search?: string;
  aVenirSeulement?: boolean;
  page: number;
  limit: number;
}

export interface AvisUpsert {
  portalId: number;
  reference: string;
  objet: string;
  acheteur: string;
  statut: string;
  datePublication: Date | null;
  dateLimite: Date | null;
  lieu: string | null;
}

export interface AvisDetailUpsert {
  categorie: string | null;
  naturePrestation: string | null;
  pieces: BdcPiece[];
  articles: BdcArticle[];
  datePublication: Date | null;
  dateLimite: Date | null;
}

export interface BdcStats {
  total: number;
  enCours: number;
  aVenir: number;
  avecReponse: number;
}

export interface InternalPriceEvidenceQuery {
  designation: string;
  category: 'travaux' | 'fournitures' | 'services';
  unit: string;
  region: string | null;
  excludeAvisId: string | null;
  limit: number;
}

export interface InternalPriceEvidenceRow {
  designation: string;
  unit: string;
  unitPriceHtMad: number;
  region: string | null;
  observedAt: Date;
  sourceType: 'bpu' | 'devis' | 'bdc' | 'fournisseur' | 'facture' | 'resultat';
  sourceRef: string;
  sourceUrl: string | null;
  verified: boolean;
  reliability: number;
  metadata: Record<string, unknown>;
}

export interface BdcRepository {
  upsertAvisFromListe(items: AvisUpsert[]): Promise<{ inserted: number; updated: number }>;
  saveAvisDetail(portalId: number, detail: AvisDetailUpsert): Promise<void>;
  listAvis(params: AvisListParams): Promise<{ items: AvisRecord[]; total: number }>;
  getAvis(id: string): Promise<AvisRecord | null>;
  stats(): Promise<BdcStats>;
  /** Avis dont le détail (articles) n'est pas encore récupéré. */
  avisSansDetail(limit: number): Promise<Array<{ id: string; portalId: number }>>;
  getReponse(avisId: string): Promise<ReponseRecord | null>;
  ensureReponse(avisId: string): Promise<ReponseRecord>;
  saveReponse(
    avisId: string,
    patch: { margePct?: number; lignes?: LigneReponseInput[]; statut?: string; notes?: string },
  ): Promise<ReponseRecord | null>;
  /** Prix connus de la société: BPU des marchés, devis clients, réponses BDC. */
  collectPriceCandidates(excludeAvisId?: string): Promise<PriceCandidate[]>;
  findInternalPriceEvidence(
    query: InternalPriceEvidenceQuery,
  ): Promise<InternalPriceEvidenceRow[]>;
  // ── Résultats (intelligence concurrents) ──
  upsertResultats(items: BdcResultatItem[]): Promise<number>;
  /** Pose avis_id + bascule le statut des avis matchés (référence+acheteur). */
  linkResultatsToAvis(): Promise<number>;
  listResultats(params: ResultatListParams): Promise<{ items: ResultatRecord[]; total: number }>;
  statsResultats(): Promise<ResultatStats>;
  intelligenceAcheteur(acheteur: string): Promise<IntelligenceAcheteur>;
}

export interface ResultatRecord {
  id: string;
  reference: string;
  objet: string;
  acheteur: string;
  dateResultat: Date | null;
  nbDevis: number | null;
  issue: string;
  attributaire: string | null;
  montantTtc: number | null;
  avisId: string | null;
}

export interface ResultatListParams {
  search?: string;
  acheteur?: string;
  issue?: string;
  page: number;
  limit: number;
}

export interface ResultatStats {
  total: number;
  attribues: number;
  infructueux: number;
  montantTotal: number;
  acheteurs: number;
  attributaires: number;
}

export interface IntelligenceAcheteur {
  acheteur: string;
  nbResultats: number;
  nbAttribues: number;
  nbInfructueux: number;
  devisMoyens: number | null;
  montantMedian: number | null;
  montantMin: number | null;
  montantMax: number | null;
  topAttributaires: Array<{ nom: string; victoires: number; montantTotal: number }>;
  derniers: ResultatRecord[];
}

function mapAvis(
  row: typeof bdcAvis.$inferSelect,
  reponse?: typeof bdcReponses.$inferSelect | null,
): AvisRecord {
  return {
    id: row.id,
    portalId: row.portalId,
    reference: row.reference,
    objet: row.objet,
    acheteur: row.acheteur,
    statut: row.statut,
    datePublication: row.datePublication,
    dateLimite: row.dateLimite,
    lieu: row.lieu,
    categorie: row.categorie,
    naturePrestation: row.naturePrestation,
    pieces: (row.pieces as BdcPiece[]) ?? [],
    articles: (row.articles as BdcArticle[]) ?? [],
    detailFetchedAt: row.detailFetchedAt,
    firstSeenAt: row.firstSeenAt,
    hasReponse: !!reponse,
    reponseStatut: reponse?.statut ?? null,
    reponseTotalTtc: reponse ? num(reponse.totalTtc) : null,
  };
}

function mapReponse(row: typeof bdcReponses.$inferSelect): ReponseRecord {
  return {
    id: row.id,
    avisId: row.avisId,
    statut: row.statut,
    margePct: num(row.margePct),
    lignes: (row.lignes as LigneReponse[]) ?? [],
    totalHt: num(row.totalHt),
    totalTva: num(row.totalTva),
    totalTtc: num(row.totalTtc),
    notes: row.notes,
  };
}

export class DrizzleBdcRepository implements BdcRepository {
  constructor(private readonly db: Db) {}

  async upsertAvisFromListe(items: AvisUpsert[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;
    for (const item of items) {
      const [row] = await this.db
        .insert(bdcAvis)
        .values({
          portalId: item.portalId,
          reference: item.reference,
          objet: item.objet,
          acheteur: item.acheteur,
          statut: item.statut,
          datePublication: item.datePublication ?? undefined,
          dateLimite: item.dateLimite ?? undefined,
          lieu: item.lieu,
        })
        .onConflictDoUpdate({
          target: bdcAvis.portalId,
          set: {
            statut: item.statut,
            dateLimite: item.dateLimite ?? sql`${bdcAvis.dateLimite}`,
            objet: item.objet,
            updatedAt: new Date(),
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (row?.inserted) inserted += 1;
      else updated += 1;
    }
    return { inserted, updated };
  }

  async saveAvisDetail(portalId: number, detail: AvisDetailUpsert): Promise<void> {
    await this.db
      .update(bdcAvis)
      .set({
        categorie: detail.categorie,
        naturePrestation: detail.naturePrestation,
        pieces: detail.pieces,
        articles: detail.articles,
        datePublication: detail.datePublication ?? sql`${bdcAvis.datePublication}`,
        dateLimite: detail.dateLimite ?? sql`${bdcAvis.dateLimite}`,
        detailFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bdcAvis.portalId, portalId));
  }

  async listAvis(params: AvisListParams): Promise<{ items: AvisRecord[]; total: number }> {
    const conds = [];
    if (params.statut) conds.push(eq(bdcAvis.statut, params.statut));
    if (params.categorie) conds.push(eq(bdcAvis.categorie, params.categorie));
    if (params.aVenirSeulement) {
      conds.push(or(isNull(bdcAvis.dateLimite), gte(bdcAvis.dateLimite, new Date())));
    }
    if (params.search) {
      const q = `%${params.search}%`;
      conds.push(
        or(ilike(bdcAvis.objet, q), ilike(bdcAvis.acheteur, q), ilike(bdcAvis.reference, q)),
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const [countRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(bdcAvis)
      .where(where);
    const total = num(countRow?.count);

    const rows = await this.db
      .select()
      .from(bdcAvis)
      .leftJoin(bdcReponses, eq(bdcReponses.avisId, bdcAvis.id))
      .where(where)
      .orderBy(desc(bdcAvis.datePublication), desc(bdcAvis.firstSeenAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);

    return { items: rows.map((r) => mapAvis(r.avis, r.reponse)), total };
  }

  async getAvis(id: string): Promise<AvisRecord | null> {
    const [row] = await this.db
      .select()
      .from(bdcAvis)
      .leftJoin(bdcReponses, eq(bdcReponses.avisId, bdcAvis.id))
      .where(eq(bdcAvis.id, id))
      .limit(1);
    return row ? mapAvis(row.avis, row.reponse) : null;
  }

  async stats(): Promise<BdcStats> {
    const [row] = await this.db
      .select({
        total: sql<string>`count(*)`,
        enCours: sql<string>`count(*) filter (where ${bdcAvis.statut} = 'en_cours')`,
        aVenir: sql<string>`count(*) filter (where ${bdcAvis.dateLimite} >= now())`,
        avecReponse: sql<string>`count(distinct ${bdcReponses.avisId})`,
      })
      .from(bdcAvis)
      .leftJoin(bdcReponses, eq(bdcReponses.avisId, bdcAvis.id));
    return {
      total: num(row?.total),
      enCours: num(row?.enCours),
      aVenir: num(row?.aVenir),
      avecReponse: num(row?.avecReponse),
    };
  }

  async avisSansDetail(limit: number): Promise<Array<{ id: string; portalId: number }>> {
    return this.db
      .select({ id: bdcAvis.id, portalId: bdcAvis.portalId })
      .from(bdcAvis)
      .where(isNull(bdcAvis.detailFetchedAt))
      .orderBy(desc(bdcAvis.firstSeenAt))
      .limit(limit);
  }

  async collectPriceCandidates(excludeAvisId?: string): Promise<PriceCandidate[]> {
    const candidates: PriceCandidate[] = [];
    const pushCandidate = (
      designation: unknown,
      unite: unknown,
      prixHt: number,
      sourceRef: string,
    ) => {
      if (typeof designation !== 'string' || designation.trim().length < 3) return;
      if (!(prixHt > 0)) return;
      candidates.push({
        designation: designation.slice(0, 400),
        unite: typeof unite === 'string' ? unite : null,
        prixHt,
        source: 'historique',
        sourceRef: sourceRef.slice(0, 200),
      });
    };

    // 1. BPU des marchés — les prix de vente réellement pratiqués au bordereau.
    const bpus = await this.db
      .select({ reference: projects.reference, lignes: bordereaux.lignes })
      .from(bordereaux)
      .innerJoin(projects, eq(projects.id, bordereaux.projectId));
    for (const bpu of bpus) {
      const lignes = Array.isArray(bpu.lignes) ? (bpu.lignes as Record<string, unknown>[]) : [];
      for (const ligne of lignes) {
        pushCandidate(
          ligne.designation,
          ligne.unite,
          num(ligne.prixUnitaire),
          `BPU ${bpu.reference}`,
        );
      }
    }

    // 2. Devis clients (module Ventes) — prix privés récents.
    const devisLignes = await this.db
      .select({
        designation: quoteLines.designation,
        unit: quoteLines.unit,
        prix: quoteLines.unitPriceMad,
        reference: quotes.reference,
      })
      .from(quoteLines)
      .innerJoin(quotes, eq(quotes.id, quoteLines.quoteId));
    for (const ligne of devisLignes) {
      pushCandidate(ligne.designation, ligne.unit, num(ligne.prix), `Devis ${ligne.reference}`);
    }

    // 3. Réponses BDC passées — l'agent apprend de ses propres chiffrages.
    const reponses = await this.db
      .select({ reference: bdcAvis.reference, lignes: bdcReponses.lignes })
      .from(bdcReponses)
      .innerJoin(bdcAvis, eq(bdcAvis.id, bdcReponses.avisId))
      .where(excludeAvisId ? ne(bdcReponses.avisId, excludeAvisId) : undefined);
    for (const reponse of reponses) {
      const lignes = Array.isArray(reponse.lignes)
        ? (reponse.lignes as Record<string, unknown>[])
        : [];
      for (const ligne of lignes) {
        pushCandidate(
          ligne.designation,
          ligne.unite,
          num(ligne.prixVenteHt ?? ligne.prixUnitaireHt),
          `BC ${reponse.reference}`,
        );
      }
    }

    return candidates;
  }

  // ── Résultats (intelligence concurrents) ──────────────────────────────────

  async findInternalPriceEvidence(
    query: InternalPriceEvidenceQuery,
  ): Promise<InternalPriceEvidenceRow[]> {
    const limit = Math.max(1, Math.min(200, query.limit));
    const token =
      query.designation
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/)
        .find((value) => value.length >= 4) ?? query.designation.slice(0, 40);
    const like = `%${token}%`;
    const rows: InternalPriceEvidenceRow[] = [];

    const bpuResult = await this.db.execute(sql<{
      designation: string;
      unit: string | null;
      price: string;
      reference: string | null;
      observed_at: Date;
    }>`
      select
        line->>'designation' as designation,
        line->>'unite' as unit,
        line->>'prixUnitaire' as price,
        coalesce(p.reference, b.reference, b.id::text) as reference,
        b.updated_at as observed_at
      from ${bordereaux} b
      inner join ${projects} p on p.id = b.project_id
      cross join lateral jsonb_array_elements(b.lignes) line
      where line->>'designation' ilike ${like}
        and coalesce(line->>'prixUnitaire', '') ~ '^[0-9]+([.][0-9]+)?$'
        and (line->>'prixUnitaire')::numeric > 0
      order by b.updated_at desc
      limit ${limit}
    `);
    for (const row of bpuResult.rows as Array<{
      designation: string;
      unit: string | null;
      price: string;
      reference: string | null;
      observed_at: Date;
    }>) {
      rows.push({
        designation: row.designation,
        unit: row.unit ?? query.unit,
        unitPriceHtMad: num(row.price),
        region: null,
        observedAt: row.observed_at,
        sourceType: 'bpu',
        sourceRef: `BPU ${row.reference ?? ''}`.trim(),
        sourceUrl: null,
        verified: true,
        reliability: 0.9,
        metadata: { category: 'travaux' },
      });
    }

    const quoteRows = await this.db
      .select({
        designation: quoteLines.designation,
        unit: quoteLines.unit,
        price: quoteLines.unitPriceMad,
        reference: quotes.reference,
        observedAt: quotes.quoteDate,
        status: quotes.status,
      })
      .from(quoteLines)
      .innerJoin(quotes, eq(quotes.id, quoteLines.quoteId))
      .where(
        and(
          ilike(quoteLines.designation, like),
          inArray(quotes.status, ['envoye', 'accepte']),
          gte(quoteLines.unitPriceMad, '0.01'),
        ),
      )
      .orderBy(desc(quotes.quoteDate))
      .limit(limit);
    for (const row of quoteRows) {
      rows.push({
        designation: row.designation,
        unit: row.unit ?? query.unit,
        unitPriceHtMad: num(row.price),
        region: null,
        observedAt: row.observedAt,
        sourceType: 'devis',
        sourceRef: `Devis ${row.reference}`,
        sourceUrl: null,
        verified: row.status === 'accepte',
        reliability: row.status === 'accepte' ? 0.85 : 0.7,
        metadata: { status: row.status },
      });
    }

    const invoiceRows = await this.db
      .select({
        designation: invoiceLines.designation,
        unit: invoiceLines.unit,
        price: invoiceLines.unitPriceMad,
        reference: invoices.reference,
        observedAt: invoices.invoiceDate,
        status: invoices.status,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          ilike(invoiceLines.designation, like),
          inArray(invoices.status, ['envoyee', 'payee']),
          gte(invoiceLines.unitPriceMad, '0.01'),
        ),
      )
      .orderBy(desc(invoices.invoiceDate))
      .limit(limit);
    for (const row of invoiceRows) {
      rows.push({
        designation: row.designation,
        unit: row.unit ?? query.unit,
        unitPriceHtMad: num(row.price),
        region: null,
        observedAt: row.observedAt,
        sourceType: 'facture',
        sourceRef: `Facture ${row.reference}`,
        sourceUrl: null,
        verified: true,
        reliability: row.status === 'payee' ? 1 : 0.95,
        metadata: { status: row.status },
      });
    }

    const supplierRows = await this.db
      .select({
        designation: purchaseOrderLines.designation,
        unit: purchaseOrderLines.unit,
        price: purchaseOrderLines.unitPriceMad,
        reference: purchaseOrders.reference,
        observedAt: purchaseOrders.orderedAt,
        status: purchaseOrders.status,
      })
      .from(purchaseOrderLines)
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId),
      )
      .where(
        and(
          ilike(purchaseOrderLines.designation, like),
          inArray(purchaseOrders.status, ['envoye', 'recu']),
          gte(purchaseOrderLines.unitPriceMad, '0.01'),
        ),
      )
      .orderBy(desc(purchaseOrders.orderedAt))
      .limit(limit);
    for (const row of supplierRows) {
      rows.push({
        designation: row.designation,
        unit: row.unit ?? query.unit,
        unitPriceHtMad: num(row.price),
        region: null,
        observedAt: row.observedAt,
        sourceType: 'fournisseur',
        sourceRef: `Commande fournisseur ${row.reference}`,
        sourceUrl: null,
        verified: row.status === 'recu',
        reliability: row.status === 'recu' ? 1 : 0.9,
        metadata: { status: row.status },
      });
    }

    const bdcResult = await this.db.execute(sql<{
      designation: string;
      unit: string | null;
      price: string;
      reference: string;
      region: string | null;
      observed_at: Date;
      status: string;
    }>`
      select
        coalesce(line->>'designation', '') as designation,
        line->>'unite' as unit,
        coalesce(line->>'prixVenteHt', line->>'prixUnitaireHt', '0') as price,
        a.reference,
        a.lieu as region,
        r.updated_at as observed_at,
        r.statut as status
      from ${bdcReponses} r
      inner join ${bdcAvis} a on a.id = r.avis_id
      cross join lateral jsonb_array_elements(r.lignes) line
      where r.statut in ('prete', 'deposee', 'gagnee')
        and coalesce(line->>'designation', '') ilike ${like}
        and coalesce(line->>'prixVenteHt', line->>'prixUnitaireHt', '') ~ '^[0-9]+([.][0-9]+)?$'
        and coalesce(line->>'prixVenteHt', line->>'prixUnitaireHt')::numeric > 0
        ${query.excludeAvisId ? sql`and r.avis_id <> ${query.excludeAvisId}` : sql``}
      order by r.updated_at desc
      limit ${limit}
    `);
    for (const row of bdcResult.rows as Array<{
      designation: string;
      unit: string | null;
      price: string;
      reference: string;
      region: string | null;
      observed_at: Date;
      status: string;
    }>) {
      rows.push({
        designation: row.designation,
        unit: row.unit ?? query.unit,
        unitPriceHtMad: num(row.price),
        region: row.region,
        observedAt: row.observed_at,
        sourceType: 'bdc',
        sourceRef: `BC ${row.reference}`,
        sourceUrl: null,
        verified: true,
        reliability: row.status === 'gagnee' ? 0.95 : 0.8,
        metadata: { status: row.status },
      });
    }

    const resultRows = await this.db
      .select({
        designation: bdcResultats.objet,
        priceTtc: bdcResultats.montantTtc,
        reference: bdcResultats.reference,
        observedAt: bdcResultats.dateResultat,
        nbDevis: bdcResultats.nbDevis,
      })
      .from(bdcResultats)
      .where(
        and(
          eq(bdcResultats.issue, 'attribue'),
          ilike(bdcResultats.objet, like),
          gte(bdcResultats.montantTtc, '0.01'),
        ),
      )
      .orderBy(desc(bdcResultats.dateResultat))
      .limit(limit);
    for (const row of resultRows) {
      if (!row.observedAt || row.priceTtc == null) continue;
      rows.push({
        designation: row.designation,
        unit: 'forfait',
        unitPriceHtMad: num(row.priceTtc) / 1.2,
        region: null,
        observedAt: row.observedAt,
        sourceType: 'resultat',
        sourceRef: `Résultat ${row.reference}`,
        sourceUrl: null,
        verified: true,
        reliability: 0.75,
        metadata: { taxBasis: 'TTC', tvaPct: 20, nbDevis: row.nbDevis },
      });
    }

    return rows
      .filter((row) => row.unitPriceHtMad > 0)
      .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())
      .slice(0, limit);
  }

  async upsertResultats(items: BdcResultatItem[]): Promise<number> {
    let inserted = 0;
    for (const item of items) {
      if (!item.reference || !item.acheteur) continue;
      const rows = await this.db
        .insert(bdcResultats)
        .values({
          reference: item.reference,
          objet: item.objet,
          acheteur: item.acheteur,
          dateResultat: item.dateResultat ?? undefined,
          nbDevis: item.nbDevis ?? undefined,
          issue: item.issue,
          attributaire: item.attributaire,
          montantTtc: item.montantTtc != null ? String(item.montantTtc) : undefined,
        })
        .onConflictDoNothing({
          target: [bdcResultats.reference, bdcResultats.acheteur, bdcResultats.dateResultat],
        })
        .returning({ id: bdcResultats.id });
      inserted += rows.length;
    }
    return inserted;
  }

  async linkResultatsToAvis(): Promise<number> {
    // Clé scopée acheteur (leçon lifecycle: les références se répètent).
    const linked = await this.db.execute(sql`
      with matched as (
        update bdc.resultat r
        set avis_id = a.id
        from bdc.avis a
        where r.avis_id is null
          and a.reference = r.reference
          and a.acheteur = r.acheteur
        returning r.avis_id, r.issue
      )
      update bdc.avis a
      set statut = case when m.issue = 'attribue' then 'attribue' else 'cloture' end,
          updated_at = now()
      from matched m
      where a.id = m.avis_id and a.statut in ('en_cours', 'cloture')
    `);
    return Number((linked as { rowCount?: number }).rowCount ?? 0);
  }

  async listResultats(
    params: ResultatListParams,
  ): Promise<{ items: ResultatRecord[]; total: number }> {
    const conds = [];
    if (params.issue) conds.push(eq(bdcResultats.issue, params.issue));
    if (params.acheteur) conds.push(ilike(bdcResultats.acheteur, params.acheteur));
    if (params.search) {
      const q = `%${params.search}%`;
      conds.push(
        or(
          ilike(bdcResultats.objet, q),
          ilike(bdcResultats.acheteur, q),
          ilike(bdcResultats.reference, q),
          ilike(bdcResultats.attributaire, q),
        ),
      );
    }
    const where = conds.length ? and(...conds) : undefined;
    const [countRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(bdcResultats)
      .where(where);
    const rows = await this.db
      .select()
      .from(bdcResultats)
      .where(where)
      .orderBy(desc(bdcResultats.dateResultat))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);
    return {
      items: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        objet: r.objet,
        acheteur: r.acheteur,
        dateResultat: r.dateResultat,
        nbDevis: r.nbDevis,
        issue: r.issue,
        attributaire: r.attributaire,
        montantTtc: r.montantTtc == null ? null : num(r.montantTtc),
        avisId: r.avisId,
      })),
      total: num(countRow?.count),
    };
  }

  async statsResultats(): Promise<ResultatStats> {
    const [row] = await this.db
      .select({
        total: sql<string>`count(*)`,
        attribues: sql<string>`count(*) filter (where ${bdcResultats.issue} = 'attribue')`,
        infructueux: sql<string>`count(*) filter (where ${bdcResultats.issue} = 'infructueux')`,
        montantTotal: sql<string>`coalesce(sum(${bdcResultats.montantTtc}), 0)`,
        acheteurs: sql<string>`count(distinct ${bdcResultats.acheteur})`,
        attributaires: sql<string>`count(distinct ${bdcResultats.attributaire})`,
      })
      .from(bdcResultats);
    return {
      total: num(row?.total),
      attribues: num(row?.attribues),
      infructueux: num(row?.infructueux),
      montantTotal: num(row?.montantTotal),
      acheteurs: num(row?.acheteurs),
      attributaires: num(row?.attributaires),
    };
  }

  async intelligenceAcheteur(acheteur: string): Promise<IntelligenceAcheteur> {
    const [agg] = await this.db
      .select({
        nbResultats: sql<string>`count(*)`,
        nbAttribues: sql<string>`count(*) filter (where ${bdcResultats.issue} = 'attribue')`,
        nbInfructueux: sql<string>`count(*) filter (where ${bdcResultats.issue} = 'infructueux')`,
        devisMoyens: sql<string>`round(avg(${bdcResultats.nbDevis}), 1)`,
        montantMedian: sql<string>`percentile_cont(0.5) within group (order by ${bdcResultats.montantTtc}) filter (where ${bdcResultats.montantTtc} is not null)`,
        montantMin: sql<string>`min(${bdcResultats.montantTtc})`,
        montantMax: sql<string>`max(${bdcResultats.montantTtc})`,
      })
      .from(bdcResultats)
      .where(eq(bdcResultats.acheteur, acheteur));

    const top = await this.db
      .select({
        nom: bdcResultats.attributaire,
        victoires: sql<string>`count(*)`,
        montantTotal: sql<string>`coalesce(sum(${bdcResultats.montantTtc}), 0)`,
      })
      .from(bdcResultats)
      .where(and(eq(bdcResultats.acheteur, acheteur), eq(bdcResultats.issue, 'attribue')))
      .groupBy(bdcResultats.attributaire)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const { items: derniers } = await this.listResultats({
      acheteur,
      page: 1,
      limit: 5,
    });

    return {
      acheteur,
      nbResultats: num(agg?.nbResultats),
      nbAttribues: num(agg?.nbAttribues),
      nbInfructueux: num(agg?.nbInfructueux),
      devisMoyens: agg?.devisMoyens == null ? null : num(agg.devisMoyens),
      montantMedian: agg?.montantMedian == null ? null : num(agg.montantMedian),
      montantMin: agg?.montantMin == null ? null : num(agg.montantMin),
      montantMax: agg?.montantMax == null ? null : num(agg.montantMax),
      topAttributaires: top
        .filter((t) => t.nom)
        .map((t) => ({
          nom: t.nom as string,
          victoires: num(t.victoires),
          montantTotal: num(t.montantTotal),
        })),
      derniers,
    };
  }

  async getReponse(avisId: string): Promise<ReponseRecord | null> {
    const [row] = await this.db
      .select()
      .from(bdcReponses)
      .where(eq(bdcReponses.avisId, avisId))
      .limit(1);
    return row ? mapReponse(row) : null;
  }

  async ensureReponse(avisId: string): Promise<ReponseRecord> {
    const existing = await this.getReponse(avisId);
    if (existing) return existing;
    const avis = await this.getAvis(avisId);
    if (!avis) throw new Error(`Avis introuvable: ${avisId}`);
    const seed = seedLignesFromArticles(avis.articles);
    const totaux = computeReponse(seed, 15);
    const [row] = await this.db
      .insert(bdcReponses)
      .values({
        avisId,
        statut: 'brouillon',
        margePct: '15',
        lignes: totaux.lignes,
        totalHt: String(totaux.totalHt),
        totalTva: String(totaux.totalTva),
        totalTtc: String(totaux.totalTtc),
      })
      .onConflictDoNothing({ target: bdcReponses.avisId })
      .returning();
    if (row) return mapReponse(row);
    const created = await this.getReponse(avisId);
    if (!created) throw new Error('Création réponse échouée');
    return created;
  }

  async saveReponse(
    avisId: string,
    patch: { margePct?: number; lignes?: LigneReponseInput[]; statut?: string; notes?: string },
  ): Promise<ReponseRecord | null> {
    const current = await this.ensureReponse(avisId);
    const margePct = patch.margePct ?? current.margePct;
    const lignesInput = (patch.lignes ?? current.lignes) as LigneReponseInput[];
    const totaux = computeReponse(lignesInput, margePct);
    const [row] = await this.db
      .update(bdcReponses)
      .set({
        margePct: String(margePct),
        lignes: totaux.lignes,
        totalHt: String(totaux.totalHt),
        totalTva: String(totaux.totalTva),
        totalTtc: String(totaux.totalTtc),
        statut: patch.statut ?? current.statut,
        notes: patch.notes !== undefined ? patch.notes : current.notes,
        updatedAt: new Date(),
      })
      .where(eq(bdcReponses.avisId, avisId))
      .returning();
    return row ? mapReponse(row) : null;
  }
}

/** Proxy fail-fast quand DATABASE_URL manque. */
export function unavailableBdcRepository<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      return () => {
        throw new Error(`${name} indisponible: DATABASE_URL non configurée`);
      };
    },
  });
}
