import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDb } from "../src/db/client";
import { runBacktest } from "../src/modules/bdc/pricing/bdc-pricing-backtest";
import { BdcPricingLearning } from "../src/modules/bdc/pricing/bdc-pricing-learning";
import { DrizzleBdcPricingRepository } from "../src/modules/bdc/pricing/bdc-pricing.repository";

const HELP = `Usage: tsx scripts/backtest-bdc-pricing.ts --output <file> [--as-of <ISO date>]

Required:
  --output <file>   JSON report destination

Optional:
  --as-of <date>    Chronological cutoff (default: now)
  --help            Show this help
`;

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (existsSync(".env")) process.loadEnvFile(".env");
  const output = argument("output");
  if (!output) throw new Error("Missing required --output argument\n\n" + HELP);
  const asOfRaw = argument("as-of");
  const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error("Invalid --as-of date");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for historical replay");

  const repository = new DrizzleBdcPricingRepository(getDb(databaseUrl));
  const learning = new BdcPricingLearning(repository, {
    minSegmentSamples:
      Number(process.env.BDC_PRICING_MIN_SEGMENT_SAMPLES) || 20,
    historyDays: 365 * 20,
  });
  const samples = (await learning.loadVerifiedSamples(new Date(0))).filter(
    (item) => item.observedAt <= asOf,
  );
  const calibration = await repository.getActiveCalibration();
  const report = runBacktest(
    samples.map((sample) => ({
      id: sample.id,
      category: sample.category,
      unit: sample.unit,
      region: sample.region,
      estimatedCostHt: sample.predictedCostHt,
      proposedUnitPriceHt: sample.proposedUnitPriceHt,
      actualCostHt: sample.actualCostHt,
      hadProposal: sample.proposedUnitPriceHt > 0,
      oldMatcherHadProposal: sample.oldMatcherHadProposal ?? false,
      manualOriginalPriceHt: sample.manualOriginalPriceHt ?? null,
      manualAppliedPriceHt: sample.manualAppliedPriceHt ?? null,
    })),
    calibration,
  );
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        asOf: asOf.toISOString(),
        chronologicalSeparation: true,
        evidenceCompletenessPct:
          samples.length === 0
            ? 0
            : Math.round(
                (samples.filter((item) => item.sourceTypes.length > 0).length /
                  samples.length) *
                  10_000,
              ) / 100,
        confidenceCalibration: null,
        ...report,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  process.stdout.write(`BDC pricing backtest written to ${destination}\n`);
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
