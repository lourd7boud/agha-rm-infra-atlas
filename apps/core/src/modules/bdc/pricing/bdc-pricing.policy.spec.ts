import { describe, expect, test } from "vitest";
import { applyMarkupFloor, resolvePricingGuard } from "./bdc-pricing.policy";

describe("BDC pricing policy", () => {
  test("never applies less than 15 percent markup on cost", () => {
    expect(applyMarkupFloor(1_000, 0)).toBe(1_150);
    expect(applyMarkupFloor(1_000, 10)).toBe(1_150);
    expect(applyMarkupFloor(1_000, 20)).toBe(1_200);
    expect(applyMarkupFloor(86.63, 15)).toBe(99.63);
  });

  test.each([
    ["travaux", 800_000, 1_200_000],
    ["fournitures", 750_000, 1_200_000],
    ["services", 750_000, 1_200_000],
  ] as const)("uses the category corridor for %s", (category, low, high) => {
    expect(resolvePricingGuard({ category, estimationHt: 1_000_000 })).toMatchObject({
      lowerHt: low,
      upperHt: high,
    });
  });

  test("does not claim a corridor when estimation is absent", () => {
    expect(resolvePricingGuard({ category: "travaux", estimationHt: null })).toEqual({
      lowerHt: null,
      upperHt: null,
      legalBasis: null,
    });
  });

  test("rejects invalid costs and markup percentages", () => {
    expect(() => applyMarkupFloor(-1, 15)).toThrow(/cost/i);
    expect(() => applyMarkupFloor(Number.NaN, 15)).toThrow(/cost/i);
    expect(() => applyMarkupFloor(1_000, Number.POSITIVE_INFINITY)).toThrow(/markup/i);
  });

  test("rejects invalid administrative estimates", () => {
    expect(() =>
      resolvePricingGuard({ category: "travaux", estimationHt: 0 }),
    ).toThrow(/estimate/i);
  });
});
