import type { NormalizedObservation } from "./bdc-price-normalizer";
import type { NormalizedLine } from "./bdc-pricing.types";
import {
  finishEstimate,
  percentageComponent,
  resolveWholeLineCost,
  type PricingRateCard,
} from "./bdc-estimator.shared";

function foldedLine(line: NormalizedLine): string {
  return `${line.designation} ${line.specification}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function estimateSupplyCost(
  line: NormalizedLine,
  observations: NormalizedObservation[],
  rateCard: PricingRateCard,
) {
  const resolved = resolveWholeLineCost(line, observations, rateCard);
  const purchaseCost = resolved?.unitCostHtMad ?? 0;
  const assumptions = [...line.assumptions];
  if (!resolved) assumptions.push("cout_achat_manquant");
  if (resolved?.usedFallback) assumptions.push(`bareme:${rateCard.version}:achat`);

  const text = foldedLine(line);
  const components = [
    {
      label: "achat_net",
      costHtMad: purchaseCost,
      sourceIds: resolved?.sourceIds ?? [],
    },
  ];

  if (/livraison|transport|rendu/.test(text)) {
    components.push(
      percentageComponent("livraison", purchaseCost, rateCard.deliveryPct),
    );
  }
  if (/installation|pose|mise en service|montage/.test(text)) {
    components.push(
      percentageComponent(
        "installation",
        purchaseCost,
        rateCard.installationPct,
      ),
    );
  }
  if (/garantie|disponibilite|rupture|delai/.test(text)) {
    components.push(
      percentageComponent(
        "garantie_disponibilite",
        purchaseCost,
        rateCard.warrantyRiskPct,
      ),
    );
  }

  return finishEstimate("fournitures", components, assumptions);
}
