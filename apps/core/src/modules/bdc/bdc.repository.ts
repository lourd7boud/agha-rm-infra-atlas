// Accès données bdc — avis d'achat (mirror portail) + réponse chiffrée de
// l'agent chargé. Token + interface + implémentation Drizzle (Postgres only).
import { and, desc, eq, gte, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  bdcAvis,
  bdcReponses,
  bdcResultats,
  bordereaux,
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
