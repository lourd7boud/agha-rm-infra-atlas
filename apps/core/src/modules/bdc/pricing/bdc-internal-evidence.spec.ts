import { describe, expect, test } from "vitest";
import type {
  BdcRepository,
  InternalPriceEvidenceRow,
} from "../bdc.repository";
import type { NormalizedLine } from "./bdc-pricing.types";
import { BdcInternalEvidenceAdapter } from "./bdc-internal-evidence";

const line: NormalizedLine = {
  idx: 0,
  category: "fournitures",
  subcategory: "peinture",
  designation: "Peinture acrylique 20 kg",
  specification: "blanc mat",
  quantity: 5,
  unit: "u",
  region: "Agadir",
  components: [],
  assumptions: [],
  blockers: [],
};

function row(
  sourceType: InternalPriceEvidenceRow["sourceType"],
  sourceRef: string,
  overrides: Partial<InternalPriceEvidenceRow> = {},
): InternalPriceEvidenceRow {
  return {
    designation: "Peinture acrylique 20 kg",
    unit: "u",
    unitPriceHtMad: 500,
    region: "Agadir",
    observedAt: new Date("2026-07-01T00:00:00.000Z"),
    sourceType,
    sourceRef,
    sourceUrl: null,
    verified: true,
    reliability: 0.9,
    metadata: {},
    ...overrides,
  };
}

describe("internal BDC price evidence", () => {
  test("maps every verified internal source with dates and references", async () => {
    const rows = [
      row("bpu", "BPU-1"),
      row("devis", "DEV-1"),
      row("bdc", "BDC-1"),
      row("fournisseur", "PO-1"),
      row("facture", "FAC-1"),
      row("resultat", "RES-1", { unit: "forfait", unitPriceHtMad: 10_000 }),
    ];
    const repository = {
      findInternalPriceEvidence: async () => rows,
    } as unknown as BdcRepository;
    const adapter = new BdcInternalEvidenceAdapter(repository);

    const result = await adapter.search({ line, excludeAvisId: "avis-current", limit: 20 });

    expect(result.map((item) => item.sourceType)).toEqual([
      "bpu",
      "devis",
      "bdc",
      "fournisseur",
      "facture",
      "resultat",
    ]);
    expect(result.every((item) => item.observedAt === "2026-07-01T00:00:00.000Z")).toBe(true);
    expect(result.every((item) => item.sourceRef.length > 0)).toBe(true);
  });

  test("rejects invalid prices and collapses duplicate evidence hashes", async () => {
    const duplicate = row("facture", "FAC-1");
    const repository = {
      findInternalPriceEvidence: async () => [
        duplicate,
        duplicate,
        row("devis", "ZERO", { unitPriceHtMad: 0 }),
        row("bdc", "NEG", { unitPriceHtMad: -10 }),
      ],
    } as unknown as BdcRepository;
    const adapter = new BdcInternalEvidenceAdapter(repository);

    const result = await adapter.search({ line, excludeAvisId: null, limit: 20 });
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceRef).toBe("FAC-1");
  });

  test("passes a bounded query and current avis exclusion to the repository", async () => {
    let captured: unknown;
    const repository = {
      findInternalPriceEvidence: async (query: unknown) => {
        captured = query;
        return [];
      },
    } as unknown as BdcRepository;
    const adapter = new BdcInternalEvidenceAdapter(repository);

    await adapter.search({ line, excludeAvisId: "avis-current", limit: 5_000 });
    expect(captured).toMatchObject({
      designation: line.designation,
      category: "fournitures",
      unit: "u",
      region: "Agadir",
      excludeAvisId: "avis-current",
      limit: 200,
    });
  });
});
