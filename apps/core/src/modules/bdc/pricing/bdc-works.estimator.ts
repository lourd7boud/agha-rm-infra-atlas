import type { NormalizedObservation } from "./bdc-price-normalizer";
import type {
  CostEstimateComponent,
  NormalizedLine,
} from "./bdc-pricing.types";
import {
  finishEstimate,
  percentageComponent,
  resolveComponentCost,
  resolveWholeLineCost,
  roundMad,
  type PricingRateCard,
} from "./bdc-estimator.shared";

function isLabor(value: string): boolean {
  return /main[ -]?oeuvre|ouvrier|macon|technicien|poseur|heure/i.test(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
}

function isEquipment(value: string): boolean {
  return /engin|machine|nacelle|echafaud|materiel|equipement/i.test(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
}

function isTransport(value: string): boolean {
  return /transport|livraison|deplacement|evacuation/i.test(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
}

export function estimateWorksCost(
  line: NormalizedLine,
  observations: NormalizedObservation[],
  rateCard: PricingRateCard,
) {
  const grouped = new Map<
    string,
    { cost: number; sourceIds: string[]; fallback: boolean }
  >();
  const assumptions = [...line.assumptions];

  if (line.components.length === 0) {
    const whole = resolveWholeLineCost(line, observations, rateCard);
    grouped.set("materiaux", {
      cost: whole?.unitCostHtMad ?? 0,
      sourceIds: whole?.sourceIds ?? [],
      fallback: whole?.usedFallback ?? true,
    });
  } else {
    for (const component of line.components) {
      const resolved = resolveComponentCost(
        component.designation,
        component.unit,
        observations,
        rateCard,
      );
      const label = isLabor(component.designation)
        ? "main_oeuvre"
        : isEquipment(component.designation)
          ? "equipement"
          : isTransport(component.designation)
            ? "transport"
            : "materiaux";
      const current = grouped.get(label) ?? {
        cost: 0,
        sourceIds: [],
        fallback: false,
      };
      current.cost += (resolved?.unitCostHtMad ?? 0) * component.quantityFactor;
      current.sourceIds.push(...(resolved?.sourceIds ?? []));
      current.fallback ||= resolved?.usedFallback ?? true;
      grouped.set(label, current);
      if (!resolved) assumptions.push(`cout_manquant:${component.designation}`);
    }
    const decomposedCost = [...grouped.values()].reduce(
      (total, item) => total + item.cost,
      0,
    );
    if (decomposedCost <= 0) {
      const whole = resolveWholeLineCost(line, observations, rateCard);
      if (whole) {
        grouped.clear();
        grouped.set("materiaux", {
          cost: whole.unitCostHtMad,
          sourceIds: whole.sourceIds,
          fallback: whole.usedFallback,
        });
        assumptions.push("decomposition_remplacee_reference_globale");
      }
    }
  }

  const order = ["materiaux", "main_oeuvre", "equipement", "transport"];
  const components: CostEstimateComponent[] = order
    .filter((label) => grouped.has(label))
    .map((label) => {
      const item = grouped.get(label)!;
      if (item.fallback) assumptions.push(`bareme:${rateCard.version}:${label}`);
      return {
        label,
        costHtMad: roundMad(item.cost),
        sourceIds: item.sourceIds,
      };
    });

  const materialCost = grouped.get("materiaux")?.cost ?? 0;
  const directCost = components.reduce((sum, component) => sum + component.costHtMad, 0);
  const waste = percentageComponent("dechets", materialCost, rateCard.wastePct);
  components.push(waste);
  components.push(
    percentageComponent(
      "frais_chantier",
      directCost + waste.costHtMad,
      rateCard.siteOverheadPct,
    ),
  );

  return finishEstimate("travaux", components, assumptions);
}
