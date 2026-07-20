import { describe, expect, test, vi } from "vitest";
import type { Queue } from "bullmq";
import type { BdcRepository } from "../bdc.repository";
import type { PriceEvidenceAdapter } from "./bdc-evidence.types";
import { BdcLineAnalyzer } from "./bdc-line-analyzer";
import {
  InMemoryBdcPricingRepository,
  type PricingRunPatch,
} from "./bdc-pricing.repository";
import { BdcPricingService } from "./bdc-pricing.service";
import type { PriceObservation, PricingStage } from "./bdc-pricing.types";

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
    const { service, stages } = setup();
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
        expect.objectContaining({ sourceRef: "FAC-100", unitPriceHtMad: 100 }),
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
      error: "analysis failed",
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
