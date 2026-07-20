import Decimal from "decimal.js";
import type {
  NormalizedLine,
  PriceObservation,
} from "./bdc-pricing.types";

export type CanonicalUnit =
  | "m2"
  | "ml"
  | "m3"
  | "u"
  | "kg"
  | "l"
  | "h"
  | "jour"
  | "km"
  | "forfait"
  | "ensemble"
  | "package"
  | "unknown";

export interface NormalizationPolicy {
  now: Date;
  defaultTvaPct: number;
  annualInflationPct: number;
  regionMultipliers: Readonly<Record<string, number>>;
  maxAgeDays: number;
}

export interface NormalizedObservation extends PriceObservation {
  comparableUnitPriceHtMad: number;
  compatibility: number;
  freshness: number;
  conversionNotes: string[];
}

const DAY_MS = 86_400_000;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeUnit(raw: string): CanonicalUnit {
  const value = fold(raw).replace(/²/g, "2");

  if (/^(m2|metre carre|metres carres)$/.test(value)) return "m2";
  if (/^(ml|metre lineaire|metres lineaires|m lineaire)$/.test(value)) {
    return "ml";
  }
  if (/^(m3|metre cube|metres cubes)$/.test(value)) return "m3";
  if (/^(u|unite|unites|piece|pieces|pcs?)$/.test(value)) return "u";
  if (/^(kg|kilogramme|kilogrammes)$/.test(value)) return "kg";
  if (/^(l|litre|litres)$/.test(value)) return "l";
  if (/^(h|heure|heures)$/.test(value)) return "h";
  if (/^(j|jour|jours|journee|journees)$/.test(value)) return "jour";
  if (/^(km|kilometre|kilometres)$/.test(value)) return "km";
  if (/^(forfait|ft)$/.test(value)) return "forfait";
  if (/^(ensemble|ens)$/.test(value)) return "ensemble";
  if (/^(pack|package|paquet|lot|boite|seau|carton|cartons|ramette|ramettes|conditionnement)$/.test(value)) {
    return "package";
  }
  return "unknown";
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRegion(value: string | null): string | null {
  return value ? fold(value) : null;
}

function roundMad(value: Decimal): number {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function normalizeObservation(
  observation: PriceObservation,
  line: NormalizedLine,
  policy: NormalizationPolicy,
): NormalizedObservation | null {
  if (
    !finitePositive(observation.unitPriceHtMad) ||
    !Number.isFinite(observation.reliability) ||
    observation.reliability < 0 ||
    observation.reliability > 1 ||
    !Number.isFinite(policy.defaultTvaPct) ||
    policy.defaultTvaPct < 0 ||
    !Number.isFinite(policy.annualInflationPct) ||
    policy.annualInflationPct <= -100 ||
    !Number.isFinite(policy.maxAgeDays) ||
    policy.maxAgeDays <= 0
  ) {
    return null;
  }

  const observedAt = new Date(observation.observedAt);
  if (Number.isNaN(observedAt.getTime())) return null;

  const ageDays = Math.max(
    0,
    (policy.now.getTime() - observedAt.getTime()) / DAY_MS,
  );
  if (ageDays > policy.maxAgeDays && !observation.verified) return null;

  const sourceUnit = normalizeUnit(observation.unit);
  const targetUnit = normalizeUnit(line.unit);
  if (targetUnit === "unknown") return null;

  const notes: string[] = [];
  let price = new Decimal(observation.unitPriceHtMad);
  let comparableUnit = sourceUnit;

  const taxBasis = metadataString(observation.metadata, "taxBasis")?.toUpperCase();
  if (taxBasis === "TTC") {
    const rawTva = observation.metadata.tvaPct;
    const tvaPct = finitePositive(rawTva) ? rawTva : policy.defaultTvaPct;
    price = price.div(new Decimal(1).plus(new Decimal(tvaPct).div(100)));
    notes.push(`ttc_vers_ht:${tvaPct}%`);
  }

  const packageQuantity = observation.metadata.packageQuantity;
  const packageUnit = metadataString(observation.metadata, "packageUnit");
  if (
    sourceUnit === "package" &&
    finitePositive(packageQuantity) &&
    packageUnit
  ) {
    const normalizedPackageUnit = normalizeUnit(packageUnit);
    if (normalizedPackageUnit !== "unknown") {
      price = price.div(packageQuantity);
      comparableUnit = normalizedPackageUnit;
      notes.push(`conditionnement:${packageQuantity}_${normalizedPackageUnit}`);
    }
  }

  if (comparableUnit !== targetUnit) {
    const coverage = observation.metadata.coveragePerPackage;
    const coverageUnit = metadataString(observation.metadata, "coverageUnit");
    if (
      sourceUnit === "package" &&
      finitePositive(coverage) &&
      coverageUnit &&
      normalizeUnit(coverageUnit) === targetUnit
    ) {
      price = new Decimal(observation.unitPriceHtMad).div(coverage);
      if (taxBasis === "TTC") {
        const rawTva = observation.metadata.tvaPct;
        const tvaPct = finitePositive(rawTva) ? rawTva : policy.defaultTvaPct;
        price = price.div(new Decimal(1).plus(new Decimal(tvaPct).div(100)));
      }
      comparableUnit = targetUnit;
      notes.push(`couverture:${coverage}_${targetUnit}`);
    } else {
      return null;
    }
  }

  const sourceRegion = normalizeRegion(observation.region);
  const targetRegion = normalizeRegion(line.region);
  if (sourceRegion && targetRegion && sourceRegion !== targetRegion) {
    const sourceMultiplier = policy.regionMultipliers[sourceRegion];
    const targetMultiplier = policy.regionMultipliers[targetRegion];
    if (finitePositive(sourceMultiplier) && finitePositive(targetMultiplier)) {
      price = price.mul(new Decimal(targetMultiplier).div(sourceMultiplier));
      notes.push(`region:${sourceRegion}->${targetRegion}`);
    }
  }

  if (ageDays > 0 && policy.annualInflationPct !== 0) {
    const annualFactor = new Decimal(1).plus(
      new Decimal(policy.annualInflationPct).div(100),
    );
    price = price.mul(annualFactor.pow(ageDays / 365.25));
    notes.push(`actualisation:${policy.annualInflationPct}%_annuel`);
  }

  const freshness =
    ageDays > policy.maxAgeDays
      ? 0.05
      : Math.max(0.05, Math.min(1, 1 - ageDays / policy.maxAgeDays));

  return {
    ...observation,
    unit: comparableUnit,
    comparableUnitPriceHtMad: roundMad(price),
    compatibility: comparableUnit === targetUnit ? 1 : 0,
    freshness: Number(freshness.toFixed(4)),
    conversionNotes: notes,
  };
}
