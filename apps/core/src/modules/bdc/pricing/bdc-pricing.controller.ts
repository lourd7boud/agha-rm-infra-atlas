import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { Roles } from "../../auth/auth.module";
import { BdcPricingService } from "./bdc-pricing.service";

const PRICING_ROLES = ["direction", "marches", "admin-si"] as const;

const createRunSchema = z
  .object({
    requestedMarkupPct: z.number().min(15).max(100).default(15),
  })
  .strict();

const feedbackSchema = z
  .object({
    lineIdx: z.number().int().min(0).nullable().default(null),
    kind: z.enum([
      "approved",
      "corrected",
      "actual_cost",
      "supplier_quote",
      "submitted",
      "won",
      "lost",
    ]),
    unitPriceHtMad: z.number().nonnegative().nullable().default(null),
    actualCostHtMad: z.number().nonnegative().nullable().default(null),
    winningAmountHtMad: z.number().nonnegative().nullable().default(null),
    sourceRef: z.string().max(500).nullable().default(null),
    sourceUrl: z.string().url().max(2_000).nullable().default(null),
    verified: z.boolean().default(false),
    note: z.string().max(2_000).nullable().default(null),
  })
  .strict();

interface PricingRequest {
  user?: { sub?: string };
}

@Controller("bdc")
export class BdcPricingController {
  constructor(
    @Inject(BdcPricingService)
    private readonly pricing: BdcPricingService,
  ) {}

  @Roles(...PRICING_ROLES)
  @Post("avis/:id/pricing-runs")
  @HttpCode(HttpStatus.ACCEPTED)
  async createRun(
    @Param("id") id: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Req() request: PricingRequest,
  ) {
    const idempotencyKey = headerValue(headers, "idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new BadRequestException("En-tête Idempotency-Key requis");
    }
    const parsed = createRunSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.pricing.createRun(id, {
      idempotencyKey,
      requestedMarkupPct: parsed.data.requestedMarkupPct,
      actorId: request.user?.sub ?? "unknown",
    });
  }

  @Get("avis/:id/pricing-runs/latest")
  async latest(@Param("id") id: string) {
    return this.pricing.getLatestRun(id);
  }

  @Get("pricing-runs/:runId")
  async getRun(@Param("runId") runId: string) {
    return this.pricing.getRun(runId);
  }

  @Roles(...PRICING_ROLES)
  @Post("pricing-runs/:runId/cancel")
  async cancel(@Param("runId") runId: string) {
    return this.pricing.cancelRun(runId);
  }

  @Roles(...PRICING_ROLES)
  @Post("pricing-runs/:runId/apply")
  async apply(@Param("runId") runId: string) {
    return this.pricing.applyRun(runId);
  }

  @Roles(...PRICING_ROLES)
  @Post("pricing-runs/:runId/feedback")
  async feedback(@Param("runId") runId: string, @Body() body: unknown) {
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    await this.pricing.recordFeedback(runId, parsed.data);
    return { ok: true };
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = headers[key] ?? headers[key.toLowerCase()];
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : null;
}
