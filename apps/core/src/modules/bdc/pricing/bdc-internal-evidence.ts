import { createHash } from "node:crypto";
import type {
  BdcRepository,
  InternalPriceEvidenceRow,
} from "../bdc.repository";
import type { PriceEvidenceAdapter, PriceEvidenceQuery } from "./bdc-evidence.types";
import type { PriceObservation } from "./bdc-pricing.types";

function evidenceHash(row: InternalPriceEvidenceRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.sourceType,
        row.sourceRef,
        row.designation,
        row.unit,
        row.unitPriceHtMad,
        row.observedAt.toISOString(),
      ]),
    )
    .digest("hex");
}

export class BdcInternalEvidenceAdapter implements PriceEvidenceAdapter {
  constructor(private readonly repository: BdcRepository) {}

  async search(query: PriceEvidenceQuery): Promise<PriceObservation[]> {
    const limit = Math.max(1, Math.min(200, query.limit));
    const rows = await this.repository.findInternalPriceEvidence({
      designation: query.line.designation,
      category: query.line.category,
      unit: query.line.unit,
      region: query.line.region,
      excludeAvisId: query.excludeAvisId,
      limit,
    });
    const seen = new Set<string>();
    const output: PriceObservation[] = [];

    for (const row of rows) {
      if (!Number.isFinite(row.unitPriceHtMad) || row.unitPriceHtMad <= 0) continue;
      if (row.designation.trim().length < 3 || row.sourceRef.trim().length === 0) {
        continue;
      }
      const snapshotHash = evidenceHash(row);
      if (seen.has(snapshotHash)) continue;
      seen.add(snapshotHash);
      output.push({
        designation: row.designation,
        category: query.line.category,
        unit: row.unit,
        unitPriceHtMad: row.unitPriceHtMad,
        region: row.region,
        observedAt: row.observedAt.toISOString(),
        sourceType: row.sourceType,
        sourceRef: row.sourceRef,
        sourceUrl: row.sourceUrl,
        snapshotHash,
        verified: row.verified,
        reliability: Math.max(0, Math.min(1, row.reliability)),
        metadata: { ...row.metadata, internal: true },
      });
      if (output.length >= limit) break;
    }
    return output;
  }
}
