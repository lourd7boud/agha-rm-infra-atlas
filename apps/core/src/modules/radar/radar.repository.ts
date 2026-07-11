// Accès données Radar — score le catalogue des marchés EN COURS et persiste
// l'avis de la société (radar.candidate). Le scoring branche l'intelligence
// concurrents (bdc.resultat, Niveau 3) par acheteur: le radar sait non
// seulement « est-ce mon métier » mais « ai-je des chances chez cet acheteur ».
import { and, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { bdcResultats, radarCandidates, tenders } from '../../db/schema';
import {
  AGHA_RADAR_PROFILE,
  scoreTender,
  type RadarProfile,
  type RadarScore,
} from './radar-scoring.domain';

export const RADAR_REPOSITORY = Symbol('RADAR_REPOSITORY');

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface RadarCandidateRecord {
  id: string;
  tenderId: string;
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
  statut: string;
  scoredAt: Date;
  // Champs marché joints pour l'affichage.
  reference: string;
  objet: string;
  buyerName: string;
  category: string | null;
  region: string | null;
  ville: string | null;
  location: string | null;
  deadlineAt: Date;
  estimationMad: number | null;
  sourceUrl: string | null;
}

export interface RadarStats {
  total: number;
  nouveaux: number;
  poursuivis: number;
  ecartes: number;
  scoreMoyen: number;
  scoreMax: number;
}

export interface RadarScanSummary {
  evalues: number;
  inseres: number;
  maj: number;
  acheteursAvecIntel: number;
  scoreMax: number;
  scoreMoyen: number;
}

export interface RadarListParams {
  statut?: string;
  minScore?: number;
  search?: string;
  page: number;
  limit: number;
}

export interface RadarRepository {
  /** Score les marchés en cours (deadline future, sans résultat) et upsert. */
  scanCatalogue(now: Date, limit: number, profile?: RadarProfile): Promise<RadarScanSummary>;
  listCandidates(
    params: RadarListParams,
  ): Promise<{ items: RadarCandidateRecord[]; total: number }>;
  stats(): Promise<RadarStats>;
  setStatut(tenderId: string, statut: string): Promise<boolean>;
  /** Top opportunités fraîches pour le brief quotidien. */
  topForDigest(limit: number, minScore: number): Promise<RadarCandidateRecord[]>;
}

interface BuyerIntel {
  nbDevisMoyen: number | null;
  tauxInfructueux: number | null;
}

function mapRow(row: {
  candidate: typeof radarCandidates.$inferSelect;
  tender: typeof tenders.$inferSelect;
}): RadarCandidateRecord {
  const c = row.candidate;
  const t = row.tender;
  return {
    id: c.id,
    tenderId: c.tenderId,
    score: c.score,
    breakdown: (c.breakdown as Record<string, number>) ?? {},
    reasons: Array.isArray(c.reasons) ? (c.reasons as string[]) : [],
    statut: c.statut,
    scoredAt: c.scoredAt,
    reference: t.reference,
    objet: t.objet,
    buyerName: t.buyerName,
    category: t.category,
    region: t.region,
    ville: t.ville,
    location: t.location,
    deadlineAt: t.deadlineAt,
    estimationMad: t.estimationMad == null ? null : num(t.estimationMad),
    sourceUrl: t.sourceUrl,
  };
}

export class DrizzleRadarRepository implements RadarRepository {
  constructor(private readonly db: Db) {}

  /** Carte acheteur → concurrence observée (bdc.resultat, Niveau 3). */
  private async buildBuyerIntel(): Promise<Map<string, BuyerIntel>> {
    const rows = await this.db
      .select({
        acheteur: bdcResultats.acheteur,
        nbDevisMoyen: sql<string>`avg(${bdcResultats.nbDevis})`,
        tauxInfructueux: sql<string>`avg(case when ${bdcResultats.issue} = 'infructueux' then 1.0 else 0.0 end)`,
      })
      .from(bdcResultats)
      .groupBy(bdcResultats.acheteur);
    const map = new Map<string, BuyerIntel>();
    for (const r of rows) {
      map.set(r.acheteur.trim().toLowerCase(), {
        nbDevisMoyen: r.nbDevisMoyen == null ? null : num(r.nbDevisMoyen),
        tauxInfructueux: r.tauxInfructueux == null ? null : num(r.tauxInfructueux),
      });
    }
    return map;
  }

  async scanCatalogue(
    now: Date,
    limit: number,
    profile: RadarProfile = AGHA_RADAR_PROFILE,
  ): Promise<RadarScanSummary> {
    const intel = await this.buildBuyerIntel();

    // Marchés EN COURS: échéance future, pas encore de résultat publié. Les plus
    // récents d'abord (le radar priorise les nouvelles opportunités).
    const rows = await this.db
      .select({
        id: tenders.id,
        category: tenders.category,
        region: tenders.region,
        ville: tenders.ville,
        location: tenders.location,
        deadlineAt: tenders.deadlineAt,
        estimationMad: tenders.estimationMad,
        buyerName: tenders.buyerName,
        createdAt: tenders.createdAt,
      })
      .from(tenders)
      .where(and(gt(tenders.deadlineAt, now), isNull(tenders.resultState)))
      .orderBy(desc(tenders.createdAt))
      .limit(limit);

    let inseres = 0;
    let maj = 0;
    let scoreMaxGlobal = 0;
    let sommeScores = 0;
    const acheteursTouches = new Set<string>();

    for (const t of rows) {
      const buyerKey = t.buyerName.trim().toLowerCase();
      const buyerIntel = intel.get(buyerKey) ?? null;
      if (buyerIntel) acheteursTouches.add(buyerKey);
      const result: RadarScore = scoreTender(
        profile,
        {
          category: t.category,
          region: t.region,
          ville: t.ville,
          location: t.location,
          deadlineAt: t.deadlineAt,
          estimationMad: t.estimationMad == null ? null : num(t.estimationMad),
          createdAt: t.createdAt,
          buyerIntel,
        },
        now,
      );
      sommeScores += result.score;
      if (result.score > scoreMaxGlobal) scoreMaxGlobal = result.score;

      // Upsert: on ne réécrit JAMAIS le statut choisi par l'opérateur
      // (vu/poursuivi/ecarte) — seul le score/ventilation est rafraîchi.
      const [row] = await this.db
        .insert(radarCandidates)
        .values({
          tenderId: t.id,
          score: result.score,
          breakdown: result.breakdown,
          reasons: result.reasons,
          scoredAt: now,
        })
        .onConflictDoUpdate({
          target: radarCandidates.tenderId,
          set: {
            score: result.score,
            breakdown: result.breakdown,
            reasons: result.reasons,
            scoredAt: now,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (row?.inserted) inseres += 1;
      else maj += 1;
    }

    return {
      evalues: rows.length,
      inseres,
      maj,
      acheteursAvecIntel: acheteursTouches.size,
      scoreMax: scoreMaxGlobal,
      scoreMoyen: rows.length ? Math.round(sommeScores / rows.length) : 0,
    };
  }

  async listCandidates(
    params: RadarListParams,
  ): Promise<{ items: RadarCandidateRecord[]; total: number }> {
    const conds = [gt(tenders.deadlineAt, new Date())];
    if (params.statut) conds.push(eq(radarCandidates.statut, params.statut));
    if (params.minScore != null) {
      conds.push(sql`${radarCandidates.score} >= ${params.minScore}`);
    }
    if (params.search) {
      const q = `%${params.search}%`;
      conds.push(
        or(ilike(tenders.objet, q), ilike(tenders.buyerName, q), ilike(tenders.reference, q))!,
      );
    }
    const where = and(...conds);

    const [countRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(radarCandidates)
      .innerJoin(tenders, eq(tenders.id, radarCandidates.tenderId))
      .where(where);

    const rows = await this.db
      .select({ candidate: radarCandidates, tender: tenders })
      .from(radarCandidates)
      .innerJoin(tenders, eq(tenders.id, radarCandidates.tenderId))
      .where(where)
      .orderBy(desc(radarCandidates.score), tenders.deadlineAt)
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);

    return { items: rows.map(mapRow), total: num(countRow?.count) };
  }

  async stats(): Promise<RadarStats> {
    const [row] = await this.db
      .select({
        total: sql<string>`count(*)`,
        nouveaux: sql<string>`count(*) filter (where ${radarCandidates.statut} = 'nouveau')`,
        poursuivis: sql<string>`count(*) filter (where ${radarCandidates.statut} = 'poursuivi')`,
        ecartes: sql<string>`count(*) filter (where ${radarCandidates.statut} = 'ecarte')`,
        scoreMoyen: sql<string>`coalesce(round(avg(${radarCandidates.score})), 0)`,
        scoreMax: sql<string>`coalesce(max(${radarCandidates.score}), 0)`,
      })
      .from(radarCandidates)
      .innerJoin(tenders, eq(tenders.id, radarCandidates.tenderId))
      .where(gt(tenders.deadlineAt, new Date()));
    return {
      total: num(row?.total),
      nouveaux: num(row?.nouveaux),
      poursuivis: num(row?.poursuivis),
      ecartes: num(row?.ecartes),
      scoreMoyen: num(row?.scoreMoyen),
      scoreMax: num(row?.scoreMax),
    };
  }

  async setStatut(tenderId: string, statut: string): Promise<boolean> {
    const rows = await this.db
      .update(radarCandidates)
      .set({ statut })
      .where(eq(radarCandidates.tenderId, tenderId))
      .returning({ id: radarCandidates.id });
    return rows.length > 0;
  }

  async topForDigest(limit: number, minScore: number): Promise<RadarCandidateRecord[]> {
    const rows = await this.db
      .select({ candidate: radarCandidates, tender: tenders })
      .from(radarCandidates)
      .innerJoin(tenders, eq(tenders.id, radarCandidates.tenderId))
      .where(
        and(
          gt(tenders.deadlineAt, new Date()),
          eq(radarCandidates.statut, 'nouveau'),
          sql`${radarCandidates.score} >= ${minScore}`,
        ),
      )
      .orderBy(desc(radarCandidates.score), tenders.deadlineAt)
      .limit(limit);
    return rows.map(mapRow);
  }
}

/** Proxy fail-fast quand DATABASE_URL manque. */
export function unavailableRadarRepository<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      return () => {
        throw new Error(`${name} indisponible: DATABASE_URL non configurée`);
      };
    },
  });
}
