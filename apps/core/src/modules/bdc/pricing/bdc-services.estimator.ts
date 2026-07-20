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

function isTravel(value: string): boolean {
  return /deplacement|transport|voyage|hebergement/i.test(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
}

export function estimateServiceCost(
  line: NormalizedLine,
  observations: NormalizedObservation[],
  rateCard: PricingRateCard,
) {
  const assumptions = [...line.assumptions];
  const grouped = {
    roles: { cost: 0, sourceIds: [] as string[] },
    travel: { cost: 0, sourceIds: [] as string[] },
  };

  if (line.components.length === 0) {
    const resolved = resolveWholeLineCost(line, observations, rateCard);
    grouped.roles.cost = resolved?.unitCostHtMad ?? 0;
    grouped.roles.sourceIds = resolved?.sourceIds ?? [];
    if (!resolved) assumptions.push("effort_service_manquant");
    if (resolved?.usedFallback) assumptions.push(`bareme:${rateCard.version}:service`);
  } else {
    for (const component of line.components) {
      const resolved = resolveComponentCost(
        component.designation,
        component.unit,
        observations,
        rateCard,
      );
      const target = isTravel(component.designation) ? grouped.travel : grouped.roles;
      target.cost += (resolved?.unitCostHtMad ?? 0) * component.quantityFactor;
      target.sourceIds.push(...(resolved?.sourceIds ?? []));
      if (!resolved) assumptions.push(`cout_manquant:${component.designation}`);
      if (resolved?.usedFallback) {
        assumptions.push(`bareme:${rateCard.version}:${component.designation}`);
      }
    }
    if (grouped.roles.cost + grouped.travel.cost <= 0) {
      const wholeLine = resolveWholeLineCost(line, observations, rateCard);
      if (wholeLine) {
        grouped.roles.cost = wholeLine.unitCostHtMad;
        grouped.roles.sourceIds = wholeLine.sourceIds;
        assumptions.push("decomposition_remplacee_reference_globale");
      }
    }
  }

  const components: CostEstimateComponent[] = [
    {
      label: "effort_roles",
      costHtMad: roundMad(grouped.roles.cost),
      sourceIds: grouped.roles.sourceIds,
    },
  ];
  if (grouped.travel.cost > 0) {
    components.push({
      label: "deplacement",
      costHtMad: roundMad(grouped.travel.cost),
      sourceIds: grouped.travel.sourceIds,
    });
  }

  const directCost = grouped.roles.cost + grouped.travel.cost;
  const tools = percentageComponent(
    "outils_licences",
    directCost,
    rateCard.toolsPct,
  );
  components.push(tools);
  const overhead = percentageComponent(
    "frais_generaux",
    directCost + tools.costHtMad,
    rateCard.serviceOverheadPct,
  );
  components.push(overhead);
  components.push(
    percentageComponent(
      "alea",
      directCost + tools.costHtMad + overhead.costHtMad,
      rateCard.contingencyPct,
    ),
  );

  return finishEstimate("services", components, assumptions);
}
