import { afterEach, describe, expect, test, vi } from "vitest";
import type { Queue } from "bullmq";
import type { BdcRepository } from "../bdc.repository";
import { BdcAiEstimator } from "./bdc-ai-estimator";
import type { PriceEvidenceAdapter } from "./bdc-evidence.types";
import { BdcLineAnalyzer } from "./bdc-line-analyzer";
import {
  InMemoryBdcPricingRepository,
  type PricingRunPatch,
} from "./bdc-pricing.repository";
import { BdcPricingService } from "./bdc-pricing.service";
import type {
  NormalizedLine,
  PriceObservation,
  PricingStage,
} from "./bdc-pricing.types";

afterEach(() => vi.unstubAllEnvs());

function observation(designation: string, price: number): PriceObservation {
  return {
    designation,
    category: "fournitures",
    unit: "u",
    unitPriceHtMad: price,
    region: "Agadir",
    observedAt: "2026-07-20T00:00:00.000Z",
    sourceType: "facture",
    sourceRef: `FAC-${price}`,
    sourceUrl: null,
    snapshotHash: `hash-${price}`,
    verified: true,
    reliability: 1,
    metadata: {},
  };
}

function setup(options: {
  internal?: PriceEvidenceAdapter;
  web?: PriceEvidenceAdapter;
  analyzer?: BdcLineAnalyzer;
  aiEstimator?: BdcAiEstimator;
} = {}) {
  const articles = [
    {
      numero: 1,
      designation: "Peinture blanche 20 kg",
      caracteristiques: "",
      unite: "U",
      quantite: 1,
      tvaPct: 20,
      garanties: null,
    },
    {
      numero: 2,
      designation: "Toner imprimante",
      caracteristiques: "",
      unite: "U",
      quantite: 2,
      tvaPct: 20,
      garanties: null,
    },
  ];
  let savedPatch: unknown;
  const bdcRepository = {
    getAvis: async () => ({
      id: "avis-1",
      reference: "09/2026",
      objet: "Fournitures",
      acheteur: "Acheteur",
      statut: "en_cours",
      datePublication: null,
      dateLimite: null,
      lieu: "Agadir",
      categorie: "Fournitures",
      naturePrestation: "Fournitures",
      pieces: [],
      articles,
      detailFetchedAt: new Date(),
      firstSeenAt: new Date(),
      hasReponse: true,
      reponseStatut: "brouillon",
      reponseTotalTtc: 0,
    }),
    ensureReponse: async () => ({
      id: "response-1",
      avisId: "avis-1",
      statut: "brouillon",
      margePct: 15,
      lignes: [
        {
          idx: 0,
          designation: articles[0]!.designation,
          unite: "U",
          quantite: 1,
          tvaPct: 20,
          prixUnitaireHt: 88,
          prixVenteHt: 88,
          montantHt: 88,
          montantTva: 17.6,
          montantTtc: 105.6,
          source: "manuel",
          margeAppliquee: false,
          sourceRef: null,
          note: null,
        },
        {
          idx: 1,
          designation: articles[1]!.designation,
          unite: "U",
          quantite: 2,
          tvaPct: 20,
          prixUnitaireHt: 0,
          prixVenteHt: 0,
          montantHt: 0,
          montantTva: 0,
          montantTtc: 0,
          source: "manuel",
          margeAppliquee: false,
          sourceRef: null,
          note: null,
        },
      ],
      totalHt: 88,
      totalTva: 17.6,
      totalTtc: 105.6,
      notes: null,
    }),
    saveReponse: async (_id: string, patch: unknown) => {
      savedPatch = patch;
      return { ok: true };
    },
  } as unknown as BdcRepository;
  const pricingRepository = new InMemoryBdcPricingRepository();
  const stages: PricingStage[] = [];
  const originalUpdate = pricingRepository.updateRun.bind(pricingRepository);
  pricingRepository.updateRun = async (id: string, patch: PricingRunPatch) => {
    if (patch.stage) stages.push(patch.stage);
    return originalUpdate(id, patch);
  };
  const internal =
    options.internal ??
    ({
      search: async ({ line }) => [
        observation(line.designation, line.idx === 0 ? 100 : 200),
      ],
    } satisfies PriceEvidenceAdapter);
  const web =
    options.web ?? ({ search: async () => [] } satisfies PriceEvidenceAdapter);
  const queue = { add: vi.fn(async () => ({ id: "job-1" })) } as unknown as Queue;
  const service = new BdcPricingService(
    bdcRepository,
    pricingRepository,
    options.analyzer ?? new BdcLineAnalyzer(null),
    options.aiEstimator ?? new BdcAiEstimator(null),
    internal,
    web,
    queue,
    {
      now: new Date("2026-07-20T12:00:00.000Z"),
      defaultTvaPct: 20,
      annualInflationPct: 0,
      regionMultipliers: { agadir: 1 },
      maxAgeDays: 1_095,
    },
  );
  return {
    service,
    pricingRepository,
    stages,
    queue,
    savedPatch: () => savedPatch,
  };
}

