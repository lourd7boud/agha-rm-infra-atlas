import type { Queue } from "bullmq";
import { describe, expect, test, vi } from "vitest";
import type { BdcRepository, ReponseRecord } from "../bdc.repository";
import type { LigneReponse } from "../bdc-pricing.domain";
import type { PriceEvidenceAdapter } from "./bdc-evidence.types";
import { BdcLineAnalyzer } from "./bdc-line-analyzer";
import { InMemoryBdcPricingRepository } from "./bdc-pricing.repository";
import { BdcPricingService } from "./bdc-pricing.service";
import type { PriceObservation, PricingCategory } from "./bdc-pricing.types";
import works from "./fixtures/works-09-2026.json";
import supplies from "./fixtures/supplies-sample.json";
import services from "./fixtures/services-sample.json";

interface Fixture {
  id: string;
  reference: string;
  objet: string;
  categorie: string;
  naturePrestation: string;
  lieu: string;
  manualPrices: Record<string, number>;
  articles: Array<{
    numero: number;
    designation: string;
    caracteristiques: string;
    unite: string | null;
    quantite: number;
    tvaPct: number;
    garanties: string | null;
  }>;
  evidence: Array<{ idx: number; price: number; unit: string }>;
}

describe.each([
  ["travaux", works as Fixture, "travaux"],
  ["fournitures", supplies as Fixture, "fournitures"],
  ["services", services as Fixture, "services"],
] as const)("autonomous %s fixture", (_label, fixture, expectedCategory) => {
  test("prices every zero line, preserves manual input and applies a draft", async () => {
    const { service, response, analyzer } = setup(fixture);
    const normalized = await analyzer.analyzeLines({
      articles: fixture.articles,
      bdcCategory: fixture.categorie,
      nature: fixture.naturePrestation,
      location: fixture.lieu,
    });
    expect(normalized.map((line) => line.category)).toEqual(
      fixture.articles.map(() => expectedCategory),
    );

    const queued = await service.createRun(fixture.id, {
      idempotencyKey: `fixture-${fixture.id}`,
      requestedMarkupPct: 15,
      actorId: "fixture-user",
    });
    const completed = await service.run(queued.id);
    expect(completed.status).toBe("completed");
    expect(completed.decisions).toHaveLength(fixture.articles.length);
    expect(completed.evidence.length).toBeGreaterThan(0);
    expect(completed.decisions.map((decision) => ({
      idx: decision.idx,
      cost: decision.estimatedCostHt,
      price: decision.proposedUnitPriceHt,
      markup: decision.markupPct,
      sources: decision.sourceIds.length,
    }))).toHaveLength(fixture.articles.length);
    expect(
      completed.decisions
        .filter((decision) => fixture.manualPrices[String(decision.idx)] === undefined)
        .filter(
          (decision) =>
            decision.proposedUnitPriceHt <= 0 || decision.markupPct < 15,
        )
        .map((decision) => ({
          idx: decision.idx,
          cost: decision.estimatedCostHt,
          price: decision.proposedUnitPriceHt,
          markup: decision.markupPct,
          warnings: decision.warnings,
        })),
    ).toEqual([]);

    for (const decision of completed.decisions) {
      const manual = fixture.manualPrices[String(decision.idx)];
      if (manual !== undefined) {
        expect(decision.manualPriceLocked).toBe(true);
        expect(decision.proposedUnitPriceHt).toBe(manual);
      } else {
        expect(decision.explanation.length).toBeGreaterThan(10);
        expect(decision.sourceIds.length).toBeGreaterThan(0);
      }
    }

    const applied = await service.applyRun(queued.id);
    expect(applied.statut).toBe("brouillon");
    for (const [idx, price] of Object.entries(fixture.manualPrices)) {
      expect(response().lignes[Number(idx)]?.prixUnitaireHt).toBe(price);
      expect(response().lignes[Number(idx)]?.source).toBe("manuel");
    }
    expect(response().lignes.every((line) => line.prixUnitaireHt > 0)).toBe(true);
  });
});

function setup(fixture: Fixture) {
  const analyzer = new BdcLineAnalyzer(null);
  let current = makeResponse(fixture);
  const repository = {
    getAvis: async () => ({
      id: fixture.id,
      reference: fixture.reference,
      objet: fixture.objet,
      acheteur: "Fixture public buyer",
      statut: "en_cours",
      datePublication: null,
      dateLimite: null,
      lieu: fixture.lieu,
      categorie: fixture.categorie,
      naturePrestation: fixture.naturePrestation,
      pieces: [],
      articles: fixture.articles,
      detailFetchedAt: new Date(),
      firstSeenAt: new Date(),
      hasReponse: true,
      reponseStatut: "brouillon",
      reponseTotalTtc: 0,
    }),
    ensureReponse: async () => structuredClone(current),
    saveReponse: async (_id: string, patch: { lignes?: LigneReponse[]; statut?: string }) => {
      current = {
        ...current,
        ...(patch.statut ? { statut: patch.statut } : {}),
        ...(patch.lignes ? { lignes: structuredClone(patch.lignes) } : {}),
      };
      return structuredClone(current);
    },
  } as unknown as BdcRepository;
  const evidence: PriceEvidenceAdapter = {
    search: async ({ line }) => {
      const source = fixture.evidence.find((item) => item.idx === line.idx);
      return source ? [makeObservation(line.category, line.designation, source)] : [];
    },
  };
  const pricingRepository = new InMemoryBdcPricingRepository();
  const queue = { add: vi.fn(async () => ({ id: "fixture-job" })) } as unknown as Queue;
  const service = new BdcPricingService(
    repository,
    pricingRepository,
    analyzer,
    evidence,
    { search: async () => [] },
    queue,
    {
      now: new Date("2026-07-20T12:00:00.000Z"),
      defaultTvaPct: 20,
      annualInflationPct: 0,
      regionMultipliers: {},
      maxAgeDays: 1_095,
    },
  );
  return { service, analyzer, response: () => current };
}

function makeResponse(fixture: Fixture): ReponseRecord {
  return {
    id: `response-${fixture.id}`,
    avisId: fixture.id,
    statut: "brouillon",
    margePct: 15,
    lignes: fixture.articles.map((article, idx) => {
      const price = fixture.manualPrices[String(idx)] ?? 0;
      return {
        idx,
        designation: article.designation,
        unite: article.unite,
        quantite: article.quantite,
        tvaPct: article.tvaPct,
        prixUnitaireHt: price,
        prixVenteHt: price,
        montantHt: price * article.quantite,
        montantTva: price * article.quantite * (article.tvaPct / 100),
        montantTtc: price * article.quantite * (1 + article.tvaPct / 100),
        source: "manuel",
        sourceRef: null,
        margeAppliquee: false,
        note: null,
      };
    }),
    totalHt: 0,
    totalTva: 0,
    totalTtc: 0,
    notes: null,
  };
}

function makeObservation(
  category: PricingCategory,
  designation: string,
  source: { idx: number; price: number; unit: string },
): PriceObservation {
  return {
    designation,
    category,
    unit: source.unit,
    unitPriceHtMad: source.price,
    region: null,
    observedAt: "2026-07-19T00:00:00.000Z",
    sourceType: "facture",
    sourceRef: `FIXTURE-FAC-${source.idx}`,
    sourceUrl: null,
    snapshotHash: `fixture-${category}-${source.idx}`,
    verified: true,
    reliability: 1,
    metadata: {},
  };
}
