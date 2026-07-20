import { describe, expect, test } from "vitest";
import type { NormalizedLine, PriceObservation } from "./bdc-pricing.types";
import {
  normalizeObservation,
  normalizeUnit,
  type NormalizationPolicy,
} from "./bdc-price-normalizer";

const policy: NormalizationPolicy = {
  now: new Date("2026-07-20T00:00:00.000Z"),
  defaultTvaPct: 20,
  annualInflationPct: 3,
  regionMultipliers: { casablanca: 1, agadir: 1.05 },
  maxAgeDays: 1_095,
};

function line(overrides: Partial<NormalizedLine> = {}): NormalizedLine {
  return {
    idx: 0,
    category: "fournitures",
    subcategory: "",
    designation: "Article test",
    specification: "",
    quantity: 1,
    unit: "u",
    region: null,
    components: [],
    assumptions: [],
    blockers: [],
    ...overrides,
  };
}

function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: "obs-1",
    designation: "Article test",
    category: "fournitures",
    unit: "u",
    unitPriceHtMad: 100,
    region: null,
    observedAt: "2026-07-20T00:00:00.000Z",
    sourceType: "facture",
    sourceRef: "FAC-1",
    sourceUrl: null,
    snapshotHash: "hash-1",
    verified: true,
    reliability: 0.9,
    metadata: {},
    ...overrides,
  };
}

describe("BDC price normalization", () => {
  test.each([
    ["m²", "m2"],
    ["m2", "m2"],
    ["M2", "m2"],
    ["ml", "ml"],
    ["mètre linéaire", "ml"],
    ["U", "u"],
    ["carton", "package"],
    ["unité", "u"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(normalizeUnit(raw)).toBe(expected);
  });

  test("converts TTC to HT", () => {
    const result = normalizeObservation(
      observation({
        unitPriceHtMad: 100,
        metadata: { taxBasis: "TTC", tvaPct: 20 },
      }),
      line(),
      policy,
    );

    expect(result?.comparableUnitPriceHtMad).toBe(83.33);
    expect(result?.conversionNotes).toContain("ttc_vers_ht:20%");
  });

  test("converts a package price to its unit price", () => {
    const result = normalizeObservation(
      observation({
        unit: "pack",
        unitPriceHtMad: 600,
        metadata: { packageQuantity: 10, packageUnit: "u" },
      }),
      line(),
      policy,
    );

    expect(result?.comparableUnitPriceHtMad).toBe(60);
    expect(result?.unit).toBe("u");
    expect(result?.conversionNotes).toContain("conditionnement:10_u");
  });

  test("stores a matching carton under its canonical package unit", () => {
    const result = normalizeObservation(
      observation({ unit: "carton" }),
      line({ unit: "package" }),
      policy,
    );
    expect(result?.unit).toBe("package");
  });

  test("rejects litre to square metre without declared coverage", () => {
    expect(
      normalizeObservation(
        observation({ unit: "litre" }),
        line({ unit: "m2" }),
        policy,
      ),
    ).toBeNull();
  });

  test("uses declared package coverage for dimensional conversion", () => {
    const result = normalizeObservation(
      observation({
        unit: "seau",
        unitPriceHtMad: 500,
        metadata: { coveragePerPackage: 25, coverageUnit: "m2" },
      }),
      line({ unit: "m2" }),
      policy,
    );

    expect(result?.comparableUnitPriceHtMad).toBe(20);
  });

  test("weights a recent observation above a two-year-old observation", () => {
    const recent = normalizeObservation(
      observation({ observedAt: "2026-06-20T00:00:00.000Z" }),
      line(),
      policy,
    );
    const old = normalizeObservation(
      observation({ observedAt: "2024-07-20T00:00:00.000Z" }),
      line(),
      policy,
    );

    expect(recent?.freshness).toBeGreaterThan(old?.freshness ?? 1);
  });

  test("applies explicit source-to-target regional multipliers", () => {
    const result = normalizeObservation(
      observation({ region: "Casablanca" }),
      line({ region: "Agadir" }),
      { ...policy, annualInflationPct: 0 },
    );

    expect(result?.comparableUnitPriceHtMad).toBe(105);
    expect(result?.conversionNotes).toContain("region:casablanca->agadir");
  });

  test("rejects stale unverified evidence but retains verified evidence", () => {
    const stale = observation({
      observedAt: "2020-01-01T00:00:00.000Z",
      verified: false,
    });

    expect(normalizeObservation(stale, line(), policy)).toBeNull();
    expect(
      normalizeObservation({ ...stale, verified: true }, line(), policy)?.freshness,
    ).toBe(0.05);
  });
});