describe("BDC pricing orchestration", () => {
  test("runs all seven stages and decides every parseable zero line", async () => {
    const { service, stages, savedPatch } = setup();
    const run = await service.createRun("avis-1", {
      idempotencyKey: "key-1",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });

    const completed = await service.run(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.decisions).toHaveLength(2);
    expect(completed.decisions[0]).toMatchObject({
      proposedUnitPriceHt: 88,
      manualPriceLocked: true,
    });
    expect(completed.decisions[1]?.proposedUnitPriceHt).toBeGreaterThan(0);
    expect(completed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRef: "FAC-200", unitPriceHtMad: 200 }),
      ]),
    );
    expect(stages).toEqual([
      "analyse",
      "recherche_interne",
      "recherche_marche",
      "normalisation",
      "estimation",
      "optimisation",
      "brouillon_enregistre",
    ]);
    expect(savedPatch()).toMatchObject({ statut: "brouillon" });
    const savedLines = (
      savedPatch() as {
        lignes: Array<{ idx: number; prixUnitaireHt: number; source: string }>;
      }
    ).lignes;
    expect(savedLines[0]).toMatchObject({
      idx: 0,
      prixUnitaireHt: 88,
      source: "manuel",
    });
    expect(savedLines[1]).toMatchObject({
      idx: 1,
      source: "agent",
    });
    expect(savedLines[1]?.prixUnitaireHt).toBeGreaterThan(0);
  });

  test("reuses an idempotency key and enqueues a stable job id", async () => {
    const { service, queue } = setup();
    const input = {
      idempotencyKey: "same-key",
      requestedMarkupPct: 15,
      actorId: "user-1",
    };
    const first = await service.createRun("avis-1", input);
    const second = await service.createRun("avis-1", input);

    expect(second.id).toBe(first.id);
    expect(queue.add).toHaveBeenLastCalledWith(
      "price",
      { runId: first.id },
      expect.objectContaining({ jobId: `price-${first.id}` }),
    );
  });

  test("isolates a failed adapter and retains completed evidence", async () => {
    const { service } = setup({
      internal: { search: async () => { throw new Error("internal down"); } },
      web: { search: async ({ line }) => [observation(line.designation, 250)] },
    });
    const run = await service.createRun("avis-1", {
      idempotencyKey: "key-1",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });
    const completed = await service.run(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.warnings).toContain("source_interne_indisponible");
    expect(completed.decisions[1]?.proposedUnitPriceHt).toBeGreaterThan(0);
  });

  test("caps market-search queries and records an auditable budget warning", async () => {
    vi.stubEnv("BDC_PRICE_SEARCH_MAX_QUERIES", "1");
    const web = { search: vi.fn(async () => []) };
    const { service } = setup({ web });
    const queued = await service.createRun("avis-1", {
      idempotencyKey: "budget-key",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });
    const completed = await service.run(queued.id);
    expect(web.search).toHaveBeenCalledOnce();
    expect(completed.warnings).toContain("budget_recherche_marche_atteint");
  });

  test("uses a conservative AI cost only when market evidence is absent", async () => {
    const aiEstimator = {
      estimate: vi.fn(async (lines: NormalizedLine[]) =>
        new Map(
          lines.map((line) => [
            line.idx,
            {
              category: line.category,
              unitCostHtMad: 1_000,
              lowHtMad: 900,
              highHtMad: 1_200,
              assumptions: ["ia:estimation_conservative_sans_preuve_verifiee"],
              components: [
                { label: "cout_direct", costHtMad: 1_000, sourceIds: [] },
              ],
            },
          ]),
        ),
      ),
    } as unknown as BdcAiEstimator;
    const noEvidence = { search: async () => [] };
    const { service } = setup({
      internal: noEvidence,
      web: noEvidence,
      aiEstimator,
    });
    const queued = await service.createRun("avis-1", {
      idempotencyKey: "ai-fallback",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });
    const completed = await service.run(queued.id);

    expect(aiEstimator.estimate).toHaveBeenCalled();
    expect(completed.decisions[1]).toMatchObject({
      estimatedCostHt: 1_000,
      proposedUnitPriceHt: 1_150,
      markupPct: 15,
      method: "ia_conservative",
      confidence: "faible",
    });
  });

  test("never completes a run while a non-manual line still has a zero price", async () => {
    const noEvidence = { search: async () => [] };
    const { service, pricingRepository } = setup({
      internal: noEvidence,
      web: noEvidence,
      aiEstimator: new BdcAiEstimator(null),
    });
    const queued = await service.createRun("avis-1", {
      idempotencyKey: "no-zero-invariant",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });

    await expect(service.run(queued.id)).rejects.toThrow(
      "pricing_incomplete",
    );
    expect(await pricingRepository.getRun(queued.id)).toMatchObject({
      status: "failed",
    });
  });

  test("cancels before work and does not execute the analyzer", async () => {
    const analyzer = new BdcLineAnalyzer(null);
    const spy = vi.spyOn(analyzer, "analyzeLines");
    const { service } = setup({ analyzer });
    const run = await service.createRun("avis-1", {
      idempotencyKey: "key-1",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });
    await service.cancelRun(run.id);
    expect((await service.run(run.id)).status).toBe("cancelled");
    expect(spy).not.toHaveBeenCalled();
  });

  test("persists a failed run", async () => {
    const analyzer = new BdcLineAnalyzer(null);
    vi.spyOn(analyzer, "analyzeLines").mockRejectedValue(new Error("analysis failed"));
    const { service, pricingRepository } = setup({ analyzer });
    const run = await service.createRun("avis-1", {
      idempotencyKey: "key-1",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });
    await expect(service.run(run.id)).rejects.toThrow("analysis failed");
    expect(await pricingRepository.getRun(run.id)).toMatchObject({
      status: "failed",
      error: "Le chiffrage a échoué; consultez les journaux du service.",
    });
  });

  test("applies only zero lines and keeps the response as a draft", async () => {
    const { service, savedPatch } = setup();
    const run = await service.createRun("avis-1", {
      idempotencyKey: "key-1",
      requestedMarkupPct: 15,
      actorId: "user-1",
    });
    await service.run(run.id);
    await service.applyRun(run.id);

    expect(savedPatch()).toMatchObject({ statut: "brouillon" });
    const lines = (savedPatch() as { lignes: Array<{ idx: number; prixUnitaireHt: number }> }).lignes;
    expect(lines[0]?.prixUnitaireHt).toBe(88);
    expect(lines[1]?.prixUnitaireHt).toBeGreaterThan(0);
  });
});
