// Accès données bdc — avis d'achat (mirror portail) + réponse chiffrée de
// l'agent chargé. Token + interface + implémentation Drizzle (Postgres only).
import { and, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { bdcAvis, bdcReponses } from '../../db/schema';
import type { BdcArticle, BdcPiece } from './bdc.parser';
import {
  computeReponse,
  seedLignesFromArticles,
  type LigneReponse,
  type LigneReponseInput,
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
