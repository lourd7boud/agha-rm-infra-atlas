import type { NormalizedLine, PriceObservation } from "./bdc-pricing.types";

export interface PriceEvidenceQuery {
  line: NormalizedLine;
  excludeAvisId: string | null;
  limit: number;
}

export interface PriceEvidenceAdapter {
  search(query: PriceEvidenceQuery): Promise<PriceObservation[]>;
}
